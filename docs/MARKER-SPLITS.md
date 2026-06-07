# Marker Splits — Design Document

Feature: **Pinned Marker Splits**
Adds the ability to place evenly-spaced (linear) or randomly-distributed pinned markers across a sample in one click.

---

## 1. UI Changes — `templates/index.html`

### 1.1 Offset info-row layout

The existing Offset row (line 1664) currently holds:

```
[label-group]  …  [btn-find-transient] [sample-offset input]
```

The new layout inserts the split-controls between the label-group and the existing transient button, separated from them by an accent-color vertical divider:

```
[label-group]  [marker-count input▾] [btn-set-linear] [btn-set-random]  │  [btn-find-transient] [sample-offset]
```

The label-group (icon + "Offset:" text) and the `btn-find-transient` / `sample-offset` pair are unchanged.

#### New elements (inside the existing right-side `<span style="display:flex;…">`):

| Element | ID | Notes |
|---|---|---|
| Marker count combobox | `marker-count` | `<input type="text">`, styled like `.index-input` but narrower (~60 px); shows dropdown on click |
| Dropdown overlay list | `marker-count-dropdown` | Absolute-positioned list with options 2, 4, 8, 16, 32 |
| Set linear button | `btn-set-linear` | `.panel-icon-btn`, FA icon `fa-arrows-left-right-to-line` |
| Set random button | `btn-set-random` | `.panel-icon-btn`, FA icon `fa-dice` |
| Vertical divider | `marker-split-divider` | `1px solid var(--accent-color)`, `height: 1.4em`, `align-self: center` |

The divider sits between `btn-set-random` and `btn-find-transient`, visually separating the split section from the transient section.

#### HTML fragment (replaces the right-side span of the Offset info-row):

```html
<span style="display:flex;align-items:center;gap:4px;">
    <!-- marker count combobox -->
    <span style="position:relative;">
        <input type="text" id="marker-count" class="index-input marker-count-input"
               value="0" inputmode="numeric" autocomplete="off" title="Number of markers to place (0 = none)">
        <ul id="marker-count-dropdown" class="marker-count-dropdown hidden">
            <li data-value="2">2</li>
            <li data-value="4">4</li>
            <li data-value="8">8</li>
            <li data-value="16">16</li>
            <li data-value="32">32</li>
        </ul>
    </span>
    <button id="btn-set-linear" class="panel-icon-btn" title="Place markers at equal intervals">
        <i class="fa-solid fa-arrows-left-right-to-line"></i>
    </button>
    <button id="btn-set-random" class="panel-icon-btn" title="Place markers at random positions">
        <i class="fa-solid fa-dice"></i>
    </button>
    <!-- visual section divider -->
    <span id="marker-split-divider"></span>
    <!-- existing elements — unchanged -->
    <button id="btn-find-transient" class="panel-icon-btn" title="Jump to next transient (T)">
        <i class="fa-solid fa-wave-square"></i>
    </button>
    <input type="text" id="sample-offset" class="index-input" value="00000000">
</span>
```

### 1.2 New CSS

Add inside the existing `<style>` block:

```css
/* marker count combobox */
.marker-count-input {
    width: 60px;
    text-align: center;
    cursor: pointer;
}

.marker-count-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 200;
    background: var(--box-bg);
    border: 1px solid var(--accent-color);
    border-radius: 4px;
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
    min-width: 100%;
}

.marker-count-dropdown li {
    padding: 4px 10px;
    cursor: pointer;
    color: var(--text-color);
    font-family: var(--font-family);
    font-size: 0.9em;
}

.marker-count-dropdown li:hover {
    color: var(--accent-color);
    background: var(--input-bg);
}

/* vertical section divider */
#marker-split-divider {
    display: inline-block;
    width: 1px;
    height: 1.4em;
    background: var(--accent-color);
    align-self: center;
    opacity: 0.6;
    margin: 0 2px;
}
```

### 1.3 Overwrite-markers confirmation dialog

Add alongside the existing `delete-markers-overlay` dialog:

```html
<!-- Overwrite markers confirmation dialog -->
<div id="overwrite-markers-overlay" class="dialog-overlay hidden">
    <div id="overwrite-markers-dialog" class="dialog-card">
        <div class="dialog-header">
            <span>
                <i class="fa-solid fa-map-pin" style="color:var(--accent-color);margin-right:6px;"></i>
                Overwrite markers?
            </span>
            <button id="overwrite-markers-close" class="dialog-close-btn" title="Close">&times;</button>
        </div>
        <div class="dialog-body">
            <p>Are you sure you want to overwrite current markers?</p>
        </div>
        <div class="dialog-footer">
            <button id="overwrite-markers-cancel">Cancel</button>
            <button id="overwrite-markers-ok">OK</button>
        </div>
    </div>
</div>
```

---

## 2. Back-end Changes — `app.py`

### 2.1 Expose `MAX_MARKERS` via `/api/info`

```python
@app.route('/api/info')
def get_info():
    return jsonify({
        "db_path":     db.DB_FILE,
        "version":     get_version(),
        "mutable":     app.config.get('MUTABLE', False),
        "max_markers": MAX_MARKERS,          # <-- add this
    })
```

### 2.2 New endpoint: place linear markers

```
POST /api/sample/<int:sample_id>/markers/linear
Body: { "count": <int> }
```

**Logic:**
1. Validate `count`: must be `1 ≤ count ≤ MAX_MARKERS`; return 400 otherwise.
2. Fetch `duration_samples` from the sample record; return 404 if sample not found.
3. Call `db.delete_all_markers(conn, sample_id)` to clear existing pinned markers.
4. Compute offsets — two cases:
   - **`count = 1`**: place the single marker at the exact midpoint: `round(duration_samples / 2)`. It does **not** start at offset 0; a lone marker at 0 would be indistinguishable from the default begin offset and provides no useful split point.
   - **`count ≥ 2`**: first marker at offset `0`; remaining `count - 1` markers at `round(i * duration_samples / count)` for `i` in `1 .. count-1`. This divides the sample into `count` equal segments.
5. Insert each offset with `db.insert_marker(conn, sample_id, offset)`.
6. Return `{"status": "ok", "markers": [list of inserted offsets]}` with 200.

```python
@app.route('/api/sample/<int:sample_id>/markers/linear', methods=['POST'])
def set_linear_markers(sample_id):
    data  = request.get_json(silent=True) or {}
    count = data.get('count')
    if count is None or not isinstance(count, int) or not (1 <= count <= MAX_MARKERS):
        return jsonify({'error': 'invalid count'}), 400
    with db.get_db() as conn:
        sample = db.fetch_sample_by_id(conn, sample_id)
        if not sample:
            return jsonify({'error': 'not_found'}), 404
        total = sample['duration_samples'] or 0
        db.delete_all_markers(conn, sample_id)
        if count == 1:
            offsets = [round(total / 2)]
        else:
            offsets = [0] + [round(i * total / count) for i in range(1, count)]
        for off in offsets:
            db.insert_marker(conn, sample_id, off)
    return jsonify({'status': 'ok', 'markers': offsets})
```

### 2.3 New endpoint: place random markers

```
POST /api/sample/<int:sample_id>/markers/random
Body: { "count": <int> }
```

**Logic:**
1. Validate `count` same as linear.
2. Fetch `duration_samples`.
3. Call `db.delete_all_markers`.
4. Generate `count` unique random integers in `[0, duration_samples)` using `random.sample`.
5. Sort them and insert with `db.insert_marker`.
6. Return `{"status": "ok", "markers": [sorted offsets]}`.

```python
@app.route('/api/sample/<int:sample_id>/markers/random', methods=['POST'])
def set_random_markers(sample_id):
    data  = request.get_json(silent=True) or {}
    count = data.get('count')
    if count is None or not isinstance(count, int) or not (1 <= count <= MAX_MARKERS):
        return jsonify({'error': 'invalid count'}), 400
    with db.get_db() as conn:
        sample = db.fetch_sample_by_id(conn, sample_id)
        if not sample:
            return jsonify({'error': 'not_found'}), 404
        total = sample['duration_samples'] or 0
        db.delete_all_markers(conn, sample_id)
        population = total if total > count else count
        offsets = sorted(random.sample(range(population), min(count, population)))
        for off in offsets:
            db.insert_marker(conn, sample_id, off)
    return jsonify({'status': 'ok', 'markers': offsets})
```

---

## 3. Front-end JavaScript

### 3.1 Constants and state

```js
// Fetched once from /api/info on load; stored as module-level constant.
let MAX_MARKERS = 32;

// Dirty-marker flag — tracks whether current markers were user-applied
// (manually or via random sample load), requiring an overwrite confirmation.
// Reset to false after a split-button action completes successfully.
// Set to true when:
//   - user manually pins or deletes a marker on the waveform
//   - a new sample is loaded via the random-sample button
//   - a sample is loaded from disk
let markersDirty = false;
```

Fetch `MAX_MARKERS` during app initialization:

```js
async function fetchAppInfo() {
    const res = await fetch('/api/info');
    const info = await res.json();
    MAX_MARKERS = info.max_markers ?? 32;
}
```

### 3.2 Marker count input behaviour

- **Default value**: `"0"` (display text; means "no markers set").
- **Input is numeric only**: on `input` event, strip non-digit characters.
- **Dropdown**: clicking the input opens `#marker-count-dropdown`; clicking a list item sets the input value and closes the dropdown.
- **Focus-loss validation** (`blur` event):
  - Parse as integer.
  - If `NaN`, negative, or `> MAX_MARKERS`: reset to `"0"`.
  - Values in range `1 .. MAX_MARKERS` are accepted as-is.
- **Close dropdown** on outside click (document `click` listener that checks `!el.contains(event.target)`).
- **Button gating**: whenever the resolved value of `marker-count` is `0` (default, or reset after invalid input), both `btn-set-linear` and `btn-set-random` must be `disabled`. They are re-enabled as soon as the value becomes `≥ 1`. This check runs on every `input` event and after every `blur` validation so the disabled state is always in sync with the current value.

### 3.3 Dirty-flag tracking

Set `markersDirty = true` in:
- The handler that pins a new marker (`M` key / `CTRL+ENTER`).
- The handler that deletes a single marker.
- The handler that deletes all markers (D key confirmation → ok).
- The handler that moves a marker when transient T is pressed and a marker 
  is selected to be moved
- After a random sample is picked and loaded.
- After a sample is loaded from disk / file system browse.

Set `markersDirty = false` in:
- After `applyMarkerSplit()` completes successfully (both linear and random paths).

### 3.4 `applyMarkerSplit(mode)` — shared split logic

```
mode: 'linear' | 'random'
```

1. Read `marker-count` input; parse to integer. If `0` or invalid, alert user and abort.
2. Get `currentSampleId` (the active sample). If none, abort.
3. Check `markersDirty`:
   - If `true` AND there are currently pinned markers visible in the UI → show `#overwrite-markers-overlay` and await user response (OK/Cancel).
   - If cancelled → abort.
4. Call `POST /api/sample/{id}/markers/{mode}` with `{ count }`.
5. On success: call the existing marker-refresh function (e.g. `loadMarkers(currentSampleId)` or equivalent) to redraw markers in the waveform.
6. Set `markersDirty = false`.

### 3.5 Wire up buttons

```js
document.getElementById('btn-set-linear').addEventListener('click', () => applyMarkerSplit('linear'));
document.getElementById('btn-set-random').addEventListener('click', () => applyMarkerSplit('random'));
```

### 3.6 Overwrite-markers dialog wiring

```js
document.getElementById('overwrite-markers-ok').addEventListener('click', () => {
    hideDialog('overwrite-markers-overlay');
    pendingSplitResolve(true);
});
document.getElementById('overwrite-markers-cancel').addEventListener('click', () => {
    hideDialog('overwrite-markers-overlay');
    pendingSplitResolve(false);
});
document.getElementById('overwrite-markers-close').addEventListener('click', () => {
    hideDialog('overwrite-markers-overlay');
    pendingSplitResolve(false);
});
```

`pendingSplitResolve` is a Promise resolver stored when the dialog is shown:

```js
let pendingSplitResolve = null;

function confirmOverwrite() {
    return new Promise(resolve => {
        pendingSplitResolve = resolve;
        showDialog('overwrite-markers-overlay');
    });
}
```

---

## 4. Behaviour Summary

| Event | `markersDirty` before | Dialog shown? | `markersDirty` after |
|---|---|---|---|
| User pins/deletes a marker | any | no | `true` |
| Random sample loaded | any | no | `true` |
| Sample loaded from disk | any | no | `true` |
| Set linear / set random pressed, no pinned markers | any | no | `false` |
| Set linear / set random pressed, pinned markers exist, `markersDirty = false` | `false` | no | `false` |
| Set linear / set random pressed, pinned markers exist, `markersDirty = true` | `true` | yes | `false` (on OK) |
| Dialog cancelled | `true` | yes | `true` (unchanged) |

---

## 5. Files Affected

| File | Change |
|---|---|
| `app.py` | Add `max_markers` to `/api/info`; add `set_linear_markers` and `set_random_markers` routes |
| `templates/index.html` | Add marker-count combobox, two split buttons, divider; CSS for new elements; overwrite dialog; JS for all new behaviour |
| `groove/db.py` | No changes needed — existing `delete_all_markers` and `insert_marker` are sufficient |

---

## 6. Open Questions / Constraints

- **Offset 0 first marker (linear)**: the spec says first marker at offset `0000`. This is implemented exactly — the first element of the linear offsets array is always `0`.
- **Random duplicate offsets**: `random.sample` guarantees uniqueness, so no duplicate offsets will be generated.
- **Count = 1 (linear)**: places the marker at the sample midpoint (`round(duration_samples / 2)`), not at offset 0. A marker at 0 is indistinguishable from the default begin offset and is not a useful split. Random mode is unaffected — it picks one random offset anywhere in the sample.
- **`duration_samples` = 0 or null**: edge case for corrupt/missing entries. Random endpoint clamps population to avoid a `range(0)` error. Linear endpoint inserts a single marker at 0. Consider returning a 422 with a meaningful message instead.
