import logging
import time

import librosa
import numpy as np

from groove import audio

logger = logging.getLogger(__name__)

HOP_LENGTH       = 512
N_FFT            = 2048
FRAME_BLOCK_SIZE = 64       # librosa frames per streaming block (~0.74 s at 44.1 kHz)
SILENCE_THRESH   = 0.001    # skip blocks whose peak amplitude is below this
PRE_RAMP         = 441      # 10 ms look-back to catch kick/snare onset ramps

# delta=0.07 keeps quiet hi-hats; delta=0.35 passes only kicks/snares/chord hits.
# high_cut_hz=8000 zeros STFT bins above 8 kHz, removing hi-hat spectral energy.
_ALL      = dict(delta=0.07, wait=4, high_cut_hz=None)
_BIG_ONLY = dict(delta=0.35, wait=8, high_cut_hz=8000)


def _onset_env(y_mono, sr, high_cut_hz=None):
    mag = np.abs(librosa.stft(y_mono, n_fft=N_FFT, hop_length=HOP_LENGTH))
    if high_cut_hz is not None:
        cut_bin = int(high_cut_hz / (sr / N_FFT))
        mag[cut_bin:, :] = 0.0
    return librosa.onset.onset_strength(
        sr=sr,
        S=librosa.amplitude_to_db(mag, ref=np.max),
        hop_length=HOP_LENGTH,
    )


def _pick_peaks(onset_env, delta=0.07, wait=4):
    return librosa.util.peak_pick(
        onset_env,
        pre_max=3,
        post_max=3,
        pre_avg=5,
        post_avg=5,
        delta=delta,
        wait=wait,
    )


def _pre_ramp_adjust(y_mono, peak_sample, block_start):
    """Walk back up to PRE_RAMP samples to where the signal first rose above noise."""
    local = min(peak_sample - block_start, len(y_mono) - 1)
    peak_amp = float(np.max(np.abs(y_mono[max(0, local - 512):local + 1])))
    threshold = peak_amp * 0.01
    for i in range(local, max(0, local - PRE_RAMP), -1):
        if abs(float(y_mono[i])) <= threshold:
            return block_start + i
    return peak_sample


def _zero_cross_snap(y_mono, candidate_sample, block_start, search_back=1024):
    """Snap candidate backwards to the nearest zero crossing."""
    local = min(candidate_sample - block_start, len(y_mono) - 1)
    for i in range(local, max(0, local - search_back), -1):
        if abs(float(y_mono[i])) < 1e-4:
            return block_start + i
    return candidate_sample


def find_transient(file_path, start_sample, big_only=False):
    """Find the next significant onset after start_sample using block streaming.

    Detects kicks, snares, hi-hats, and chord changes via log-frequency spectral
    flux.  Silent blocks are skipped automatically so the search continues through
    silence until a transient is found or EOF is reached.

    big_only=True raises the detection threshold and cuts high frequencies so
    that only kicks, snares, and strong chord hits are returned (hi-hats skipped).

    Returns {"found": True, "transient_sample": <int>, "zero_crossing_sample": <int>}
    or      {"found": False}.
    """
    cfg = _BIG_ONLY if big_only else _ALL
    mode = "big-only" if big_only else "all"

    if big_only:
        file_sr, _ = audio.get_audio_info(file_path)
        frame_block_size = max(FRAME_BLOCK_SIZE, -(-int(6.0 * file_sr) // HOP_LENGTH))  # ceil div
    else:
        frame_block_size = FRAME_BLOCK_SIZE

    logger.info("transient search start  file=%s sample=%d mode=%s block_frames=%d",
                file_path, start_sample, mode, frame_block_size)
    t0 = time.monotonic()
    try:
        for block_start, sr, y_mono in audio.iter_blocks(
            file_path, start_sample, frame_block_size, HOP_LENGTH, N_FFT
        ):
            if np.max(np.abs(y_mono)) < SILENCE_THRESH:
                continue

            onset_env = _onset_env(y_mono, sr, high_cut_hz=cfg['high_cut_hz'])
            peaks = _pick_peaks(onset_env, delta=cfg['delta'], wait=cfg['wait'])

            for frame_idx in peaks:
                peak_sample = block_start + int(frame_idx) * HOP_LENGTH
                if peak_sample <= start_sample:
                    continue
                adjusted = _pre_ramp_adjust(y_mono, peak_sample, block_start)
                zc = _zero_cross_snap(y_mono, adjusted, block_start)
                elapsed = time.monotonic() - t0
                logger.info(
                    "transient search done   found=True sample=%d zc=%d elapsed=%.3fs",
                    int(peak_sample), int(zc), elapsed,
                )
                return {
                    "found": True,
                    "transient_sample": int(peak_sample),
                    "zero_crossing_sample": int(zc),
                }

        elapsed = time.monotonic() - t0
        logger.info("transient search done   found=False elapsed=%.3fs", elapsed)
        return {"found": False}
    except Exception:
        elapsed = time.monotonic() - t0
        logger.exception("transient search failed file=%s elapsed=%.3fs", file_path, elapsed)
        return {"found": False}
