import os
import hashlib
from dataclasses import dataclass
from typing import Optional


def compute_digest(file_path):
    # Full-file MD5 so that re-encoded copies of the same audio are detected
    # as duplicates even when they live at a different path.
    hasher = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


@dataclass
class SampleMeta:
    size: int
    mtime: float
    digest: str
    samplerate: int
    duration_samples: int
    duration: float
    waveform: Optional[bytes]


def get_sample_meta(wav_path) -> SampleMeta:
    """Compute all metadata needed to insert a sample into the DB.
    WARNING: performance heavy method, because of the digest calculation.

    Thread-safe: reads files only, no shared mutable state.
    """
    from groove import audio  # local import to avoid circular dependency at module level
    stat = os.stat(wav_path)
    digest = compute_digest(wav_path)
    samplerate, duration_samples = audio.get_audio_info(wav_path)
    duration = duration_samples / samplerate if samplerate > 0 else 0
    waveform = audio.generate_waveform(wav_path)
    return SampleMeta(
        size=stat.st_size,
        mtime=stat.st_mtime,
        digest=digest,
        samplerate=samplerate,
        duration_samples=duration_samples,
        duration=duration,
        waveform=waveform,
    )
