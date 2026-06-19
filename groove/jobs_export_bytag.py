import csv
import io
import json
import logging
import os
import zipfile

logger = logging.getLogger(__name__)


def run(payload: dict) -> bytes:
    manifest_path = payload.get('manifest_path')
    preserve_paths = bool(payload.get('preserve_paths', False))

    samples = []
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            samples = json.load(f)
    finally:
        if manifest_path and os.path.exists(manifest_path):
            try:
                os.unlink(manifest_path)
            except OSError:
                logger.warning("export_bytag: could not remove temp file %s", manifest_path)

    logger.info("export_bytag: %d samples to export, preserve_paths=%s", len(samples), preserve_paths)

    used_names     = set()
    exported_paths = []
    error_paths    = []
    csv_rows       = []

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for sample in samples:
            path        = sample['path']
            name        = sample['name']
            size        = sample['size']
            folder_path = sample.get('folder_path')
            labels      = sample.get('labels', [])

            zip_name = _zip_entry_name(path, name, folder_path, preserve_paths)
            zip_name = _unique_name(zip_name, used_names)
            used_names.add(zip_name)

            try:
                with open(path, 'rb') as f:
                    data = f.read()
                zf.writestr(zip_name, data)
                exported_paths.append(path)
                csv_rows.append((path, name, ','.join(labels), str(size)))
                logger.info("export_bytag: packed %s as %s", path, zip_name)
            except FileNotFoundError:
                logger.info("export_bytag: file not found, skipping: %s", path)
            except Exception as exc:
                logger.warning("export_bytag: error exporting %s: %s", path, exc)
                error_paths.append(path)

        # export.txt — full paths of all successfully exported samples
        txt = '\n'.join(exported_paths)
        if txt:
            txt += '\n'
        zf.writestr('export.txt', txt.encode('utf-8'))

        # export.csv
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf, quoting=csv.QUOTE_ALL)
        writer.writerow(['Path', 'Filename', 'Labels', 'Size'])
        for row in csv_rows:
            writer.writerow(row)
        zf.writestr('export.csv', csv_buf.getvalue().encode('utf-8'))

        # errors.txt — only if there were errors
        if error_paths:
            err = '\n'.join(error_paths) + '\n'
            zf.writestr('errors.txt', err.encode('utf-8'))

    zip_buf.seek(0)
    logger.info(
        "export_bytag: done — %d exported, %d errors",
        len(exported_paths), len(error_paths),
    )
    return zip_buf.read()


def _zip_entry_name(path, name, folder_path, preserve_paths):
    if preserve_paths and folder_path:
        # Strip the scan-folder prefix; keep only the relative remainder
        prefix = folder_path.rstrip('/\\') + os.sep
        if path.startswith(prefix):
            rel = path[len(prefix):].replace('\\', '/')
            if rel:
                return rel
    return name


def _unique_name(name, used):
    if name not in used:
        return name
    # Split into stem and extension, handling paths with directories
    base_name = os.path.basename(name)
    dir_part  = name[: len(name) - len(base_name)]
    root, ext = os.path.splitext(base_name)
    i = 2
    while True:
        candidate = f"{dir_part}{root}_{i}{ext}"
        if candidate not in used:
            return candidate
        i += 1
