# Contributing to GrooveDropper

Thanks for your interest! This document covers how to get the dev environment running, how the codebase is structured, and how to submit changes.

## Dev Setup

1. **Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Node dependencies**
   ```bash
   npm install
   ```

3. **Start the app**
   ```bash
   npm start          # Electron (full desktop app)
   # — or —
   python app.py --db-file dev.db   # Flask only, opens a browser tab
   ```

The first time you run either mode, you'll be prompted (or shown the web UI) to add a folder of `.wav` files. The SQLite database is created automatically.

## Architecture

```
main.js          Electron entry point — spawns Flask, handles first-run folder prompt
app.py           Flask backend — REST API, SQLite, background file scanner, waveform generation
templates/       Jinja2 HTML templates (index.html)
static/js/app.js Vanilla JS frontend — all UI state, playback, label/preset system
```

### Backend (`app.py`)

- **Database**: SQLite via the standard `sqlite3` module. Schema is created by `init_db()` on startup. Foreign keys are always enabled. All DB access goes through the `get_db()` context manager, which commits on success and rolls back on exception.
- **Scanning**: A single background daemon thread (`scan_worker`) drains two queues — `folder_queue` (directories) and `wav_queue` (individual WAV paths). This keeps disk I/O off the Flask request path. Scan status is polled by the frontend every 5 seconds via `/api/stats`.
- **Waveform generation**: Reads the file block-by-block (one block per output pixel), records min/max amplitude per column, and produces a transparent PNG stored as a BLOB in the `samples` table.
- **Deduplication**: Each file is identified by a full-file MD5 digest. If the same audio content exists at a different path it won't be indexed twice.
- **Label filtering**: `/api/sample/random` supports both OR mode (any matching label) and AND mode (all labels must be present) using a GROUP BY + HAVING COUNT query.

### Frontend (`static/js/app.js`)

Everything lives on the `GrooveDropper` singleton object. Key state:

- `currentSampleId / currentDigest` — identify the loaded sample
- `currentOffset / originalStartOffset` — current playhead vs. the start-of-slice anchor
- `historyQueue / historyIndex` — client-side back navigation (server-side `history` table stores the same data persistently)
- `activePresetId / activePresetLabelIds` — which preset/labels filter random draws
- `allPresetSelectedLabelIds` — transient label filter when the "ALL" preset is active (not persisted as a preset)

### Electron (`main.js`)

Spawns `app.py` as a child process on a fixed port (5000). On first run (no database file found), it shows a native folder picker and registers the path via the API once Flask is ready.

## Database Schema

| Table | Purpose |
|-------|---------|
| `scan_folders` | Directories to scan for WAVs |
| `samples` | Indexed WAV metadata + waveform PNG blob |
| `labels` | User-created tags with optional color |
| `presets` | Named filter sets (OR or AND over labels) |
| `preset_labels` | Junction: which labels belong to a preset |
| `sample_labels` | Junction: which labels a sample has (keyed by digest) |
| `scan_folder_labels` | Junction: labels auto-applied to all samples in a folder |
| `history` | Every sample play event with start offset |
| `config` | Persistent key/value settings (theme, loop, UI state) |

The `ALL` preset (`is_system = 1`) is seeded on DB creation and cannot be deleted or renamed.

## Making Changes

- **Backend routes**: add/modify in `app.py`. Follow the existing pattern of a `get_db()` context, return `jsonify(...)`. Validate inputs at the boundary; don't guard against impossible states inside helpers.
- **Frontend**: edit `static/js/app.js`. Keep state mutations inside methods; don't mutate `this.state` from event listeners directly. For new API calls, follow the `async/await` + `try/catch` pattern already used throughout.
- **Schema changes**: add migrations as conditional `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE` calls in `init_db()`. Never drop existing tables in migrations.
- **Electron**: edit `main.js` only when the app wrapper needs updating (window settings, startup args, first-run flow).

## Submitting a Pull Request

1. Fork the repo and create a branch from `master`.
2. Make your changes. Keep commits focused.
3. Test both the Electron app (`npm start`) and the Flask-only path (`python app.py --db-file dev.db`).
4. Open a PR against `master` with a short description of what changed and why.

## Code Style

- Python: follow PEP 8. No type annotations required, but keep function signatures readable.
- JavaScript: vanilla ES2020+, no framework dependencies. Async functions use `async/await`.
- Comments: only when the *why* is non-obvious. Avoid restating what the code already says.
