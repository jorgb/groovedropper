import io

import numpy as np
import soundfile as sf

from groove.audio_common import render_waveform_png

EXTENSIONS = ('.wav',)
MIME_TYPE = 'audio/wav'


def generate_waveform(path, width=1024, height=204):
    info = sf.info(path)
    frames = info.frames
    if frames == 0:
        return None
    block_size = max(1, frames // width)
    mins = np.zeros(width)
    maxs = np.zeros(width)
    with sf.SoundFile(path) as f:
        for i in range(width):
            data = f.read(block_size)
            if len(data) == 0:
                break
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            mins[i] = np.min(data)
            maxs[i] = np.max(data)
    return render_waveform_png(mins, maxs, width, height)


def make_audio_slice(path, start_offset, samplerate, duration_secs=10):
    info = sf.info(path)
    data, sr = sf.read(path, start=start_offset, frames=int(duration_secs * samplerate))
    buf = io.BytesIO()
    sf.write(buf, data, sr, subtype=info.subtype, format='WAV')
    buf.seek(0)
    return buf
