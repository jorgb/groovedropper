import os
import sqlite3
import logging
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_FILE = None


class DatabaseTooNewError(Exception):
    def __init__(self, db_version, supported_version):
        self.db_version = db_version
        self.supported_version = supported_version
        super().__init__(
            f"Database is at v{db_version} but this build only supports up to v{supported_version}."
        )


def configure(db_path):
    global DB_FILE
    DB_FILE = db_path


def open_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


CURRENT_VERSION = 4


def _migrate_v1(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS scan_folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            path       TEXT    UNIQUE NOT NULL,
            created_at REAL    NOT NULL
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS samples (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            path             TEXT    UNIQUE,
            name             TEXT,
            directory        TEXT,
            size             INTEGER,
            digest           TEXT,
            timestamp        REAL,
            duration         REAL,
            samplerate       INTEGER,
            duration_samples INTEGER,
            waveform         BLOB,
            folder_id        INTEGER REFERENCES scan_folders(id) ON DELETE CASCADE
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS labels (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT UNIQUE NOT NULL,
            created_at REAL NOT NULL
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS presets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT UNIQUE NOT NULL,
            is_system   INTEGER NOT NULL DEFAULT 0,
            filter_mode TEXT NOT NULL DEFAULT 'OR',
            created_at  REAL NOT NULL
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS preset_labels (
            preset_id INTEGER NOT NULL REFERENCES presets(id),
            label_id  INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            PRIMARY KEY (preset_id, label_id)
        )
    ''')
    conn.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_samples_digest ON samples(digest)'
    )
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sample_labels (
            digest   TEXT    NOT NULL REFERENCES samples(digest) ON DELETE CASCADE,
            label_id INTEGER NOT NULL REFERENCES labels(id)      ON DELETE CASCADE,
            PRIMARY KEY (digest, label_id)
        )
    ''')
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('theme', 'theme-default')")
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('loop', 'true')")
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('controls-folded', 'true')")
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('offset-preview', 'time')")
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('mutable-warn', 'true')")
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('mutable', 'false')")
    conn.execute(
        "INSERT OR IGNORE INTO presets (name, is_system, filter_mode, created_at) VALUES ('ALL', 1, 'OR', ?)",
        (time.time(),)
    )


def _migrate_v3(conn):
    conn.execute('DROP TABLE IF EXISTS scan_folder_labels')
    conn.execute('DROP TABLE IF EXISTS history')


def _migrate_v2(conn):
    conn.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('quick-play-instantly', 'true')")
    conn.execute('''
        CREATE TABLE IF NOT EXISTS quickpick_presets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            created_at REAL    NOT NULL
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS quickpick_slots (
            preset_id       INTEGER NOT NULL REFERENCES quickpick_presets(id) ON DELETE CASCADE,
            slot_number     INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
            digest          TEXT    NOT NULL REFERENCES samples(digest) ON DELETE CASCADE,
            start_offset    INTEGER NOT NULL DEFAULT 0,
            pitch_semitones INTEGER NOT NULL DEFAULT 0,
            pitch_cents     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (preset_id, slot_number)
        )
    ''')


def _migrate_v4(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sample_markers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            sample_id  INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
            offset     INTEGER NOT NULL,
            created_at REAL    NOT NULL,
            UNIQUE (sample_id, offset)
        )
    ''')
    conn.execute(
        'CREATE INDEX IF NOT EXISTS idx_sample_markers_sample ON sample_markers(sample_id)'
    )


_MIGRATION_FNS = {
    1: _migrate_v1,
    2: _migrate_v2,
    3: _migrate_v3,
    4: _migrate_v4,
}


def migrate_db(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)
        ''')
        row = conn.execute('SELECT version FROM schema_version').fetchone()
        current = row[0] if row else 0
        if current > CURRENT_VERSION:
            raise DatabaseTooNewError(current, CURRENT_VERSION)
        for version in sorted(_MIGRATION_FNS.keys()):
            if version > current:
                logger.info(f"Applying DB migration v{version}")
                _MIGRATION_FNS[version](conn)
                if current == 0:
                    conn.execute('INSERT INTO schema_version (version) VALUES (?)', (version,))
                else:
                    conn.execute('UPDATE schema_version SET version = ?', (version,))
                current = version
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()




# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def fetch_config(conn):
    rows = conn.execute('SELECT key, value FROM config').fetchall()
    return {row['key']: row['value'] for row in rows}


def save_config(conn, data):
    for k, v in data.items():
        conn.execute('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', (k, str(v)))


# ---------------------------------------------------------------------------
# Markers
# ---------------------------------------------------------------------------

def fetch_markers(conn, sample_id):
    rows = conn.execute(
        'SELECT id, offset FROM sample_markers WHERE sample_id = ? ORDER BY offset ASC',
        (sample_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def count_markers(conn, sample_id):
    return conn.execute(
        'SELECT COUNT(*) FROM sample_markers WHERE sample_id = ?', (sample_id,)
    ).fetchone()[0]


def insert_marker(conn, sample_id, offset):
    cursor = conn.execute(
        'INSERT INTO sample_markers (sample_id, offset, created_at) VALUES (?, ?, ?)',
        (sample_id, offset, time.time())
    )
    return cursor.lastrowid


def delete_marker_by_offset(conn, sample_id, offset):
    result = conn.execute(
        'DELETE FROM sample_markers WHERE sample_id = ? AND offset = ?',
        (sample_id, offset)
    )
    return result.rowcount > 0


def delete_all_markers(conn, sample_id):
    result = conn.execute(
        'DELETE FROM sample_markers WHERE sample_id = ?', (sample_id,)
    )
    return result.rowcount


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def fetch_sample_count(conn):
    return conn.execute('SELECT COUNT(*) FROM samples').fetchone()[0]


def fetch_untagged_sample_count(conn):
    return conn.execute('''
        SELECT COUNT(*) FROM samples s
        WHERE NOT EXISTS (
            SELECT 1 FROM sample_labels sl WHERE sl.digest = s.digest
        )
    ''').fetchone()[0]


def fetch_random_untagged_sample(conn, excluded_digest=None):
    if excluded_digest:
        return conn.execute('''
            SELECT id, name, directory, size, duration, samplerate, duration_samples, digest
            FROM samples s
            WHERE NOT EXISTS (
                SELECT 1 FROM sample_labels sl WHERE sl.digest = s.digest
            ) AND s.digest != ?
            ORDER BY RANDOM() LIMIT 1
        ''', (excluded_digest,)).fetchone()
    return conn.execute('''
        SELECT id, name, directory, size, duration, samplerate, duration_samples, digest
        FROM samples s
        WHERE NOT EXISTS (
            SELECT 1 FROM sample_labels sl WHERE sl.digest = s.digest
        )
        ORDER BY RANDOM() LIMIT 1
    ''').fetchone()


# ---------------------------------------------------------------------------
# Samples
# ---------------------------------------------------------------------------

def fetch_sample_by_id(conn, sample_id):
    return conn.execute(
        'SELECT id, name, directory, size, duration, samplerate, duration_samples, digest FROM samples WHERE id = ?',
        (sample_id,)
    ).fetchone()


def fetch_random_sample(conn, label_ids=None, filter_mode='OR'):
    if label_ids:
        placeholders = ','.join('?' * len(label_ids))
        if filter_mode == 'AND':
            return conn.execute(f'''
                SELECT s.id, s.name, s.directory, s.size, s.duration, s.samplerate, s.duration_samples, s.digest
                FROM samples s
                WHERE s.digest IN (
                    SELECT digest FROM sample_labels
                    WHERE label_id IN ({placeholders})
                    GROUP BY digest HAVING COUNT(DISTINCT label_id) = ?
                )
                ORDER BY RANDOM() LIMIT 1
            ''', label_ids + [len(label_ids)]).fetchone()
        return conn.execute(f'''
            SELECT s.id, s.name, s.directory, s.size, s.duration, s.samplerate, s.duration_samples, s.digest
            FROM samples s
            WHERE s.digest IN (
                SELECT DISTINCT digest FROM sample_labels
                WHERE label_id IN ({placeholders})
            )
            ORDER BY RANDOM() LIMIT 1
        ''', label_ids).fetchone()
    return conn.execute(
        'SELECT id, name, directory, size, duration, samplerate, duration_samples, digest FROM samples ORDER BY RANDOM() LIMIT 1'
    ).fetchone()


def fetch_sample_index(conn, sample_id):
    return conn.execute(
        'SELECT COUNT(*) FROM samples WHERE id <= ?', (sample_id,)
    ).fetchone()[0]


def fetch_sample_total(conn):
    return conn.execute('SELECT COUNT(*) FROM samples').fetchone()[0]


def fetch_sample_at_offset(conn, index_num):
    return conn.execute(
        'SELECT id, name, directory, size, duration, samplerate, duration_samples, digest FROM samples ORDER BY id LIMIT 1 OFFSET ?',
        (index_num - 1,)
    ).fetchone()


def fetch_sample_by_digest(conn, digest):
    return conn.execute(
        'SELECT id, name, directory, size, duration, samplerate, duration_samples, digest FROM samples WHERE digest = ?',
        (digest,)
    ).fetchone()


def fetch_waveform(conn, sample_id):
    return conn.execute('SELECT waveform FROM samples WHERE id = ?', (sample_id,)).fetchone()


def fetch_sample_path(conn, sample_id):
    return conn.execute('SELECT path FROM samples WHERE id = ?', (sample_id,)).fetchone()


def fetch_sample_path_and_name(conn, sample_id):
    return conn.execute('SELECT path, name, samplerate FROM samples WHERE id = ?', (sample_id,)).fetchone()


def delete_sample(conn, sample_id):
    """Fetch the sample row and delete it. Returns the row (for path), or None if not found."""
    row = conn.execute('SELECT path FROM samples WHERE id = ?', (sample_id,)).fetchone()
    if row:
        conn.execute('DELETE FROM samples WHERE id = ?', (sample_id,))
    return row


def delete_sample_by_digest(conn, digest):
    """Delete a sample by digest. Returns the path row, or None if not found."""
    row = conn.execute('SELECT path FROM samples WHERE digest = ?', (digest,)).fetchone()
    if row:
        conn.execute('DELETE FROM samples WHERE digest = ?', (digest,))
    return row


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------

def refresh_samples(conn, delete_sample_labels=False):
    """Clear samples while optionally preserving sample_labels.

    delete_sample_labels=False (default): suspends FK enforcement before the
    first DML so the ON DELETE CASCADE on sample_labels(digest) does not fire.
    Per-sample labels are preserved and re-attach automatically when the scanner
    re-indexes each file by its content digest.

    delete_sample_labels=True: FK enforcement is left ON so DELETE FROM samples
    cascades into sample_labels, wiping all per-sample label assignments.
    """
    if not delete_sample_labels:
        # PRAGMA must precede all DML: SQLite ignores FK pragma changes once a
        # transaction is open. get_db() closes this connection after commit so
        # there is no need to restore FK=ON explicitly.
        conn.execute('PRAGMA foreign_keys = OFF')
    count = conn.execute('SELECT COUNT(*) FROM samples').fetchone()[0]
    conn.execute('DELETE FROM samples')
    return count


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

def fetch_labels(conn):
    return conn.execute('''
        SELECT l.id, l.name, COUNT(sl.digest) AS sample_count
        FROM labels l
        LEFT JOIN sample_labels sl ON sl.label_id = l.id
        GROUP BY l.id
        ORDER BY l.name ASC
    ''').fetchall()


def insert_label(conn, name):
    cursor = conn.execute(
        'INSERT INTO labels (name, created_at) VALUES (?, ?)',
        (name, time.time())
    )
    return cursor.lastrowid


def fetch_label_by_id(conn, label_id):
    return conn.execute(
        'SELECT id, name FROM labels WHERE id = ?', (label_id,)
    ).fetchone()


def fetch_label_usage(conn, label_id):
    return conn.execute(
        'SELECT COUNT(*) FROM sample_labels WHERE label_id = ?', (label_id,)
    ).fetchone()[0]


def delete_label(conn, label_id):
    row = conn.execute('SELECT id FROM labels WHERE id = ?', (label_id,)).fetchone()
    if row:
        conn.execute('DELETE FROM labels WHERE id = ?', (label_id,))
    return row is not None


def update_label(conn, label_id, name):
    row = conn.execute('SELECT id FROM labels WHERE id = ?', (label_id,)).fetchone()
    if not row:
        return None
    conn.execute('UPDATE labels SET name = ? WHERE id = ?', (name, label_id))
    return conn.execute('SELECT id, name FROM labels WHERE id = ?', (label_id,)).fetchone()


def prune_orphan_sample_labels(conn):
    cursor = conn.execute(
        'DELETE FROM sample_labels WHERE digest NOT IN (SELECT digest FROM samples)'
    )
    return cursor.rowcount


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------

def suggest_preset_name(conn, base='New Preset'):
    existing = {r[0] for r in conn.execute('SELECT name FROM presets').fetchall()}
    if base not in existing:
        return base
    i = 1
    while f'{base} ({i})' in existing:
        i += 1
    return f'{base} ({i})'


def fetch_presets(conn):
    presets = conn.execute(
        'SELECT id, name, is_system, filter_mode FROM presets ORDER BY is_system DESC, name ASC'
    ).fetchall()
    result = []
    for p in presets:
        labels = conn.execute(
            'SELECT label_id FROM preset_labels WHERE preset_id = ?', (p['id'],)
        ).fetchall()
        d = dict(p)
        d['labels'] = [r['label_id'] for r in labels]
        result.append(d)
    return result


def insert_preset(conn, name, label_ids):
    cursor = conn.execute(
        'INSERT INTO presets (name, is_system, filter_mode, created_at) VALUES (?, 0, ?, ?)',
        (name, 'OR', time.time())
    )
    preset_id = cursor.lastrowid
    for lid in label_ids:
        conn.execute(
            'INSERT OR IGNORE INTO preset_labels (preset_id, label_id) VALUES (?, ?)',
            (preset_id, lid)
        )
    labels = [r['label_id'] for r in conn.execute(
        'SELECT label_id FROM preset_labels WHERE preset_id = ?', (preset_id,)
    ).fetchall()]
    return preset_id, labels


def fetch_preset(conn, preset_id):
    return conn.execute('SELECT id, is_system FROM presets WHERE id = ?', (preset_id,)).fetchone()


def update_preset_name(conn, preset_id, name):
    conflict = conn.execute(
        'SELECT id FROM presets WHERE name = ? AND id != ?', (name, preset_id)
    ).fetchone()
    if conflict:
        i = 1
        while conn.execute(
            'SELECT id FROM presets WHERE name = ? AND id != ?', (f'{name} ({i})', preset_id)
        ).fetchone():
            i += 1
        name = f'{name} ({i})'
    conn.execute('UPDATE presets SET name = ? WHERE id = ?', (name, preset_id))
    return name


def delete_preset(conn, preset_id):
    conn.execute('DELETE FROM preset_labels WHERE preset_id = ?', (preset_id,))
    conn.execute('DELETE FROM presets WHERE id = ?', (preset_id,))


def insert_preset_label(conn, preset_id, label_id):
    conn.execute(
        'INSERT OR IGNORE INTO preset_labels (preset_id, label_id) VALUES (?, ?)',
        (preset_id, label_id)
    )


def delete_preset_label(conn, preset_id, label_id):
    conn.execute(
        'DELETE FROM preset_labels WHERE preset_id = ? AND label_id = ?',
        (preset_id, label_id)
    )


# ---------------------------------------------------------------------------
# Sample labels
# ---------------------------------------------------------------------------

def fetch_sample_labels(conn, digest):
    return conn.execute(
        'SELECT label_id FROM sample_labels WHERE digest = ?', (digest,)
    ).fetchall()


def insert_sample_label(conn, digest, label_id):
    conn.execute(
        'INSERT OR IGNORE INTO sample_labels (digest, label_id) VALUES (?, ?)',
        (digest, label_id)
    )


def delete_sample_label(conn, digest, label_id):
    conn.execute(
        'DELETE FROM sample_labels WHERE digest = ? AND label_id = ?',
        (digest, label_id)
    )


# ---------------------------------------------------------------------------
# Scan folders
# ---------------------------------------------------------------------------

def fetch_scan_folder_paths(conn):
    return [row['path'] for row in conn.execute('SELECT path FROM scan_folders').fetchall()]


def fetch_folders(conn):
    rows = conn.execute('''
        SELECT sf.id, sf.path, sf.created_at,
               COUNT(s.id) AS sample_count
        FROM scan_folders sf
        LEFT JOIN samples s ON s.folder_id = sf.id
        GROUP BY sf.id
        ORDER BY sf.created_at ASC
    ''').fetchall()
    return [dict(row) for row in rows]


def insert_folder(conn, path, created_at):
    cursor = conn.execute(
        'INSERT INTO scan_folders (path, created_at) VALUES (?, ?)',
        (path, created_at)
    )
    return cursor.lastrowid


def delete_folder(conn, folder_id):
    count_row = conn.execute(
        'SELECT COUNT(*) FROM samples WHERE folder_id = ?', (folder_id,)
    ).fetchone()
    sample_count = count_row[0] if count_row else 0
    row = conn.execute('SELECT id FROM scan_folders WHERE id = ?', (folder_id,)).fetchone()
    if row:
        conn.execute('DELETE FROM scan_folders WHERE id = ?', (folder_id,))
    return row is not None, sample_count


# ---------------------------------------------------------------------------
# Scan worker helpers (cursor-based; scan_worker holds its own long-lived conn)
# ---------------------------------------------------------------------------



def scan_get_folder_id(cursor, folder_path):
    cursor.execute('SELECT id FROM scan_folders WHERE path = ?', (folder_path,))
    row = cursor.fetchone()
    if row:
        return row['id']
    # folder_path may be a subdirectory pushed by api_cut — find the containing scan folder
    cursor.execute('SELECT id, path FROM scan_folders')
    for r in cursor.fetchall():
        registered = r['path']
        if folder_path.startswith(registered + os.sep):
            return r['id']
    return None


def scan_fetch_samples_by_folder_id(cursor, folder_id):
    cursor.execute('SELECT path FROM samples WHERE folder_id = ?', (folder_id,))
    return [row['path'] for row in cursor.fetchall()]


def scan_get_sample_timestamp(cursor, wav_path):
    cursor.execute('SELECT timestamp FROM samples WHERE path = ?', (wav_path,))
    row = cursor.fetchone()
    return row['timestamp'] if row else None


def scan_delete_sample_by_path(cursor, wav_path):
    cursor.execute('DELETE FROM samples WHERE path = ?', (wav_path,))


def scan_count_all_samples(cursor):
    cursor.execute('SELECT COUNT(*) FROM samples')
    return cursor.fetchone()[0]


def scan_fetch_all_sample_paths_paginated(cursor, limit, offset):
    cursor.execute('SELECT path FROM samples LIMIT ? OFFSET ?', (limit, offset))
    return [row['path'] for row in cursor.fetchall()]


def scan_delete_samples_by_paths(cursor, paths):
    cursor.executemany('DELETE FROM samples WHERE path = ?', [(p,) for p in paths])


def scan_check_digest_exists(cursor, digest):
    cursor.execute('SELECT 1 FROM samples WHERE digest = ?', (digest,))
    return cursor.fetchone() is not None


def scan_insert_sample(cursor, wav_path, name, directory, size, digest, mtime, duration, samplerate, duration_samples, waveform, folder_id):
    cursor.execute('''
        INSERT INTO samples
            (path, name, directory, size, digest, timestamp, duration, samplerate, duration_samples, waveform, folder_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (wav_path, name, directory, size, digest, mtime, duration, samplerate, duration_samples, waveform, folder_id))


def scan_insert_sample_label(cursor, digest, label_id):
    cursor.execute(
        'INSERT OR IGNORE INTO sample_labels (digest, label_id) VALUES (?, ?)',
        (digest, label_id)
    )


# ---------------------------------------------------------------------------
# Quick Pick
# ---------------------------------------------------------------------------

def fetch_quickpick_presets(conn):
    return conn.execute(
        'SELECT id, name FROM quickpick_presets ORDER BY created_at ASC'
    ).fetchall()


def insert_quickpick_preset(conn, name):
    cursor = conn.execute(
        'INSERT INTO quickpick_presets (name, created_at) VALUES (?, ?)',
        (name, time.time())
    )
    return cursor.lastrowid


def update_quickpick_preset_name(conn, preset_id, name):
    row = conn.execute('SELECT id FROM quickpick_presets WHERE id = ?', (preset_id,)).fetchone()
    if not row:
        return None
    conn.execute('UPDATE quickpick_presets SET name = ? WHERE id = ?', (name, preset_id))
    return conn.execute('SELECT id, name FROM quickpick_presets WHERE id = ?', (preset_id,)).fetchone()


def delete_quickpick_preset(conn, preset_id):
    row = conn.execute('SELECT id FROM quickpick_presets WHERE id = ?', (preset_id,)).fetchone()
    if row:
        conn.execute('DELETE FROM quickpick_presets WHERE id = ?', (preset_id,))
    return row is not None


def fetch_quickpick_slots(conn, preset_id):
    rows = conn.execute('''
        SELECT qs.slot_number, qs.digest, qs.start_offset, qs.pitch_semitones, qs.pitch_cents,
               s.name AS sample_name
        FROM quickpick_slots qs
        JOIN samples s ON s.digest = qs.digest
        WHERE qs.preset_id = ?
    ''', (preset_id,)).fetchall()
    return {str(row['slot_number']): dict(row) for row in rows}


def upsert_quickpick_slot(conn, preset_id, slot_number, digest, start_offset, pitch_semitones, pitch_cents):
    conn.execute('''
        INSERT INTO quickpick_slots (preset_id, slot_number, digest, start_offset, pitch_semitones, pitch_cents)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (preset_id, slot_number) DO UPDATE SET
            digest = excluded.digest,
            start_offset = excluded.start_offset,
            pitch_semitones = excluded.pitch_semitones,
            pitch_cents = excluded.pitch_cents
    ''', (preset_id, slot_number, digest, start_offset, pitch_semitones, pitch_cents))


def delete_quickpick_slot(conn, preset_id, slot_number):
    conn.execute(
        'DELETE FROM quickpick_slots WHERE preset_id = ? AND slot_number = ?',
        (preset_id, slot_number)
    )
