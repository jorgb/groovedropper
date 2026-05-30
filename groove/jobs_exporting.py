import io
import zipfile
import logging
import soundfile as sf
from groove import audio

logger = logging.getLogger(__name__)


def _fmt(n: int) -> str:
    return f'{int(n):08d}'


def run(payload: dict) -> bytes:
    path             = payload['path']
    duration_samples = int(payload['duration_samples'])
    start_offset     = int(payload.get('start_offset', 0))
    samplerate       = int(payload.get('samplerate', 44100))
    markers          = [int(m) for m in payload.get('markers', [])]
    stem             = payload.get('stem', 'export')

    if not markers:
        buf = audio.make_audio_slice(path, start_offset, samplerate)
        return buf.read()

    # Multi-marker: ZIP of all inter-marker slices
    boundaries = [0] + markers + [duration_samples]
    regions    = [(boundaries[i], boundaries[i + 1]) for i in range(len(boundaries) - 1)]

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for start, end in regions:
            slice_name = f'{stem}-{_fmt(start)}-{_fmt(end - 1)}.wav'
            region_buf = io.BytesIO()
            with sf.SoundFile(path) as src:
                src.seek(start)
                data = src.read(end - start)
            sf.write(region_buf, data, samplerate, subtype='PCM_16', format='WAV')
            region_buf.seek(0)
            zf.writestr(slice_name, region_buf.read())
            logger.info("Export: packed %s (%d–%d)", slice_name, start, end)
    zip_buf.seek(0)
    return zip_buf.read()
