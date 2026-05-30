# Improved Marker Support

Design document for multi-marker waveform, redesigned cut/export/archive pipeline, and generic job queue.

---

## Overview

This document describes four interlocking changes:

1. **Pinned markers** — multiple named positions on the waveform, persisted per sample.
2. **Redesigned cut dialog** — region-select model replacing keep-left / keep-right buttons.
3. **Generic job queue** (`groove/jobs.py`) — single-threaded background worker replacing the ad-hoc rename queue.
4. **Reworked export, archive, and cut flows** — all long-running work moves through the job queue.

---

## 1. Database Schema

### 1.1 New table: `sample_markers`

Added in a new migration (`_migrate_v4`):

```sql
CREATE TABLE IF NOT EXISTS sample_markers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id  INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
    offset     INTEGER NOT NULL,          -- position in samples (not seconds)
    created_at REAL    NOT NULL,
    UNIQUE (sample_id, offset)            -- no two markers at the same offset
);
CREATE INDEX IF NOT EXISTS idx_sample_markers_sample ON sample_markers(sample_id);
```

Constraints:
- Maximum 32 rows per `sample_id` enforced at the API layer (not in SQL).
- `ON DELETE CASCADE` keeps the table clean when a sample is removed.

### 1.2 No schema change for config

The existing `config` table is unchanged. No marker data lives in config.

---

## 2. API Changes

### 2.1 Marker endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/api/sample/<id>/markers` | Returns all markers for the sample, ordered by offset ascending. |
| `POST` | `/api/sample/<id>/markers` | Adds a marker at `{"offset": N}`. Returns 409 if offset already exists, 422 if limit (32) reached. |
| `DELETE` | `/api/sample/<id>/markers/<offset>` | Removes the marker at `offset`. Returns 404 if not found. |

`GET` response shape:
```json
{"markers": [{"id": 1, "offset": 0}, {"id": 4, "offset": 44100}]}
```

`POST` error responses:
- `409 Conflict` — `{"error": "marker_exists"}`
- `422 Unprocessable` — `{"error": "marker_limit_reached"}`

### 2.2 Mutable/enable (already added in prior session)

No changes needed.

### 2.3 Job queue endpoints

See §4 below.

### 2.4 Export endpoint changes

`GET /api/slice/<sample_id>` is deprecated in favour of a job-based flow — see §7.

### 2.5 Cut endpoint

`POST /api/cut` is deprecated in favour of `POST /api/jobs/cut` — see §6.

### 2.6 Archive endpoint

`POST /api/sample/<digest>/archive` is deprecated in favour of `POST /api/jobs/archive` — see §5.

---

## 3. Pinned Markers — Frontend

### 3.1 CSS additions

```css
/* Prevent text/image selection on waveform drag interactions */
#waveform-container {
    user-select: none;
    -webkit-user-select: none;
}

.marker-line {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    pointer-events: none;       /* line itself is not a click target */
    z-index: 10;
}
.marker-line.active  { background: var(--accent-color); }
.marker-line.pinned  { background: color-mix(in srgb, var(--accent-color) 70%, transparent); }

.marker-handle {
    position: absolute;
    width: 16px;
    margin-left: -8px;          /* centre over the line */
    cursor: pointer;
    z-index: 11;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: var(--accent-color);
    opacity: 0.7;
}
.marker-line.active .marker-handle { opacity: 1; }

.marker-handle .marker-delete-x {
    display: none;              /* shown via JS when Ctrl is held */
    color: var(--danger-color, red);
    font-size: 0.75em;
}
```

### 3.2 Marker state in `app.js`

New fields added to `GrooveDropper.state`:

```js
markers: [],          // [{id, offset}] loaded from DB, sorted ascending
activeMarkerIndex: -1 // index into markers[], or -1 for soft (unpin) playhead
```

Helper on the object:

```js
_markerAtOffset(offset) { /* returns index or -1 */ }
_nearestMarkerBefore(offset) { /* returns index of the highest offset <= given, or -1 */ }
_nearestMarkerAfter(offset) { /* returns index of the lowest offset > given, or -1 */ }
```

### 3.3 Rendering markers

`renderMarkers()` is called after any change to `state.markers` or `state.activeMarkerIndex`. It:

1. Removes all existing `.marker-line` elements from `#waveform-container`.
2. For each marker in `state.markers`, creates:
   - A `.marker-line` div positioned at `(offset / durationSamples) * 100%`.
   - Inside it, a `.marker-handle` containing:
     - A top `<i class="fa-solid fa-sort-down">` glyph (pointing into the waveform).
     - A bottom `<i class="fa-solid fa-sort-up">` glyph.
     - A `.marker-delete-x` `<i class="fa-solid fa-xmark">` hidden by default.
   - Class `active` if `index === state.activeMarkerIndex`, else `pinned`.
3. Attaches `click` on the handle to call `activateMarker(index)`.
4. Attaches `click` on `.marker-delete-x` to call `deleteMarker(index)`.

Rendering is kept intentionally lightweight. No canvas or SVG — pure absolutely-positioned DOM elements over the PNG.

**Performance note:** `renderMarkers()` only touches the DOM once per change, not per animation frame. The audio `timeupdate` loop (`updatePlayhead`) never calls `renderMarkers`.

### 3.4 Loading markers

`loadMarkers(sampleId)` is called from `loadSample()` (and `loadSpecificDigest()`). It fetches `GET /api/sample/<id>/markers`, stores the result in `state.markers`, resets `state.activeMarkerIndex = -1`, and calls `renderMarkers()`.

Markers are also preloaded when a QuickPick slot is activated so they are available before playback starts.

### 3.5 Click and keyboard behaviour

#### Normal click (`waveformContainer` `mousedown`, button 0, no modifier)

Unchanged: `seekToWaveformClick(clientX, false)` runs, playhead moves, `activeMarkerIndex = -1` (soft position). No marker is pinned.

#### `Ctrl+Click` on waveform

If the click lands within ±4 px of an existing marker handle, no new marker is added. Otherwise:
1. Compute offset from click position.
2. Call `POST /api/sample/<id>/markers` with `{offset}`.
3. On success: push into `state.markers`, sort, set `activeMarkerIndex` to the new entry, call `renderMarkers()`.
4. On 422: show toast `"Maximum marker limit reached"`.

#### `Ctrl+Space` — pin current position

Equivalent to `Ctrl+Click` at `state.currentOffset`. Same flow as above. Works during playback.

#### `Shift+Click` on waveform

1. Compute offset from click position.
2. If `state.markers.length === 0`: fall back to normal soft-seek behaviour.
3. Otherwise, find `_nearestMarkerBefore(clickedOffset)`. If none exists, use offset `0` as the play-from position and set `activeMarkerIndex = -1`.
4. Seek audio to the resolved offset and begin playback.
5. Set `activeMarkerIndex` to the found marker index (or -1 for offset 0), call `renderMarkers()`.

#### Click on a marker handle

1. `activateMarker(index)`:
   - Sets `activeMarkerIndex = index`.
   - Seeks `audio.currentTime` to `markers[index].offset / sampleRate`.
   - Updates `state.currentOffset` and `state.originalStartOffset`.
   - Updates `#sample-offset` input.
   - Calls `renderMarkers()`.

#### `Ctrl+Hover` on marker handle — delete affordance

A `mousemove` listener on `#waveform-container` checks whether `Ctrl` is held and the mouse is over a `.marker-handle`. When both are true, the `.marker-delete-x` inside that handle is made visible. When either condition fails it is hidden again.

#### Click on `.marker-delete-x`

`deleteMarker(index)`:
1. Calls `DELETE /api/sample/<id>/markers/<offset>`.
2. On success: removes from `state.markers`, adjusts `activeMarkerIndex` if needed, calls `renderMarkers()`.

#### `ArrowLeft` / `ArrowRight` keys (remapped)

These currently seek by a sample step. Under the new design:

- If `state.markers.length === 0`: show toast `"No pinned markers"`, do nothing.
- `ArrowRight`: find the next marker after `currentOffset`. If none, wrap to the first marker (lowest offset).
- `ArrowLeft`: find the previous marker before `currentOffset`. If none, wrap to the last marker (highest offset).
- Activates the target marker: seeks audio, updates `activeMarkerIndex`, re-renders.

#### Offset input (`#sample-offset`) update

When the user edits the offset input and presses Enter, and `activeMarkerIndex >= 0`:
- The existing marker at `state.markers[activeMarkerIndex]` is deleted via the API.
- A new marker is created at the new offset.
- `state.markers` is updated, `activeMarkerIndex` follows the new entry.
- `renderMarkers()` is called.

If `activeMarkerIndex === -1` (soft playhead), behaviour is unchanged (seeks only).

### 3.6 `Shift+Space` — replay from active marker

If `activeMarkerIndex >= 0`, `restartPlay()` seeks to `markers[activeMarkerIndex].offset`.
Otherwise (soft playhead) it uses `originalStartOffset` as today.

---

## 4. Generic Job Queue (`groove/jobs.py`)

### 4.1 Design goals

- **No global state** — the queue holds all data it needs; no Flask `app`, no `scan_queue` references inside job callables.
- **Single worker thread** — one job at a time, simple FIFO, no parallelism.
- **One job per sample** — only one job may be queued or running for a given `sample_id` at once.
- **Sample locks** — transient detection can lock a sample so new jobs for it are rejected until the lock is released, or queue is paused if the next scheduled job is for the locked sample.
- **UUID job IDs** — callers can poll status by ID, with progress text to display in the user interface.

### 4.2 Internal structure

```
groove/
  jobs.py            — JobQueue class, enqueue/status/cancel API
  jobs_exporting.py  — export job callable
  jobs_archiving.py  — archive job callable
  jobs_cutting.py    — cut job callable
```

`JobQueue` (`groove/jobs.py`):

```python
class JobStatus(enum.Enum):
    QUEUED   = "queued"
    RUNNING  = "running"
    DONE     = "done"
    FAILED   = "failed"
    CANCELED = "canceled"

@dataclass
class Job:
    job_id:    str          # uuid4
    job_type:  str          # "export" | "archive" | "cut"
    sample_id: int
    payload:   dict         # all data the callable needs; no DB reads inside the job
    callable:  Callable     # jobs_exporting.run / jobs_archiving.run / jobs_cutting.run
    status:    JobStatus = JobStatus.QUEUED
    result:    Any = None   # set when DONE; for export: bytes of the file
    error:     str | None = None

class JobQueue:
    def enqueue(self, job_type, sample_id, payload, callable) -> str:
        """Returns job_id. Raises SampleBusyError if sample_id already has a queued/running job or lock."""
    def status(self, job_id) -> dict:
        """Returns {job_id, status, result_ready, error}."""
    def lock_sample(self, sample_id):
        """Prevents new jobs for sample_id. Used by transient detection."""
    def unlock_sample(self, sample_id):
        """Releases a lock."""
    def is_sample_busy(self, sample_id) -> bool:
        """True if job queued/running or lock held."""
    def poll_done(self, job_id, timeout=0) -> Job | None:
        """Non-blocking check. Returns Job if DONE/FAILED, else None."""
    def active_jobs(self) -> list[dict]:
        """Snapshot of all non-completed jobs for the status bar."""
```

A single module-level `job_queue = JobQueue()` instance is imported by `app.py`, analogous to `scan_queue`.

### 4.3 Job queue API endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/api/jobs` | Returns list of active/recent jobs. |
| `GET`  | `/api/jobs/<job_id>` | Returns status of one job. If `status=done` and job type is `export`, also returns `result_ready: true`. |
| `GET`  | `/api/jobs/<job_id>/download` | Streams the export result bytes as a file download. Only valid for export jobs that are `done`. |
| `DELETE` | `/api/jobs/<job_id>` | Cancels a queued (not yet running) job. |

### 4.4 UI — status bar integration

The existing `#scan-status` bar is updated to show job information with higher priority than indexing:

- **Job running:** `"Archiving…"` / `"Preparing export…"` / `"Slicing data…"` + job count badge if queue depth > 1.
- **No jobs, scan active:** existing indexing display.
- **No jobs, scan idle:** `"✓ No jobs scheduled or running"` (replaces today's idle text).

The frontend polls `GET /api/jobs` every 1 second while any job is active, and falls back to the scan-status poll otherwise.

When a download-type job transitions to `done`, the frontend triggers `GET /api/jobs/<job_id>/download` automatically (same as a hidden `<a download>` click).

### 4.5 Transient detection locking

`POST /api/transient/<sample_id>` (existing endpoint) is wrapped:

```python
if job_queue.is_sample_busy(sample_id):
    return jsonify({"error": "sample_busy"}), 409
job_queue.lock_sample(sample_id)
try:
    result = run_transient_detection(...)
finally:
    job_queue.unlock_sample(sample_id)
```

Transient detection runs synchronously in the request thread (it is fast), with the lock held to block concurrent job submissions.

---

## 5. Archive Flow (`groove/jobs_archiving.py`)

### 5.1 API route

`POST /api/jobs/archive`

Request body:
```json
{"sample_id": 42}
```

Response on success:
```json
{"job_id": "<uuid>", "status": "queued"}
```

Errors:
- `409` — `{"error": "sample_busy"}` (job already queued or lock held)
- `403` — mutable mode not enabled

### 5.2 Frontend change

`archiveSample()` (currently in `app.js`) is rewritten to:

1. Check `job_queue.is_sample_busy(sample_id)` via `GET /api/jobs?sample_id=X` — if busy, show toast `"A job on this sample is scheduled, please wait"`.
2. Otherwise: call `POST /api/jobs/archive` with `{sample_id}`.
3. Immediately after scheduling: load next sample (existing behaviour). If `playInstantly`, begin playback.
4. The actual rename to `.bak` happens inside the job callable, using the path snapshotted into the payload at schedule time.

### 5.3 Job callable (`jobs_archiving.run`)

Receives payload:
```python
{
    "path": "/absolute/path/to/sample.wav",
    "scan_folder_path": "/path/to/scan/folder"
}
```

Callable:
1. Renames `path` → `path + ".bak"` (with retry logic copied from current `_rename_worker`).
2. Pushes `scan_folder_path` to `scan_queue` to trigger rescan.
3. No DB access needed (record was already deleted before enqueueing).

---

## 6. Cut Flow (`groove/jobs_cutting.py`)

### 6.1 API route

`POST /api/jobs/cut`

Request body (no-marker case):
```json
{
    "sample_id": 42,
    "begin_offset": 22050,
    "keep_left": true,
    "keep_right": true
}
```

Request body (pinned-marker case):
```json
{
    "sample_id": 42,
    "markers": [0, 22050, 44100],       // offsets, ascending, snapshotted at submit time
    "regions_to_keep": [0, 2]           // indices into the region list (0 = before first marker, etc.)
}
```

Errors:
- `409` — sample busy
- `403` — not mutable

### 6.2 Redesigned cut dialog

**Opening guard:** if `job_queue.is_sample_busy(sample_id)`, show toast `"A job on this sample is scheduled, please wait"` and do not open the dialog.

**Waveform display:** the cut dialog replaces the two split-preview images with a single `<img>` pointing to `/waveform/<sample_id>` — the same PNG as the main window. Marker lines are rendered on top using the same `renderMarkers()` logic, but with a `readonly` flag set so handles are not editable.

**No-marker mode** (fewer than 2 markers):
- Keep Left / Keep Right / Keep Both buttons are shown (unchanged semantics).
- Marker at begin offset currently rendered in the main window is also shown
- `KEEP LEFT` → regions `[0]`, `KEEP RIGHT` → regions `[1]`, `KEEP BOTH` → regions `[0, 1]`.

**Pinned-marker mode** (2 or more markers):
- Keep Left / Keep Right / Keep Both buttons are hidden.
- Regions between markers (including pre-first and post-last) are rendered as clickable overlays on the waveform image.
- Default: all regions are **active** (marked for export). Display text: `"All sections will be cut to new samples"`.
- Click a region: toggles active/inactive. Inactive regions are rendered at 40% opacity with a strikethrough overlay. Display text: `"X of Y sections will be cut to new samples"`
- OK button is greyed out (`disabled`) when zero regions are active.

**Submitting:** `POST /api/jobs/cut` with the current `state.markers` offsets and the list of active region indices. Job is scheduled; dialog closes; next sample loads (with `playInstantly` if set).

### 6.3 Naming convention

Existing rule for stripping stacked offsets:

```
If filename matches r'-\d{8}-\d{8}(\.\w+)$':
    strip the last offset pair → r'-\d{8}\1'
```

New slices are named `{base}-{START:08d}-{END:08d}.wav` where:
- `START` = marker offset (or `0` for the first region).
- `END` = next marker offset − 1 (or `duration_samples − 1` for the last region).

### 6.4 Job callable (`jobs_cutting.run`)

Receives payload:
```python
{
    "path": "/absolute/path/to/sample.wav",
    "samplerate": 44100,
    "duration_samples": 882000,
    "scan_folder_path": "/path/to/scan/folder",
    # no-marker case:
    "begin_offset": 22050,
    "keep_left": True,
    "keep_right": True,
    # OR marker case:
    "markers": [0, 22050, 44100],
    "regions_to_keep": [0, 2]
}
```

Steps:
1. Compute slice boundaries from markers or `begin_offset`.
2. Call `audio.save_slice_wav()` for each kept region.
3. Archive original via rename to `.bak`.
4. Push `scan_folder_path` to `scan_queue`.

---

## 7. Export Flow (`groove/jobs_exporting.py`)

### 7.1 Behaviour

- **No pinned markers:** export a 10-second WAV from `originalStartOffset` (existing behaviour). Single WAV returned as download.
- **Pinned markers present:** export all inter-marker regions as separate WAV files, bundled into a ZIP. ZIP returned as download.

### 7.2 API route

`POST /api/jobs/export`

Request body:
```json
{
    "sample_id": 42,
    "start_offset": 0,
    "pitch_semitones": 0,
    "pitch_cents": 0,
    "markers": []             // empty = no-marker mode; populated = ZIP mode
}
```

Markers are sent in the request payload (not re-fetched from DB) so the job operates on the marker state at submit time.

Errors:
- `409` — `{"error": "sample_busy"}` (if same sample already being exported)
- `400` — invalid parameters

### 7.3 Frontend change

The existing export button calls `POST /api/jobs/export`, receives `job_id`, and polls `GET /api/jobs/<job_id>` until `status === "done"`. Then it fires `GET /api/jobs/<job_id>/download`.

If the sample is already being exported (checked via `GET /api/jobs?sample_id=X&type=export`), show toast `"Export already in progress"` and do not enqueue.

**`play_instantly` interaction:** if `play_instantly` is active and the sample is not already playing, do not auto-play on export submission.

### 7.4 Job callable (`jobs_exporting.run`)

Receives payload:
```python
{
    "path": "/absolute/path/to/sample.wav",
    "samplerate": 44100,
    "duration_samples": 882000,
    "start_offset": 0,
    "pitch_semitones": 0,
    "pitch_cents": 0,
    "markers": [0, 22050, 44100],   # empty list = no-marker mode
    "stem": "sample_name"
}
```

No-marker mode: calls `audio.make_audio_slice(path, start_offset, samplerate)` → single WAV bytes → stored in `job.result`.

Multi-marker mode:
1. Compute region boundaries from `markers` (same logic as cut naming).
2. For each region, call `audio.save_slice_wav()` to an in-memory buffer.
3. Build a ZIP archive ON DISK in tmp folder with one WAV per region, named `
{slice}-{START:08d}-{END:08d}.wav`.
4. Store ZIP bytes in `job.result`.

`GET /api/jobs/<job_id>/download` streams `job.result` with:
- `Content-Type: audio/wav` (single) or `application/zip` (multi).
- `Content-Disposition: attachment; filename="{stem}.wav"` or `"{stem}-slices.zip"`.

---

## 8. Link Sharing

No change. The shareable URL encodes `digest` and `startOffset` only. Pinned markers are persisted in the database and loaded automatically when the sample loads — they do not need to be in the URL.
When an URL containing a sample digest and offset is loaded the markers are restored as it would when randomly selecting it 
---

## 9. File Layout After Implementation

```
groove/
  __init__.py
  audio.py
  audio_common.py
  audio_wav.py
  audio_mp3.py
  db.py                  -- adds sample_markers table (_migrate_v4)
  queue.py               -- unchanged (scan queue)
  transient.py           -- lock/unlock calls added
  jobs.py                -- NEW: JobQueue, Job, SampleBusyError
  jobs_exporting.py      -- NEW: export job callable
  jobs_archiving.py      -- NEW: archive job callable
  jobs_cutting.py        -- NEW: cut job callable

app.py
  -- POST /api/jobs/export    (replaces GET /api/slice/<id>)
  -- POST /api/jobs/archive   (replaces POST /api/sample/<digest>/archive)
  -- POST /api/jobs/cut       (replaces POST /api/cut)
  -- GET  /api/jobs
  -- GET  /api/jobs/<job_id>
  -- GET  /api/jobs/<job_id>/download
  -- DELETE /api/jobs/<job_id>
  -- GET  /api/sample/<id>/markers
  -- POST /api/sample/<id>/markers
  -- DELETE /api/sample/<id>/markers/<offset>

static/js/
  app.js                 -- marker state, Ctrl+Click, Ctrl+Space, ArrowLeft/Right, offset sync
  app-audio.js           -- Shift+Click, Shift+Space updates for active marker
  app-cut.js  (or inline) -- redesigned cut dialog

templates/index.html
  -- marker CSS
  -- mutable-warn dialog (already added)
  -- cut dialog overhaul
```

---

## 10. Open Questions / Deferral Notes

- **Marker drag-to-reposition:** not in scope for this iteration. Delete + re-add is sufficient.
- **Undo / redo for markers:** out of scope.
- **MP3 ZIP export:** `audio_mp3.py` needs a `save_slice_wav` equivalent that outputs WAV. The interface in `audio.py` should be extended to route correctly.
- **Maximum 32 markers:** enforced in the API. The frontend also checks `state.markers.length >= 32` before calling the POST, showing the toast immediately without a round trip.
- **`_rename_worker` thread:** once all archive and cut calls go through `jobs_archiving` and `jobs_cutting`, the old `_rename_queue` and `_rename_worker` can be removed from `app.py`.
