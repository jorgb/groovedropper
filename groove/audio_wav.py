import io

import numpy as np
import soundfile as sf

from groove.audio_common import CUT_WRITE_BUFFER, cut_window, render_waveform_png

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


def generate_cut_waveform(path, begin_offset, width=560, height=90):
    """Waveform PNG centred on begin_offset, reading only the zoom window."""
    info   = sf.info(path)
    total  = info.frames
    w_start, w_end = cut_window(total, begin_offset)
    window = w_end - w_start

    block_size = max(1, window // width)
    mins = np.zeros(width)
    maxs = np.zeros(width)

    with sf.SoundFile(path) as f:
        f.seek(w_start)
        for i in range(width):
            data = f.read(block_size)
            if len(data) == 0:
                break
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            mins[i] = data.min()
            maxs[i] = data.max()

    cut_px = int((begin_offset - w_start) / max(1, window) * width)
    return render_waveform_png(mins, maxs, width, height, cut_px=cut_px)


def save_slice_wav(src_path, dest_path, start_frame, end_frame):
    """Stream-copy frames [start_frame, end_frame) to a new 16-bit PCM WAV file."""
    with sf.SoundFile(src_path) as src:
        src.seek(start_frame)
        with sf.SoundFile(dest_path, mode='w',
                          samplerate=src.samplerate,
                          channels=src.channels,
                          subtype='PCM_16') as dst:
            remaining = end_frame - start_frame
            while remaining > 0:
                data = src.read(min(CUT_WRITE_BUFFER, remaining))
                if len(data) == 0:
                    break
                dst.write(data)
                remaining -= len(data)


def make_audio_slice(path, start_offset, samplerate, duration_secs=10):
    info = sf.info(path)
    data, sr = sf.read(path, start=start_offset, frames=int(duration_secs * samplerate))
    buf = io.BytesIO()
    sf.write(buf, data, sr, subtype=info.subtype, format='WAV')
    buf.seek(0)
    return buf
