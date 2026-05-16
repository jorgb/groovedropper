import logging
import os

from groove import audio_mp3, audio_wav

logger = logging.getLogger(__name__)

_MODULES = (audio_wav, audio_mp3)

_HANDLERS = {ext: mod for mod in _MODULES for ext in mod.EXTENSIONS}

SUPPORTED_EXTENSIONS = tuple(_HANDLERS)
MIME_BY_EXT = {ext: mod.MIME_TYPE for mod in _MODULES for ext in mod.EXTENSIONS}


def _handler(path):
    ext = os.path.splitext(path)[1].lower()
    mod = _HANDLERS.get(ext)
    if mod is None:
        raise ValueError(f"Unsupported audio format: {ext!r}")
    return mod


def generate_waveform(path, width=1024, height=204):
    try:
        return _handler(path).generate_waveform(path, width, height)
    except Exception as e:
        logger.error(f"Error generating waveform for {path}: {e}")
        return None


def get_audio_info(path):
    return _handler(path).get_audio_info(path)


def make_audio_slice(path, start_offset, samplerate, duration_secs=10):
    return _handler(path).make_audio_slice(path, start_offset, samplerate, duration_secs)
