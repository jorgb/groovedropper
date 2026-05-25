# Sample Cut Dialog — Design Document

Triggered by **Shift+C** when a sample is loaded and mutable mode is active.
Lets the user keep the left side, right side, both, or neither of an audio file
relative to the current cut point (the begin-offset / mark-cut dashed line).

---

## Dialog Layout

Based on `docs/design/sample-cut.drawio`.

```
┌──────────────────────────────────────────────────────────────┐ [X]
│  Cut the sample in half?                                      │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │         Previewing waveform, please wait...              │ │  ← status text above waveform
│ │                                                          │ │
│ │  ──────────────────╎──────────────────                   │ │  ← centered dashed cut line
│ │                    ╎                                     │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [TL][KL]                                          [KR][TR] │
│  Cutting saves the kept side(s) as new WAV file(s).         │
│  The original is archived (renamed to .bak).                │
│                                        [Cancel]  [OK]       │
└─────────────────────────────────────────────────────────────┘
```

### Button icons

| ID              | Icon                                  | Meaning                        |
|-----------------|---------------------------------------|--------------------------------|
| `btn-cut-tl`    | `fa-solid fa-trash`                   | Trash the left side            |
| `btn-cut-kl`    | `fa-solid fa-floppy-disk`             | Keep (save) the left side      |
| `btn-cut-kr`    | `fa-solid fa-floppy-disk`             | Keep (save) the right side     |
| `btn-cut-tr`    | `fa-solid fa-trash`                   | Trash the right side           |

Buttons use the existing `.panel-icon-btn` class.
An **active / selected** button is shown inverted:
```css
#cut-dialog .cut-btn.active {
    background: var(--accent);
    color: var(--bg);
}
```

TL and KL are an **exclusive toggle pair** (left side choice).
KR and TR are an **exclusive toggle pair** (right side choice).
Activating one in a pair deactivates the other.

Default state when the dialog opens: **no button selected** on either side.
OK is disabled until at least one side has a selection.

---

## Trigger

### Keyboard

In `static/js/app.js`, in the existing `keydown` handler, after the `KeyA` block:

```javascript
} else if (e.code === 'KeyC' && e.shiftKey && this.state.mutable) {
    this.showCutDialog().catch(err => console.error(err));
}
```

No guard needed for `currentSampleId` here — `showCutDialog` does that itself.

### State guard (inside `showCutDialog`)

```javascript
async showCutDialog() {
    if (!this.state.currentSampleId || !this.state.mutable) return;
    // … proceed
}
```

---

## Frontend — HTML (templates/index.html)

Add after the archive dialog overlay (around line 1711):

```html
<!-- Sample Cut Dialog -->
<div id="cut-dialog-overlay" class="dialog-overlay hidden">
  <div id="cut-dialog" class="dialog-card" style="max-width:660px;">
    <div class="dialog-header">
      <span>Cut the sample in half?</span>
      <button id="cut-dialog-close" class="dialog-close-btn"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="dialog-body">
      <p id="cut-waveform-status" style="margin:0 0 4px;font-size:0.8em;color:var(--muted);">
        Previewing waveform, please wait...
      </p>
      <div style="position:relative;">
        <img id="cut-waveform-img"
             src="/static/img/waveform_placeholder.png"
             style="width:100%;height:90px;object-fit:fill;display:block;" />
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;">
        <div style="display:flex;gap:2px;">
          <button id="btn-cut-tl" class="panel-icon-btn cut-btn" title="Trash left side">
            <i class="fa-solid fa-trash"></i>
          </button>
          <button id="btn-cut-kl" class="panel-icon-btn cut-btn" title="Keep left side">
            <i class="fa-solid fa-floppy-disk"></i>
          </button>
        </div>
        <div style="display:flex;gap:2px;">
          <button id="btn-cut-kr" class="panel-icon-btn cut-btn" title="Keep right side">
            <i class="fa-solid fa-floppy-disk"></i>
          </button>
          <button id="btn-cut-tr" class="panel-icon-btn cut-btn" title="Trash right side">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
      <p style="margin:8px 0 0;font-size:0.75em;color:var(--muted);">
        Kept sides are saved as new WAV files. The original is renamed / archived (.bak).
      </p>
    </div>
    <div class="dialog-footer">
      <button id="cut-dialog-cancel" class="panel-icon-btn">Cancel</button>
      <button id="cut-dialog-ok"     class="panel-icon-btn" disabled>OK</button>
    </div>
  </div>
</div>
```

### Placeholder image

Use the existing `static/img/waveform_placeholder.png` as placeholder.

---

## Frontend — JavaScript

### Element references (app.js `_buildElements`)

```javascript
cutDialogOverlay:  document.getElementById('cut-dialog-overlay'),
cutDialogClose:    document.getElementById('cut-dialog-close'),
cutDialogCancel:   document.getElementById('cut-dialog-cancel'),
cutDialogOk:       document.getElementById('cut-dialog-ok'),
cutWaveformImg:    document.getElementById('cut-waveform-img'),
cutWaveformStatus: document.getElementById('cut-waveform-status'),
btnCutTl:          document.getElementById('btn-cut-tl'),
btnCutKl:          document.getElementById('btn-cut-kl'),
btnCutKr:          document.getElementById('btn-cut-kr'),
btnCutTr:          document.getElementById('btn-cut-tr'),
```

### Dialog state (local to the method, not persisted to `this.state`)

```javascript
_cutState = { leftAction: null, rightAction: null }
// leftAction:  'trash' | 'keep' | null
// rightAction: 'trash' | 'keep' | null
```

### Toggle helpers

```javascript
_setCutLeft(action) {           // action: 'trash' | 'keep' | null
    this._cutState.leftAction = action;
    this.elements.btnCutTl.classList.toggle('active', action === 'trash');
    this.elements.btnCutKl.classList.toggle('active', action === 'keep');
    this._updateCutOkState();
},

_setCutRight(action) {
    this._cutState.rightAction = action;
    this.elements.btnCutKr.classList.toggle('active', action === 'keep');
    this.elements.btnCutTr.classList.toggle('active', action === 'trash');
    this._updateCutOkState();
},

_updateCutOkState() {
    const waveformOk = this.elements.cutWaveformStatus.textContent !== 'Waveform unavailable.';
    const actionsOk  = this._cutState.leftAction !== null && this._cutState.rightAction !== null;
    this.elements.cutDialogOk.disabled = !(waveformOk && actionsOk);
},
```

OK stays disabled when "Waveform unavailable." is shown — only Cancel / X can close.

### Button wiring (called once in `_bindEvents`)

```javascript
this.elements.btnCutTl.addEventListener('click', () =>
    this._setCutLeft(this._cutState.leftAction === 'trash' ? null : 'trash'));
this.elements.btnCutKl.addEventListener('click', () =>
    this._setCutLeft(this._cutState.leftAction === 'keep'  ? null : 'keep'));
this.elements.btnCutKr.addEventListener('click', () =>
    this._setCutRight(this._cutState.rightAction === 'keep'  ? null : 'keep'));
this.elements.btnCutTr.addEventListener('click', () =>
    this._setCutRight(this._cutState.rightAction === 'trash' ? null : 'trash'));

this.elements.cutDialogClose .addEventListener('click', () => this._closeCutDialog());
this.elements.cutDialogCancel.addEventListener('click', () => this._closeCutDialog());
this.elements.cutDialogOk    .addEventListener('click', () => this._commitCut().catch(err => console.error(err)));
```

### Show dialog

```javascript
async showCutDialog() {
    if (!this.state.currentSampleId || !this.state.mutable) return;

    // Reset state
    this._cutState = { leftAction: null, rightAction: null };
    this._setCutLeft(null);
    this._setCutRight(null);

    // Reset waveform to placeholder
    this.elements.cutWaveformImg.src = '/static/img/waveform_placeholder.png';
    this.elements.cutWaveformStatus.textContent = 'Previewing waveform, please wait...';
    this.elements.cutDialogOk.disabled = true;

    this.elements.cutDialogOverlay.classList.remove('hidden');

    // Async waveform fetch — replaces placeholder when ready
    const beginOffset = this.state.originalStartOffset;
    const url = `/api/cut_waveform/${this.state.currentSampleId}`
              + `?begin_offset=${beginOffset}&width=560&height=90`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const blob = await res.blob();
            this.elements.cutWaveformImg.src = URL.createObjectURL(blob);
            this.elements.cutWaveformStatus.textContent = '';
        } else {
            this.elements.cutWaveformStatus.textContent = 'Waveform unavailable.';
        }
    } catch (_) {
        this.elements.cutWaveformStatus.textContent = 'Waveform unavailable.';
    }
    this._updateCutOkState();   // re-evaluate now that waveform status is settled
},
```

### Close dialog

```javascript
_closeCutDialog() {
    this.elements.cutDialogOverlay.classList.add('hidden');
},
```

### Commit cut

After the action the original sample is always archived, so call `_postArchiveRefresh()` —
the same method `archiveSample()` calls — which polls status, reloads labels, and loads
a new random sample via `loadNextRandom(this.state.isPlaying)`.

```javascript
async _commitCut() {
    const { leftAction, rightAction } = this._cutState;
    if (!leftAction || !rightAction) return;

    this._closeCutDialog();

    const res = await fetch('/api/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sample_id:    this.state.currentSampleId,
            begin_offset: this.state.originalStartOffset,
            keep_left:    leftAction  === 'keep',
            trash_left:   leftAction  === 'trash',
            keep_right:   rightAction === 'keep',
            trash_right:  rightAction === 'trash',
        }),
    });

    const data = await res.json();
    if (!res.ok) {
        this.showErrorToast(data.error || 'Cut failed');
        return;
    }

    // Show toasts with 3.2 s stagger so they don't overlap
    (data.toasts ?? []).forEach((msg, i) =>
        setTimeout(() => this.showToast(msg), i * 3200));

    // Original was archived — load a new random sample (same as A key)
    if (data.archived) {
        await this._postArchiveRefresh();
    }
},
```

---

## Backend

### Module-level imports

All imports must be at module level — no JIT imports inside route functions.

**`app.py`** — add to the existing top-level import block:

```python
import re                                          # stdlib, already available
from groove import db, audio, transient as _transient   # audio already added earlier
```

`re` is used for the basename suffix-stripping in the cut route. It is stdlib and has no
cost, so there is no reason to defer it.

**`groove/audio_common.py`** — add at module level:

```python
from PIL import Image, ImageDraw   # already imported
import io                          # already imported
import numpy as np                 # already imported
```

**`groove/audio_wav.py`** — top of file (already has these):

```python
import io
import numpy as np
import soundfile as sf
from groove.audio_common import render_waveform_png, cut_window, CUT_WRITE_BUFFER
```

**`groove/audio_mp3.py`** — top of file (already has these):

```python
import io
import miniaudio
import numpy as np
import soundfile as sf
from groove.audio_common import render_waveform_png, cut_window, CUT_WRITE_BUFFER
```

---

### Constants (`groove/audio_common.py`)

```python
CUT_WAVEFORM_ZOOM = 1.5    # visible window = total_frames / zoom (1 = full file)
CUT_WRITE_BUFFER  = 65536  # frames per streaming read/write chunk (~1.5 s at 44.1 kHz)
```

---

### Shared window helper (`groove/audio_common.py`)

```python
def cut_window(total_frames, begin_offset):
    """Return (w_start, w_end) for a CUT_WAVEFORM_ZOOM-centred view on begin_offset."""
    window = int(total_frames / CUT_WAVEFORM_ZOOM)
    half   = window // 2
    w_start = begin_offset - half
    w_end   = begin_offset + half
    if w_start < 0:
        w_start, w_end = 0, min(total_frames, window)
    elif w_end > total_frames:
        w_start, w_end = max(0, total_frames - window), total_frames
    return w_start, w_end
```

---

### `render_waveform_png` update (`groove/audio_common.py`)

Add optional `cut_px=None`. No change to existing callers.

```python
def render_waveform_png(mins, maxs, width, height, cut_px=None):
    img  = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # … existing waveform drawing …

    if cut_px is not None:
        dash_color = (220, 220, 220, 200)
        for y in range(0, height, 6):        # 3 px on, 3 px gap
            draw.line([(cut_px, y), (cut_px, y + 3)], fill=dash_color, width=1)

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()
```

---

### Centred waveform — `generate_cut_waveform` per format

Reads **only the zoom window** from disk — never the full file.

#### `groove/audio_wav.py`

Uses `sf.SoundFile.seek()` to start at `w_start`; reads `block_size` frames per column.

```python
def generate_cut_waveform(path, begin_offset, width=560, height=90):
    info   = sf.info(path)
    total  = info.frames
    w_start, w_end = cut_window(total, begin_offset)
    window = w_end - w_start

    block_size = max(1, window // width)
    mins = np.zeros(width)
    maxs = np.zeros(width)

    with sf.SoundFile(path) as f:
        f.seek(w_start)
        for i in range(width):
            data = f.read(block_size)
            if len(data) == 0:
                break
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            mins[i] = data.min()
            maxs[i] = data.max()

    cut_px = int((begin_offset - w_start) / max(1, window) * width)
    return render_waveform_png(mins, maxs, width, height, cut_px=cut_px)
```

#### `groove/audio_mp3.py`

Streams via `miniaudio.stream_file()`, skipping frames before `w_start` and stopping at
`w_end` — avoids decoding the full file into memory.

```python
def generate_cut_waveform(path, begin_offset, width=560, height=90):
    mi    = miniaudio.get_file_info(path)
    total = mi.num_frames
    w_start, w_end = cut_window(total, begin_offset)
    window = w_end - w_start

    block_size = max(1, window // width)
    mins = np.zeros(width)
    maxs = np.zeros(width)
    col  = 0
    pos  = 0

    stream = miniaudio.stream_file(
        path,
        output_format=miniaudio.SampleFormat.FLOAT32,
        nchannels=1,
        frames_to_read=block_size,
    )
    for chunk_bytes in stream:
        chunk      = np.frombuffer(chunk_bytes, dtype=np.float32)
        chunk_end  = pos + len(chunk)

        if chunk_end <= w_start:        # before window — skip
            pos = chunk_end
            continue
        if pos >= w_end:                # past window — stop
            break

        local_start = max(0, w_start - pos)
        local_end   = min(len(chunk), w_end - pos)
        trimmed     = chunk[local_start:local_end]

        if col < width and len(trimmed) > 0:
            mins[col] = trimmed.min()
            maxs[col] = trimmed.max()
            col += 1

        pos = chunk_end

    cut_px = int((begin_offset - w_start) / max(1, window) * width)
    return render_waveform_png(mins, maxs, width, height, cut_px=cut_px)
```

#### `groove/audio.py` dispatcher

```python
def generate_cut_waveform(path, begin_offset, width=560, height=90):
    ext = os.path.splitext(path)[1].lower()
    if ext in audio_wav.EXTENSIONS:
        return audio_wav.generate_cut_waveform(path, begin_offset, width, height)
    if ext in audio_mp3.EXTENSIONS:
        return audio_mp3.generate_cut_waveform(path, begin_offset, width, height)
    return None
```

---

### Streaming slice writer — `save_slice_wav` per format

The full file is **never loaded into memory**. Both functions write in `CUT_WRITE_BUFFER`-frame
chunks and produce 16-bit PCM WAV output.

#### `groove/audio_wav.py`

`sf.SoundFile.seek()` lets us start reading at any frame offset directly.

```python
def save_slice_wav(src_path, dest_path, start_frame, end_frame):
    with sf.SoundFile(src_path) as src:
        src.seek(start_frame)
        with sf.SoundFile(dest_path, mode='w',
                          samplerate=src.samplerate,
                          channels=src.channels,
                          subtype='PCM_16') as dst:
            remaining = end_frame - start_frame
            while remaining > 0:
                data = src.read(min(CUT_WRITE_BUFFER, remaining))
                if len(data) == 0:
                    break
                dst.write(data)
                remaining -= len(data)
```

#### `groove/audio_mp3.py`

`miniaudio` has no seek API; stream from the start and skip/stop at the boundary.

```python
def save_slice_wav(src_path, dest_path, start_frame, end_frame):
    mi = miniaudio.get_file_info(src_path)
    stream = miniaudio.stream_file(
        src_path,
        output_format=miniaudio.SampleFormat.FLOAT32,
        nchannels=mi.nchannels,
        frames_to_read=CUT_WRITE_BUFFER,
    )
    pos = 0
    with sf.SoundFile(dest_path, mode='w',
                      samplerate=mi.sample_rate,
                      channels=mi.nchannels,
                      subtype='PCM_16') as dst:
        for chunk_bytes in stream:
            chunk      = np.frombuffer(chunk_bytes, dtype=np.float32)
            if mi.nchannels > 1:
                chunk = chunk.reshape(-1, mi.nchannels)
            chunk_frames = chunk.shape[0] if chunk.ndim > 1 else len(chunk)
            chunk_end    = pos + chunk_frames

            if chunk_end <= start_frame:        # before slice — skip
                pos = chunk_end
                continue
            if pos >= end_frame:                # past slice — stop
                break

            local_start = max(0, start_frame - pos)
            local_end   = min(chunk_frames, end_frame - pos)
            dst.write(chunk[local_start:local_end])
            pos = chunk_end
```

#### `groove/audio.py` dispatcher

```python
def save_slice_wav(src_path, dest_path, start_frame, end_frame):
    ext = os.path.splitext(src_path)[1].lower()
    if ext in audio_wav.EXTENSIONS:
        return audio_wav.save_slice_wav(src_path, dest_path, start_frame, end_frame)
    if ext in audio_mp3.EXTENSIONS:
        return audio_mp3.save_slice_wav(src_path, dest_path, start_frame, end_frame)
    raise ValueError(f'Unsupported format for cut: {ext}')
```

---

### Centred waveform endpoint (`app.py`)

```python
@app.route('/api/cut_waveform/<int:sample_id>')
def api_cut_waveform(sample_id):
    begin_offset = int(request.args.get('begin_offset', 0))
    width  = int(request.args.get('width',  560))
    height = int(request.args.get('height',  90))

    with db.get_db() as conn:
        row = db.fetch_sample_path(conn, sample_id)
    if not row or not os.path.exists(row['path']):
        return jsonify({'error': 'not found'}), 404

    png_bytes = audio.generate_cut_waveform(row['path'], begin_offset, width, height)
    if png_bytes is None:
        return jsonify({'error': 'unsupported format'}), 422
    return send_file(io.BytesIO(png_bytes), mimetype='image/png')
```

---

### Cut endpoint (`app.py`)

```python
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

    # Both sides trashed → archive only (same as the A key)
    if trash_left and trash_right:
        with db.get_db() as conn:
            _archive_file(src_path, conn, sample_id)
        base = os.path.splitext(os.path.basename(src_path))[0]
        ext  = os.path.splitext(src_path)[1]
        toasts.append(f'Sample {base}{ext} renamed to {base}{ext}.bak')
        archived = True

    else:
        sr, total = audio.get_audio_info(src_path)   # fast metadata read, no decode
        end_sample = total - 1
        base_dir   = os.path.dirname(src_path)
        base       = os.path.splitext(os.path.basename(src_path))[0]
        base       = re.sub(r'-\d{8}-\d{8}$', '', base)  # strip chained suffix

        def fmt(n):
            return f'{int(n):08d}'

        if keep_left:
            left_path = os.path.join(base_dir, f'{base}-{fmt(0)}-{fmt(begin_offset - 1)}.wav')
            audio.save_slice_wav(src_path, left_path, 0, begin_offset)
            toasts.append(f'Sample {os.path.basename(left_path)} is cut')

        if keep_right:
            right_path = os.path.join(base_dir, f'{base}-{fmt(begin_offset)}-{fmt(end_sample)}.wav')
            audio.save_slice_wav(src_path, right_path, begin_offset, total)
            toasts.append(f'Sample {os.path.basename(right_path)} is cut')

        with db.get_db() as conn:
            _archive_file(src_path, conn, sample_id)
        archived = True

        # Re-queue directory so new WAV files are indexed
        scan_queue.push_folder(base_dir)

    return jsonify({'toasts': toasts, 'archived': archived})
```

#### Helper `_archive_file`

Extracted from the existing `archive_sample` route so both routes share it:

```python
def _archive_file(path, conn, sample_id):
    """Rename path → path.bak and remove from DB."""
    os.rename(path, path + '.bak')
    db.delete_sample_by_id(conn, sample_id)
```

`db.delete_sample_by_id` is a new DB helper alongside the existing
`db.delete_sample_by_digest` — add it to `groove/db.py`.

---

## File Naming Convention

Given original file `SAMPLE_NAME.ext` with `begin_offset = B` and `total_frames = N`:

| Output | File name |
|---|---|
| Left side (keep) | `SAMPLE_NAME-00000000-{B-1:08d}.wav` |
| Right side (keep) | `SAMPLE_NAME-{B:08d}-{N-1:08d}.wav` |
| Original (archived) | `SAMPLE_NAME.ext.bak` |

Offsets are zero-padded to 8 digits. If `SAMPLE_NAME` already ends in `-XXXXXXXX-XXXXXXXX`
(was itself a cut result), strip that suffix before appending new offsets to avoid chaining.

**Example:** `kick-loop.wav`, 44 100 frames, cut at frame 22 050:
- Left:  `kick-loop-00000000-00022049.wav`
- Right: `kick-loop-00022050-00044099.wav`
- Bak:   `kick-loop.wav.bak`

---

## Toast messages

| Condition | Message |
|---|---|
| Keep left | `Sample kick-loop-00000000-00022049.wav is cut` |
| Keep right | `Sample kick-loop-00022050-00044099.wav is cut` |
| Both trash | `Sample kick-loop.wav renamed to kick-loop.wav.bak` |

Multiple toasts (keep both sides) are staggered 3.2 s apart in JS so they don't overlap.

---

## Re-scan Behaviour

After any cut that produces new files, the source directory is pushed back into the scan
queue so the indexer picks up the new WAV files without requiring a manual refresh:

```python
scan_queue.push_folder(base_dir)
```

Identical to the pattern in `add_folder()` (app.py ~line 749).

---

## Edge cases

| Case | Handling |
|---|---|
| `begin_offset == 0` | Left side is empty — validate server-side, return 400 |
| `begin_offset >= total_frames` | Right side is empty — same |
| Destination file already exists | Append `-1`, `-2` suffix before `.wav` to avoid clobbering |
| Mutable mode toggled off while dialog is open | Server-side `MUTABLE` check returns 403; JS shows error toast |
| Waveform fetch fails | Status text = "Waveform unavailable."; OK stays disabled |
| Audio file is MP3 | `save_slice_wav` streams via miniaudio; output is always 16-bit PCM WAV |
