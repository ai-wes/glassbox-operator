import asyncio
import json
import os
import tempfile
import wave
from dataclasses import dataclass
from typing import Optional


@dataclass
class AsrSettings:
    enabled: bool
    model_name: str
    device: Optional[str]
    sample_rate: int
    sample_width: int
    channels: int
    interim_every_chunks: int
    max_seconds: int
    batch_size: int


class AsrService:
    def __init__(self, settings: AsrSettings) -> None:
        self.settings = settings
        self._model = None
        self._load_lock = asyncio.Lock()
        self._transcribe_lock = asyncio.Lock()

    async def ensure_model(self) -> None:
        if self._model is not None:
            return
        async with self._load_lock:
            if self._model is not None:
                return

            def _load_model():
                import nemo.collections.asr as nemo_asr

                model = nemo_asr.models.ASRModel.from_pretrained(
                    model_name=self.settings.model_name
                )
                if self.settings.device:
                    model = model.to(self.settings.device)
                return model

            self._model = await asyncio.to_thread(_load_model)

    def _buffer_seconds(self, buffer_size: int) -> float:
        bytes_per_second = (
            self.settings.sample_rate
            * self.settings.sample_width
            * self.settings.channels
        )
        if bytes_per_second == 0:
            return 0.0
        return buffer_size / bytes_per_second

    def _write_wav(self, pcm_bytes: bytes) -> str:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_path = tmp.name
        tmp.close()
        with wave.open(tmp_path, "wb") as wf:
            wf.setnchannels(self.settings.channels)
            wf.setsampwidth(self.settings.sample_width)
            wf.setframerate(self.settings.sample_rate)
            wf.writeframes(pcm_bytes)
        return tmp_path

    def _transcribe_sync(self, pcm_bytes: bytes) -> str:
        if not pcm_bytes:
            return ""
        if self.settings.max_seconds:
            seconds = self._buffer_seconds(len(pcm_bytes))
            if seconds > self.settings.max_seconds:
                raise ValueError(
                    f"audio exceeds max length of {self.settings.max_seconds}s"
                )
        wav_path = self._write_wav(pcm_bytes)
        try:
            outputs = self._model.transcribe(
                paths2audio_files=[wav_path],
                batch_size=self.settings.batch_size,
            )
            if isinstance(outputs, list) and outputs:
                return str(outputs[0])
            return ""
        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass

    async def transcribe(self, pcm_bytes: bytes) -> str:
        await self.ensure_model()
        async with self._transcribe_lock:
            return await asyncio.to_thread(self._transcribe_sync, pcm_bytes)


async def handle_asr_websocket(
    websocket,
    asr_service: AsrService,
    settings: AsrSettings,
    session_id: str | None = None,
    on_transcript=None,
) -> None:
    await websocket.accept()
    await websocket.send_json({"type": "ready"})

    buffer = bytearray()
    chunk_count = 0

    try:
        while True:
            message = await websocket.receive()
            data_bytes = message.get("bytes")
            data_text = message.get("text")

            if data_bytes:
                buffer.extend(data_bytes)
                chunk_count += 1
                if settings.interim_every_chunks > 0 and (
                    chunk_count % settings.interim_every_chunks == 0
                ):
                    text = await asr_service.transcribe(bytes(buffer))
                    if on_transcript:
                        await on_transcript(text, False, session_id)
                    await websocket.send_json(
                        {"type": "transcript", "text": text, "is_final": False}
                    )
                continue

            if data_text:
                try:
                    payload = json.loads(data_text)
                except json.JSONDecodeError:
                    await websocket.send_json(
                        {"type": "error", "message": "invalid json message"}
                    )
                    continue

                if payload.get("type") == "start":
                    session_id = payload.get("sessionId") or session_id
                    continue

                if payload.get("type") == "end":
                    text = await asr_service.transcribe(bytes(buffer))
                    if on_transcript:
                        await on_transcript(text, True, session_id)
                    await websocket.send_json(
                        {"type": "transcript", "text": text, "is_final": True}
                    )
                    break
                await websocket.send_json(
                    {"type": "error", "message": "unknown message type"}
                )
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
