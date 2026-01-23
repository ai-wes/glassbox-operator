import asyncio
from dataclasses import dataclass
from io import BytesIO


@dataclass
class TtsSettings:
    enabled: bool
    lang: str
    tld: str
    slow: bool


class TtsService:
    def __init__(self, settings: TtsSettings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()

    def _synthesize_sync(self, text: str) -> bytes:
        if not text:
            return b""
        from gtts import gTTS

        audio = gTTS(text=text, lang=self.settings.lang, tld=self.settings.tld, slow=self.settings.slow)
        buffer = BytesIO()
        audio.write_to_fp(buffer)
        return buffer.getvalue()

    async def synthesize(self, text: str) -> bytes:
        async with self._lock:
            return await asyncio.to_thread(self._synthesize_sync, text)
