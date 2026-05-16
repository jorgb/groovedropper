import io

import miniaudio
import numpy as np
import soundfile as sf

from groove.audio_common import render_waveform_png

EXTENSIONS = ('.mp3',)
MIME_TYPE = 'audio/mpeg'


def generate_waveform(path, width=1024, height=204):
    decoded = miniaudio.decode_file(
        path,
        output_format=miniaudio.SampleFormat.FLOAT32,
        nchannels=1,
    )
    frames = decoded.num_frames
    if frames == 0:
        return None
    samples = np.frombuffer(decoded.samples, dtype=np.float32)
    block_size = max(1, frames // width)
    mins = np.zeros(width)
    maxs = np.zeros(width)
    for i in range(width):
        block = samples[i * block_size:(i + 1) * block_size]
        if len(block) == 0:
            break
        mins[i] = np.min(block)
        maxs[i] = np.max(block)
    return render_waveform_png(mins, maxs, width, height)


def make_audio_slice(path, start_offset, samplerate, duration_secs=10):
    decoded = miniaudio.decode_file(
        path,
        output_format=miniaudio.SampleFormat.FLOAT32,
        sample_rate=samplerate,
    )
    nch = decoded.nchannels
    samples = np.frombuffer(decoded.samples, dtype=np.float32)
    start_sample = start_offset * nch
    end_sample = start_sample + int(duration_secs * samplerate) * nch
    sliced = samples[start_sample:end_sample]
    data = sliced.reshape(-1, nch) if nch > 1 else sliced
    buf = io.BytesIO()
    sf.write(buf, data, decoded.sample_rate, subtype='PCM_16', format='WAV')
    buf.seek(0)
    return buf
