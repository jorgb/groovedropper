import io

import numpy as np
from PIL import Image, ImageDraw

CUT_WAVEFORM_ZOOM = 1.5    # visible window = total_frames / zoom (1 = full file)
CUT_WRITE_BUFFER  = 65536  # frames per streaming read/write chunk (~1.5 s at 44.1 kHz)


def cut_window(total_frames, begin_offset):
    """Return (w_start, w_end) centred on begin_offset with CUT_WAVEFORM_ZOOM applied."""
    window  = int(total_frames / CUT_WAVEFORM_ZOOM)
    half    = window // 2
    w_start = begin_offset - half
    w_end   = begin_offset + half
    if w_start < 0:
        w_start, w_end = 0, min(total_frames, window)
    elif w_end > total_frames:
        w_start, w_end = max(0, total_frames - window), total_frames
    return w_start, w_end


def render_waveform_png(mins, maxs, width, height, cut_px=None):
    """Render a pre-computed mins/maxs waveform to a PNG byte string.

    If cut_px is given, a dashed vertical line is drawn at that x position.
    """
    img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    half_h = height / 2
    for i in range(width):
        y_min = int(half_h - (maxs[i] * half_h))
        y_max = int(half_h - (mins[i] * half_h))
        if y_min == y_max:
            y_max += 1
        draw.line([(i, y_min), (i, y_max)], fill=(255, 255, 255, 255))
    if cut_px is not None:
        dash_color = (255, 87, 34, 255)
        for y in range(0, height, 6):
            draw.line([(cut_px, y), (cut_px, y + 3)], fill=dash_color, width=2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()
