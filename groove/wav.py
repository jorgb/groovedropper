import io
import logging

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)


def generate_waveform(wav_path, width=1024, height=204):
    try:
        info = sf.info(wav_path)
        frames = info.frames
        if frames == 0:
            return None

        # One block per output pixel; record min/max amplitude for each column.
        block_size = max(1, frames // width)
        mins = np.zeros(width)
        maxs = np.zeros(width)

        with sf.SoundFile(wav_path) as f:
            for i in range(width):
                data = f.read(block_size)
                if len(data) == 0:
                    break
                if data.ndim > 1:
                    data = np.mean(data, axis=1)
                mins[i] = np.min(data)
                maxs[i] = np.max(data)

        img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        half_h = height / 2
        for i in range(width):
            y_min = int(half_h - (maxs[i] * half_h))
            y_max = int(half_h - (mins[i] * half_h))
            if y_min == y_max:
                y_max += 1
            draw.line([(i, y_min), (i, y_max)], fill=(255, 255, 255, 255))

        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()
    except Exception as e:
        logger.error(f"Error generating waveform for {wav_path}: {e}")
        return None


def make_audio_slice(path, start_offset, samplerate, duration_secs=10):
    """Return a BytesIO WAV buffer for duration_secs seconds starting at start_offset (samples)."""
    info = sf.info(path)
    data, sr = sf.read(path, start=start_offset, frames=int(duration_secs * samplerate))
    buf = io.BytesIO()
    sf.write(buf, data, sr, subtype=info.subtype, format='WAV')
    buf.seek(0)
    return buf
