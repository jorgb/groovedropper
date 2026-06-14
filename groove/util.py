import hashlib


def compute_digest(file_path):
    # Full-file MD5 so that re-encoded copies of the same audio are detected
    # as duplicates even when they live at a different path.
    hasher = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            hasher.update(chunk)
    return hasher.hexdigest()
