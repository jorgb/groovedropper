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


def get_audio_info(path):
    info = sf.info(path)
    return info.samplerate, info.frames


def iter_blocks(path, start_sample, frame_block_size=64, hop_length=512, n_fft=2048):
    """Yield (block_start_sample, sr, y_mono_float32) for streaming onset detection.

    Uses librosa.stream for true block-by-block I/O; no full-file decode.
    """
    import librosa
    info = sf.info(path)
    sr = info.samplerate
    offset_secs = max(0, start_sample) / sr
    overlap = n_fft - hop_length
    global_offset = max(0, start_sample)

    stream = librosa.stream(
        path,
        block_length=frame_block_size,
        frame_length=n_fft,
        hop_length=hop_length,
        mono=True,
        offset=offset_secs,
    )
    for y_block in stream:
        yield global_offset, sr, y_block
        global_offset += len(y_block) - overlap


def make_audio_slice(path, start_offset, samplerate, duration_secs=10):
    info = sf.info(path)
    data, sr = sf.read(path, start=start_offset, frames=int(duration_secs * samplerate))
    buf = io.BytesIO()
    sf.write(buf, data, sr, subtype=info.subtype, format='WAV')
    buf.seek(0)
    return buf
