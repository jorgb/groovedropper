import re


def strip_suffix(base: str) -> str:
    """Remove a trailing -XXXXXXXX-XXXXXXXX slice suffix, collapsing to -XXXXXXXX."""
    if re.search(r'-\d{8}-\d{8}$', base):
        return re.sub(r'-\d{8}-(\d{8})$', r'-\1', base)
    return base


def fmt_offset(n: int) -> str:
    return f'{int(n):08d}'
