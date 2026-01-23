import asyncio
from dataclasses import dataclass
from typing import Any, Dict
from urllib.parse import urlencode

import websockets


@dataclass
class ElevenLabsTtsSettings:
    enabled: bool
    api_key: str | None
    base_url: str
    voice_id: str | None
    model_id: str | None
    output_format: str | None
    language_code: str | None
    enable_logging: bool
    enable_ssml: bool
    inactivity_timeout: int
    sync_alignment: bool
    auto_mode: bool
    text_normalization: str | None

    def build_url(self) -> str:
        query: Dict[str, Any] = {
            "enable_logging": str(self.enable_logging).lower(),
            "enable_ssml_parsing": str(self.enable_ssml).lower(),
            "inactivity_timeout": str(self.inactivity_timeout),
            "sync_alignment": str(self.sync_alignment).lower(),
            "auto_mode": str(self.auto_mode).lower(),
        }
        if self.model_id:
            query["model_id"] = self.model_id
        if self.language_code:
            query["language_code"] = self.language_code
        if self.output_format:
            query["output_format"] = self.output_format
        if self.text_normalization:
            query["apply_text_normalization"] = self.text_normalization
        query_string = urlencode(query)
        base = self.base_url.rstrip("/")
        return f"{base}/v1/text-to-speech/{self.voice_id}/stream-input?{query_string}"


async def proxy_tts_websocket(client_ws, settings: ElevenLabsTtsSettings) -> None:
    await client_ws.accept()

    if not settings.enabled:
        await client_ws.send_json({"type": "error", "message": "ElevenLabs TTS disabled"})
        await client_ws.close()
        return
    if not settings.api_key or not settings.voice_id:
        await client_ws.send_json({"type": "error", "message": "ElevenLabs API key or voice id missing"})
        await client_ws.close()
        return

    headers = {"xi-api-key": settings.api_key}
    url = settings.build_url()

    async with websockets.connect(url, extra_headers=headers) as upstream:
        async def client_to_upstream() -> None:
            try:
                while True:
                    message = await client_ws.receive()
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])
            except Exception:
                pass
            finally:
                try:
                    await upstream.close()
                except Exception:
                    pass

        async def upstream_to_client() -> None:
            try:
                async for message in upstream:
                    if isinstance(message, (bytes, bytearray)):
                        await client_ws.send_bytes(message)
                    else:
                        await client_ws.send_text(str(message))
            except Exception:
                pass
            finally:
                try:
                    await client_ws.close()
                except Exception:
                    pass

        await asyncio.gather(client_to_upstream(), upstream_to_client())
