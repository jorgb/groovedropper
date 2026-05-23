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


def get_audio_info(path):
    mi = miniaudio.get_file_info(path)
    return mi.sample_rate, mi.num_frames


def iter_blocks(path, start_sample, frame_block_size=64, hop_length=512, n_fft=2048):
    """Yield (block_start_sample, sr, y_mono_float32) for streaming onset detection.

    Decodes the MP3 once to a flat float32 array (miniaudio does not expose
    true streaming with arbitrary seek), then slices it into overlapping blocks
    that match what librosa.stream would produce for WAV.
    """
    decoded = miniaudio.decode_file(
        path,
        output_format=miniaudio.SampleFormat.FLOAT32,
        nchannels=1,
    )
    sr = decoded.sample_rate
    samples = np.frombuffer(decoded.samples, dtype=np.float32)
    total = len(samples)

    step = frame_block_size * hop_length
    block_size = n_fft + (frame_block_size - 1) * hop_length
    offset = max(0, start_sample)

    while offset < total:
        y_block = samples[offset:offset + block_size]
        if len(y_block) < n_fft:
            break
        yield offset, sr, y_block
        offset += step


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
