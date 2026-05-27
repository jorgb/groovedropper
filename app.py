import os
import re
import sys
from pathlib import Path
import time
import argparse
import socket
import sqlite3
import io
import random
import webbrowser
import logging
import traceback
from threading import Thread
from queue import Empty, Queue

from flask import Flask, render_template, request, send_file, jsonify
from groove import db, audio, transient as _transient
from groove.db import DatabaseTooNewError
from groove.queue import scan_queue

HTTP_DEBUG = False

# ---------------------------------------------------------------------------
# Background rename queue — retries file renames that Windows locks temporarily
# ---------------------------------------------------------------------------
_rename_queue: Queue = Queue()

def _rename_worker():
    """Daemon thread: retries os.rename() for files locked by sync agents.

    Items are (src_path, bak_path, deadline_monotonic).  Retries every second
    until the deadline (60 s).  If it still fails, logs a warning and gives up —
    the file keeps its original name but is already removed from the DB.
    """
    while True:
        src, bak, deadline = _rename_queue.get()
        renamed = False
        while time.monotonic() < deadline:
            try:
                if os.path.exists(src):
                    os.rename(src, bak)
                    logger.info("Background rename done: %s → %s", src, bak)
                renamed = True
                break
            except PermissionError:
                time.sleep(1.0)
        if not renamed:
            logger.warning("Background rename timed out after 60 s — file left as-is: %s", src)

        _rename_queue.task_done()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
if not HTTP_DEBUG:
    logging.getLogger('werkzeug').setLevel(logging.WARNING)


def _resource(relative_path):
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative_path)


def get_version() -> str:
    try:
        with open(_resource('VERSION')) as f:
            return f.read().strip()
    except Exception:
        return 'dev'


app = Flask(__name__,
            template_folder=_resource('templates'),
            static_folder=_resource('static'))


ALLOWED_CONFIG_KEYS = frozenset({'theme', 'loop', 'controls-folded', 'offset-preview', 'quick-pick-preset', 'quick-play-instantly'})



def scan_worker():
    logger.info("Starting background scan worker...")
    conn = db.open_connection()
    cursor = conn.cursor()

    # TODO: delete old entries from the table "sample" that are not on disk anymore
    # - use logger.info() to notify every sample that is removed
    # - make sure that the foreign key constraints are in place
    # - after that start the scan worker as below

    reported_done = False
    try:
        while True:
            try:
                folder_path = scan_queue.pop_folder(timeout=1.0)
                scan_queue.set_scanning_folder(folder_path)
                logger.info(f"Scanning: {folder_path}")

                # Look up folder_id once per folder before walking
                folder_id = db.scan_get_folder_id(cursor, folder_path)

                # Remove DB entries for files that no longer exist on disk
                if folder_id is not None:
                    for sample_path in db.scan_fetch_samples_by_folder_id(cursor, folder_id):
                        if not os.path.exists(sample_path):
                            logger.info(f"Removing missing sample from database: {sample_path}")
                            db.scan_delete_sample_by_path(cursor, sample_path)
                    conn.commit()
                else:
                    logger.info(f"Orphaned sample: {sample_path}")

                for root, _, files in os.walk(folder_path):
                    for file in files:
                        if file.lower().endswith(audio.SUPPORTED_EXTENSIONS):
                            wav_path = os.path.join(root, file)
                            scan_queue.push_sample(wav_path, folder_id)

                while scan_queue.has_samples():
                    wav_path, fid = scan_queue.pop_sample()

                    try:
                        stat = os.stat(wav_path)
                        mtime = stat.st_mtime
                        size = stat.st_size

                        # Fast path: skip if path+mtime unchanged
                        existing_ts = db.scan_get_sample_timestamp(cursor, wav_path)
                        if existing_ts is not None:
                            if existing_ts == mtime:
                                continue
                            db.scan_delete_sample_by_path(cursor, wav_path)

                        digest = db.compute_digest(wav_path)

                        # Digest duplicate check: same content already indexed at another path
                        if db.scan_check_digest_exists(cursor, digest):
                            logger.info(f"Duplicate wave file found, skipped: {wav_path}")
                            continue

                        reported_done = False
                        samplerate, duration_samples = audio.get_audio_info(wav_path)
                        duration = duration_samples / samplerate if samplerate > 0 else 0

                        waveform_img = audio.generate_waveform(wav_path)

                        db.scan_insert_sample(
                            cursor, wav_path, os.path.basename(wav_path), os.path.dirname(wav_path),
                            size, digest, mtime, duration, samplerate, duration_samples, waveform_img, fid
                        )

                        conn.commit()

                    except Exception as e:
                        logger.error(f"Failed to process {wav_path}: {e}")
                    finally:
                        scan_queue.sample_done()

                scan_queue.folder_done()
                scan_queue.reset()

            except Empty:
                if scan_queue.is_idle():
                    scan_queue.set_scanning_folder(None)
                    if not reported_done:
                        reported_done = True
                        logger.info("Scanning done ...")
                time.sleep(5)
    finally:
        conn.close()


def start_background_scan():
    with db.get_db() as conn:
        folders = db.fetch_scan_folder_paths(conn)

    for folder_path in folders:
        scan_queue.push_folder(folder_path)

    if folders:
        logger.info(f"Queued {len(folders)} folder(s) for scanning.")
    else:
        logger.info("No scan folders configured. Add folders via the web UI.")

    scan_queue.start(len(folders))
    Thread(target=scan_worker,  daemon=True).start()
    Thread(target=_rename_worker, daemon=True).start()


def get_random_offset(duration_samples, samplerate):
    # 200ms seconds play time margin for randomization
    play_time = 0.2 * samplerate
    max_start = max(0, duration_samples - play_time) if duration_samples >= play_time else duration_samples
    return random.randint(0, int(max_start))


# ---------------------------------------------------------------------------
# Core routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/config', methods=['GET'])
def get_config():
    with db.get_db() as conn:
        return jsonify(db.fetch_config(conn))


@app.route('/api/config', methods=['POST'])
def set_config():
    data = request.get_json(force=True) or {}
    invalid = set(data.keys()) - ALLOWED_CONFIG_KEYS
    if invalid:
        return jsonify({"error": f"Unknown config keys: {sorted(invalid)}"}), 400
    with db.get_db() as conn:
        db.save_config(conn, data)
    return jsonify({"status": "ok"})


@app.route('/api/info')
def get_info():
    return jsonify({
        "db_path": db.DB_FILE,
        "version": get_version(),
        "mutable": app.config.get('MUTABLE', False),
    })


@app.route('/api/stats')
def stats():
    with db.get_db() as conn:
        count = db.fetch_sample_count(conn)

    snap = scan_queue.snapshot()
    return jsonify({
        "total_samples": count or 0,
        "total_folders": snap["total_folders"],
        "folders_queued": snap["folders_queued"],
        "total_wavs": snap["total_samples"],
        "wavs_queued": snap["samples_queued"],
        "is_scanning": snap["is_active"],
    })


@app.route('/api/samples/untagged-count')
def untagged_count():
    with db.get_db() as conn:
        count = db.fetch_untagged_sample_count(conn)
    return jsonify({'count': count})


@app.route('/api/sample/random', methods=['POST'])
def random_sample():
    data = request.get_json(silent=True) or {}
    sample_id_override = data.get('sample_id')
    randomize_only = data.get('randomize_only', False)
    untagged_only = data.get('untagged_only', False)
    label_ids = data.get('label_ids') or []
    filter_mode = data.get('filter_mode', 'OR')

    with db.get_db() as conn:
        if sample_id_override:
            row = db.fetch_sample_by_id(conn, sample_id_override)
            if not row:
                return jsonify({"error": "Specified sample not found"}), 404
        elif untagged_only:
            row = db.fetch_random_untagged_sample(conn)
            if not row:
                return jsonify({"error": "no_samples"})
        elif label_ids:
            row = db.fetch_random_sample(conn, label_ids, filter_mode)
            if not row:
                return jsonify({"error": "no_samples"})
        else:
            row = db.fetch_random_sample(conn)
            if not row:
                return jsonify({"error": "No samples found"}), 404

        start_offset = get_random_offset(row['duration_samples'], row['samplerate'])
        index_num = db.fetch_sample_index(conn, row['id'])

    result = dict(row)
    result['index_num'] = index_num
    result['start_offset'] = start_offset
    result['randomize_only'] = randomize_only
    return jsonify(result)


@app.route('/api/sample/index/<int:index_num>', methods=['GET'])
def get_sample_by_index(index_num):
    with db.get_db() as conn:
        total_count = db.fetch_sample_total(conn)

        if index_num < 1 or index_num > total_count:
            return jsonify({"error": "Index out of bounds"}), 400

        row = db.fetch_sample_at_offset(conn, index_num)
        if not row:
            return jsonify({"error": "Sample not found"}), 404

    result = dict(row)
    result['index_num'] = index_num
    result['start_offset'] = 0
    return jsonify(result)


@app.route('/api/sample/digest/<digest>', methods=['GET'])
def get_sample_by_digest(digest):
    start_offset_param = request.args.get('start', type=int, default=0)

    with db.get_db() as conn:
        row = db.fetch_sample_by_digest(conn, digest)
        if not row:
            return jsonify({"error": "Sample not found"}), 404

        start_offset = start_offset_param if 0 <= start_offset_param <= row['duration_samples'] else 0
        index_num = db.fetch_sample_index(conn, row['id'])

    result = dict(row)
    result['index_num'] = index_num
    result['start_offset'] = start_offset
    return jsonify(result)


@app.route('/waveform/<int:sample_id>')
def waveform(sample_id):
    with db.get_db() as conn:
        row = db.fetch_waveform(conn, sample_id)

    if row and row['waveform']:
        return send_file(io.BytesIO(row['waveform']), mimetype='image/png')
    return send_file(_resource('static/img/waveform_placeholder.png'), mimetype='image/png')


@app.route('/audio/<int:sample_id>')
def serve_audio(sample_id):
    with db.get_db() as conn:
        row = db.fetch_sample_path(conn, sample_id)

    if row and row['path'] and os.path.exists(row['path']):
        ext = os.path.splitext(row['path'])[1].lower()
        mimetype = audio.MIME_BY_EXT.get(ext, 'audio/wav')
        return send_file(row['path'], conditional=True, mimetype=mimetype)
    return "Not found", 404


@app.route('/api/find_transient', methods=['POST'])
def api_find_transient():
    data = request.get_json(silent=True) or {}
    sample_id    = data.get('sample_id')
    start_sample = int(data.get('start_sample', 0))
    big_only     = bool(data.get('big_only', False))

    if sample_id is None:
        return jsonify({"error": "sample_id required"}), 400

    with db.get_db() as conn:
        row = db.fetch_sample_path(conn, sample_id)

    if not row or not row['path'] or not os.path.exists(row['path']):
        return jsonify({"error": "sample not found"}), 404

    result = _transient.find_transient(row['path'], start_sample, big_only=big_only)
    return jsonify(result)


@app.route('/api/slice/<int:sample_id>')
def slice_audio(sample_id):
    start_offset = request.args.get('start', type=int, default=0)
    pitch_semi = request.args.get('pitch', type=int, default=0)
    pitch_cents = request.args.get('cents', type=int, default=0)

    with db.get_db() as conn:
        row = db.fetch_sample_path_and_name(conn, sample_id)

    if not row or not os.path.exists(row['path']):
        return "Not found", 404

    samplerate = row['samplerate'] or 44100
    stem = os.path.splitext(row['name'])[0]

    logger.info(f"Exporting with sample rate {samplerate}, offset {start_offset}")

    pitch_suffix = ''
    if pitch_semi != 0 or pitch_cents != 0:
        parts = ''
        if pitch_semi != 0:
            parts += f"{pitch_semi}p"
        if pitch_cents != 0:
            parts += f"{pitch_cents}c"
        pitch_suffix = f"_{parts}"

    try:
        buf = audio.make_audio_slice(row['path'], start_offset, samplerate)
        return send_file(buf, as_attachment=True,
                         download_name=f"{stem}_{start_offset:08d}{pitch_suffix}.wav",
                         mimetype='audio/wav')
    except Exception as e:
        print(traceback.format_exc())
        logger.error(f"Error creating slice: {e}")
        return "Internal error", 500



# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@app.route('/api/quit', methods=['POST'])
def quit_app():
    def _exit():
        time.sleep(0.2)
        os._exit(0)
    Thread(target=_exit, daemon=True).start()
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------

@app.route('/api/samples/refresh', methods=['POST'])
def refresh_samples():
    if scan_queue.is_active():
        return jsonify({"error": "scan_in_progress"}), 409

    with db.get_db() as conn:
        folders = db.fetch_scan_folder_paths(conn)

    for folder_path in folders:
        scan_queue.push_folder(folder_path)

    logger.info(f"Refresh: re-queued {len(folders)} folder(s)")
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

@app.route('/api/labels', methods=['GET'])
def get_labels():
    with db.get_db() as conn:
        rows = db.fetch_labels(conn)
    return jsonify([dict(r) for r in rows])


@app.route('/api/labels', methods=['POST'])
def create_label():
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    with db.get_db() as conn:
        try:
            label_id = db.insert_label(conn, name)
        except sqlite3.IntegrityError:
            return jsonify({"error": "Label already exists"}), 409
        row = db.fetch_label_by_id(conn, label_id)
    result = dict(row)
    result['sample_count'] = 0
    return jsonify(result), 201


@app.route('/api/labels/<int:label_id>/usage', methods=['GET'])
def label_usage(label_id):
    with db.get_db() as conn:
        count = db.fetch_label_usage(conn, label_id)
    return jsonify({"sample_count": count})


@app.route('/api/labels/<int:label_id>', methods=['PATCH'])
def rename_label(label_id):
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    with db.get_db() as conn:
        row = db.update_label(conn, label_id, name)
    if row is None:
        return jsonify({"error": "Label not found"}), 404
    return jsonify(dict(row))


@app.route('/api/labels/<int:label_id>', methods=['DELETE'])
def delete_label(label_id):
    with db.get_db() as conn:
        found = db.delete_label(conn, label_id)
    if not found:
        return jsonify({"error": "Label not found"}), 404
    return jsonify({"status": "ok"})


@app.route('/api/labels/prune-orphans', methods=['POST'])
def prune_orphans():
    with db.get_db() as conn:
        removed = db.prune_orphan_sample_labels(conn)
    return jsonify({"removed": removed})


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------

@app.route('/api/presets', methods=['GET'])
def get_presets():
    with db.get_db() as conn:
        result = db.fetch_presets(conn)
    return jsonify(result)


@app.route('/api/presets/suggest-name', methods=['GET'])
def suggest_preset_name():
    with db.get_db() as conn:
        name = db.suggest_preset_name(conn)
    return jsonify({"name": name})


@app.route('/api/presets', methods=['POST'])
def create_preset():
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    label_ids = data.get('label_ids') or []
    if not name:
        return jsonify({"error": "name required"}), 400
    with db.get_db() as conn:
        try:
            preset_id, labels = db.insert_preset(conn, name, label_ids)
        except sqlite3.IntegrityError:
            return jsonify({"error": "Preset name already exists"}), 409
    return jsonify({"id": preset_id, "name": name, "filter_mode": "OR", "labels": labels}), 201


@app.route('/api/presets/<int:preset_id>', methods=['PATCH'])
def rename_preset(preset_id):
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    with db.get_db() as conn:
        row = db.fetch_preset(conn, preset_id)
        if not row:
            return jsonify({"error": "Preset not found"}), 404
        if row['is_system']:
            return jsonify({"error": "Cannot modify system preset"}), 403
        name = db.update_preset_name(conn, preset_id, name)
    return jsonify({"id": preset_id, "name": name})


@app.route('/api/presets/<int:preset_id>', methods=['DELETE'])
def delete_preset(preset_id):
    with db.get_db() as conn:
        row = db.fetch_preset(conn, preset_id)
        if not row:
            return jsonify({"error": "Preset not found"}), 404
        if row['is_system']:
            return jsonify({"error": "Cannot delete system preset"}), 403
        db.delete_preset(conn, preset_id)
    return jsonify({"status": "ok"})


@app.route('/api/presets/<int:preset_id>/labels/<int:label_id>', methods=['POST'])
def add_preset_label(preset_id, label_id):
    with db.get_db() as conn:
        row = db.fetch_preset(conn, preset_id)
        if not row:
            return jsonify({"error": "Preset not found"}), 404
        if row['is_system']:
            return jsonify({"error": "Cannot modify system preset"}), 403
        db.insert_preset_label(conn, preset_id, label_id)
    return jsonify({"status": "ok"})


@app.route('/api/presets/<int:preset_id>/labels/<int:label_id>', methods=['DELETE'])
def remove_preset_label(preset_id, label_id):
    with db.get_db() as conn:
        row = db.fetch_preset(conn, preset_id)
        if not row:
            return jsonify({"error": "Preset not found"}), 404
        if row['is_system']:
            return jsonify({"error": "Cannot modify system preset"}), 403
        db.delete_preset_label(conn, preset_id, label_id)
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Sample labels
# ---------------------------------------------------------------------------

@app.route('/api/sample/<digest>/labels', methods=['GET'])
def get_sample_labels(digest):
    with db.get_db() as conn:
        rows = db.fetch_sample_labels(conn, digest)
    return jsonify([r['label_id'] for r in rows])


@app.route('/api/sample/<digest>/labels', methods=['POST'])
def add_sample_label(digest):
    data = request.get_json(force=True) or {}
    label_id = data.get('label_id')
    if label_id is None:
        return jsonify({"error": "label_id required"}), 400
    with db.get_db() as conn:
        db.insert_sample_label(conn, digest, label_id)
    return jsonify({"status": "ok"})


@app.route('/api/sample/<digest>/labels/<int:label_id>', methods=['DELETE'])
def remove_sample_label(digest, label_id):
    with db.get_db() as conn:
        db.delete_sample_label(conn, digest, label_id)
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Quick Pick
# ---------------------------------------------------------------------------

@app.route('/api/quickpick/presets', methods=['GET'])
def get_quickpick_presets():
    with db.get_db() as conn:
        rows = db.fetch_quickpick_presets(conn)
    return jsonify([dict(r) for r in rows])


@app.route('/api/quickpick/presets', methods=['POST'])
def create_quickpick_preset():
    import datetime
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        name = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S.') + \
               f'{datetime.datetime.now().microsecond // 1000:03d}'
    with db.get_db() as conn:
        preset_id = db.insert_quickpick_preset(conn, name)
    return jsonify({'id': preset_id, 'name': name}), 201


@app.route('/api/quickpick/presets/<int:preset_id>', methods=['PATCH'])
def rename_quickpick_preset(preset_id):
    data = request.get_json(force=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    with db.get_db() as conn:
        row = db.update_quickpick_preset_name(conn, preset_id, name)
    if row is None:
        return jsonify({"error": "Preset not found"}), 404
    return jsonify(dict(row))


@app.route('/api/quickpick/clone', methods=['POST'])
def clone_quickpick_preset():
    import datetime
    data = request.get_json(force=True) or {}
    source_id = data.get('preset_id')
    if not source_id:
        return jsonify({"error": "preset_id required"}), 400
    with db.get_db() as conn:
        source = conn.execute(
            'SELECT id, name FROM quickpick_presets WHERE id = ?', (source_id,)
        ).fetchone()
        if not source:
            return jsonify({"error": "Preset not found"}), 404
        now = datetime.datetime.now()
        name = now.strftime('%Y-%m-%d %H:%M:%S.') + f'{now.microsecond // 1000:03d}'
        new_id = db.insert_quickpick_preset(conn, name)
        slots = db.fetch_quickpick_slots(conn, source_id)
        for slot_number, slot in slots.items():
            db.upsert_quickpick_slot(
                conn, new_id, int(slot_number),
                slot['digest'], slot['start_offset'],
                slot['pitch_semitones'], slot['pitch_cents'],
            )
    return jsonify({'id': new_id, 'name': name, 'source_name': source['name']}), 201


@app.route('/api/quickpick/presets/<int:preset_id>', methods=['DELETE'])
def delete_quickpick_preset(preset_id):
    with db.get_db() as conn:
        found = db.delete_quickpick_preset(conn, preset_id)
    if not found:
        return jsonify({"error": "Preset not found"}), 404
    return jsonify({"status": "ok"})


@app.route('/api/quickpick/presets/<int:preset_id>/slots', methods=['GET'])
def get_quickpick_slots(preset_id):
    with db.get_db() as conn:
        slots = db.fetch_quickpick_slots(conn, preset_id)
    return jsonify({"slots": slots})


@app.route('/api/quickpick/presets/<int:preset_id>/slots/<int:slot_number>', methods=['PUT'])
def save_quickpick_slot(preset_id, slot_number):
    if slot_number < 1 or slot_number > 10:
        return jsonify({"error": "slot_number must be 1–10"}), 400
    data = request.get_json(force=True) or {}
    digest = data.get('digest')
    if not digest:
        return jsonify({"error": "digest required"}), 400
    start_offset = int(data.get('start_offset', 0))
    pitch_semitones = int(data.get('pitch_semitones', 0))
    pitch_cents = int(data.get('pitch_cents', 0))
    with db.get_db() as conn:
        db.upsert_quickpick_slot(conn, preset_id, slot_number, digest, start_offset, pitch_semitones, pitch_cents)
        slots = db.fetch_quickpick_slots(conn, preset_id)
    return jsonify(slots.get(str(slot_number), {}))


@app.route('/api/quickpick/presets/<int:preset_id>/slots/<int:slot_number>', methods=['DELETE'])
def delete_quickpick_slot(preset_id, slot_number):
    with db.get_db() as conn:
        db.delete_quickpick_slot(conn, preset_id, slot_number)
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Scan folders
# ---------------------------------------------------------------------------

@app.route('/api/mutable/disable', methods=['POST'])
def disable_mutable():
    app.config['MUTABLE'] = False
    logger.info("MUTABLE mode disabled via UI")
    return jsonify({"status": "ok"})


def _archive_file(path, conn, sample_id):
    """Remove sample from DB and queue the file rename to .bak.

    DB delete happens first so the sample disappears from the UI immediately.
    The rename is always handed off to the background _rename_worker so the
    request returns fast and sync agents can't cause a 60-s hang.
    """
    db.delete_sample(conn, sample_id)
    bak = path + '.bak'
    _rename_queue.put((path, bak, time.monotonic() + 60))


@app.route('/api/cut_waveform/<int:sample_id>')
def api_cut_waveform(sample_id):
    begin_offset = int(request.args.get('begin_offset', 0))
    width  = int(request.args.get('width',  560))
    height = int(request.args.get('height',  90))

    with db.get_db() as conn:
        row = db.fetch_sample_path(conn, sample_id)
    if not row or not os.path.exists(row['path']):
        return jsonify({'error': 'not found'}), 404

    result = audio.generate_cut_waveform(row['path'], begin_offset, width, height)
    if result is None:
        return jsonify({'error': 'unsupported format'}), 422
    png_bytes, cut_px = result
    response = send_file(io.BytesIO(png_bytes), mimetype='image/png')
    response.headers['X-Cut-Px'] = str(cut_px)
    return response


@app.route('/api/cut', methods=['POST'])
def api_cut():
    if not app.config.get('MUTABLE', False):
        return jsonify({'error': 'not in mutable mode'}), 403

    data         = request.get_json(silent=True) or {}
    sample_id    = data.get('sample_id')
    begin_offset = int(data.get('begin_offset', 0))
    keep_left    = bool(data.get('keep_left',  False))
    keep_right   = bool(data.get('keep_right', False))
    trash_left   = bool(data.get('trash_left', False))
    trash_right  = bool(data.get('trash_right', False))

    if sample_id is None:
        return jsonify({'error': 'sample_id required'}), 400
    if keep_left and trash_left:
        return jsonify({'error': 'conflicting left actions'}), 400
    if keep_right and trash_right:
        return jsonify({'error': 'conflicting right actions'}), 400

    with db.get_db() as conn:
        row = db.fetch_sample_path(conn, sample_id)
    if not row or not row['path'] or not os.path.exists(row['path']):
        return jsonify({'error': 'sample not found'}), 404

    src_path = row['path']
    toasts   = []
    archived = False

    try:
        orig_name = os.path.basename(src_path)

        if trash_left and trash_right:
            with db.get_db() as conn:
                _archive_file(src_path, conn, sample_id)
            logger.info(f'CUT: Sample {orig_name} will be renamed {orig_name}.bak (trash left + right)')
            toasts.append(f"Left and right are trashed, sample '{orig_name}' is archived")

        else:
            _, total   = audio.get_audio_info(src_path)
            end_sample = total - 1
            base_dir   = os.path.dirname(src_path)
            base       = os.path.splitext(orig_name)[0]
            base       = re.sub(r'-\d{8}-\d{8}$', '', base)

            def fmt(n):
                return f'{int(n):08d}'

            if begin_offset <= 0 and keep_left:
                return jsonify({'error': 'begin_offset is 0 — left side is empty'}), 400
            if begin_offset >= total and keep_right:
                return jsonify({'error': 'begin_offset is at EOF — right side is empty'}), 400

            left_path  = None
            right_path = None

            if keep_left:
                left_name = f'{base}-{fmt(0)}-{fmt(begin_offset - 1)}.wav'
                left_path = os.path.join(base_dir, left_name)

                logger.info(f'CUT: Saving left side of sample: {left_path}')
                audio.save_slice_wav(src_path, left_path, 0, begin_offset)

            if keep_right:
                right_name = f'{base}-{fmt(begin_offset)}-{fmt(end_sample)}.wav'
                right_path = os.path.join(base_dir, right_name)

                logger.info(f'CUT: Saving right side of sample: {right_path}')
                audio.save_slice_wav(src_path, right_path, begin_offset, total)

            if keep_left and keep_right:
                toasts.append(f"Sample '{orig_name}' cut left to '{os.path.basename(left_path)}'")
                toasts.append(f"Sample '{orig_name}' cut right to '{os.path.basename(right_path)}'")
            elif keep_left:
                toasts.append(f"Sample '{orig_name}' cut left to '{os.path.basename(left_path)}'")
            elif keep_right:
                toasts.append(f"Sample '{orig_name}' cut right to '{os.path.basename(right_path)}'")

            with db.get_db() as conn:
                logger.info(f'CUT: Archiving old original sample: {src_path}')
                _archive_file(src_path, conn, sample_id)

            scan_queue.push_folder(base_dir)

    except Exception as exc:
        logger.exception("Cut failed for %s", src_path)
        return jsonify({'error': str(exc)}), 500

    return jsonify({'toasts': toasts, 'archived': True})


@app.route('/api/sample/<digest>/archive', methods=['POST'])
def archive_sample(digest):
    if not app.config.get('MUTABLE', False):
        return jsonify({"error": "mutable_disabled"}), 403

    with db.get_db() as conn:
        row = db.fetch_sample_by_digest(conn, digest)
        if not row:
            return jsonify({"error": "sample_not_found"}), 404
        path_row = db.fetch_sample_path(conn, row['id'])
        path = path_row['path']
        _archive_file(path, conn, row['id'])

    return jsonify({"status": "ok", "archived_path": path + '.bak'})


@app.route('/api/folders', methods=['GET'])
def get_folders():
    with db.get_db() as conn:
        result = db.fetch_folders(conn)
    return jsonify(result)


@app.route('/api/folders', methods=['POST'])
def add_folder():
    data = request.get_json(silent=True) or {}
    raw_path = data.get('path')
    if not raw_path or not isinstance(raw_path, str):
        return jsonify({"error": "path required"}), 400

    path = os.path.normpath(raw_path.strip())

    if not os.path.exists(path):
        return jsonify({"error": "path_not_found"}), 400
    if not os.path.isdir(path):
        return jsonify({"error": "not_a_directory"}), 400

    created_at = time.time()

    with db.get_db() as conn:
        try:
            folder_id = db.insert_folder(conn, path, created_at)
        except sqlite3.IntegrityError:
            return jsonify({"error": "folder_exists"}), 409

    scan_queue.push_folder(path)
    return jsonify({"id": folder_id, "path": path, "created_at": created_at}), 201


@app.route('/api/folders/<int:folder_id>', methods=['DELETE'])
def delete_folder(folder_id):
    with db.get_db() as conn:
        found, deleted_count = db.delete_folder(conn, folder_id)
    if not found:
        return jsonify({"error": "Folder not found"}), 404
    return jsonify({"status": "ok", "deleted_sample_count": deleted_count})


# ---------------------------------------------------------------------------
# Server startup
# ---------------------------------------------------------------------------

def _warmup_librosa():
    """Run a tiny librosa.stft() so numba JIT-compiles before the first real request."""
    try:
        import librosa, numpy as np
        dummy = np.zeros(2048, dtype=np.float32)
        librosa.stft(dummy, n_fft=2048, hop_length=512)
        logger.info("librosa warmup complete")
    except Exception:
        logger.debug("librosa warmup failed (non-fatal)", exc_info=True)


def run_app(port=5000, open_browser=True, host='127.0.0.1'):
    url = f"http://{host}:{port}"
    logger.info(f"Starting server. You can access the app at: {url}")
    Thread(target=_warmup_librosa, daemon=True).start()
    if open_browser:
        Thread(target=lambda: (time.sleep(1), webbrowser.open(url))).start()
    app.run(host=host, port=port, debug=False)


if __name__ == '__main__':
    default_db = str(Path.home() / 'groovedropper.db')
    parser = argparse.ArgumentParser(description="GrooveDropper - Needle Drop Sampling Assistant")
    parser.add_argument('--db-file', default=default_db)
    parser.add_argument('--port', required=False, type=int, default=5000)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--serve', action='store_true',
                        help="Bind to all interfaces (0.0.0.0) for LAN access; no browser is launched")
    parser.add_argument('--mutable', action='store_true',
                        help="Enable archive mode: allow renaming samples to <name>.bak from the UI")

    args = parser.parse_args()

    app.config['MUTABLE'] = args.mutable
    if args.mutable:
        logger.info("MUTABLE mode enabled — archive actions are available in the UI")

    db_path = str(Path(args.db_file).resolve())
    logger.info(f"Database: {db_path}")

    db.configure(db_path)
    try:
        db.migrate_db(db_path)
    except DatabaseTooNewError as e:
        print(
            f"ERROR: This version of GrooveDropper only supports v{e.supported_version} of the database "
            f"but it is on v{e.db_version}, please use a later version!",
            file=sys.stderr,
        )
        sys.exit(1)
    start_background_scan()
    if args.serve:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            network_ip = s.getsockname()[0]
        logger.info(f"Network mode — browse to: http://{network_ip}:{args.port}")
        run_app(args.port, open_browser=False, host='0.0.0.0')
    else:
        run_app(args.port, not args.no_browser)
