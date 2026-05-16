import io

import numpy as np
from PIL import Image, ImageDraw


def render_waveform_png(mins, maxs, width, height):
    """Render a pre-computed mins/maxs waveform to a PNG byte string."""
    img = Image.new('RGBA', (width, height), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    half_h = height / 2
    for i in range(width):
        y_min = int(half_h - (maxs[i] * half_h))
        y_max = int(half_h - (mins[i] * half_h))
        if y_min == y_max:
            y_max += 1
        draw.line([(i, y_min), (i, y_max)], fill=(255, 255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()
