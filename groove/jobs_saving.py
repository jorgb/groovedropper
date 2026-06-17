import io
import os
import zipfile
import logging
import soundfile as sf
from groove import audio
from groove.jobs_util import fmt_offset, strip_suffix

logger = logging.getLogger(__name__)


def run(payload: dict) -> bytes:
    path             = payload['path']
    duration_samples = int(payload['duration_samples'])
    start_offset     = int(payload.get('start_offset', 0))
    end_offset       = int(payload.get('end_offset', duration_samples))
    samplerate       = int(payload.get('samplerate', 44100))
    markers          = [int(m) for m in payload.get('markers', [])]
    stem             = strip_suffix(payload.get('stem', 'export'))
    raw_original     = bool(payload.get('raw_original', False))
    include_original = bool(payload.get('include_original', False))

    # Shift+S, no markers: return original file bytes as-is (no conversion)
    if raw_original:
        with open(path, 'rb') as f:
            return f.read()

    if not markers:
        # S (no shift): single WAV from start_offset to end_offset
        buf = audio.make_audio_slice(path, start_offset, samplerate, end_offset)
        return buf.read()

    # Multi-marker ZIP: all inter-marker slices
    boundaries = [0] + markers + [duration_samples]
    regions    = [(boundaries[i], boundaries[i + 1]) for i in range(len(boundaries) - 1)]

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for start, end in regions:
            slice_name = f'{stem}-{fmt_offset(start)}-{fmt_offset(end - 1)}.wav'
            region_buf = io.BytesIO()
            with sf.SoundFile(path) as src:
                src.seek(start)
                data = src.read(end - start)
            sf.write(region_buf, data, samplerate, subtype='PCM_16', format='WAV')
            region_buf.seek(0)
            zf.writestr(slice_name, region_buf.read())
            logger.info("Export: packed %s (%d–%d)", slice_name, start, end)
        # Shift+S with markers: also bundle the original file unaltered
        if include_original:
            original_name = os.path.basename(path)
            with open(path, 'rb') as f:
                zf.writestr(original_name, f.read())
            logger.info("Export: packed original %s", original_name)
    zip_buf.seek(0)
    return zip_buf.read()
