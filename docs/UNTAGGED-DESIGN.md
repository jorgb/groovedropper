# UNTAGGED Label — Design Document

## Overview

The UNTAGGED label is a special, non-editable pseudo-label that sits between the
label-list header and the regular label list. It acts as a toggle filter that
restricts randomization to samples that have no associated labels. It is visually
distinct from regular labels and behaves differently from them in every respect.

---

## Visual Design

### Placement

```
┌─────────────────────────────┐
│  Labels               [+]   │  ← #label-list-header
├─────────────────────────────┤
│  ◻ UNTAGGED          (42)  │  ← UNTAGGED pseudo-label (outlined, no fill)
├─  ─  ─  ─  ─  ─  ─  ─  ─  ┤  ← slight margin (e.g. margin-bottom: 6px)
│  ☑ □ ▶ Vinyl         (12)  │  ← regular labels start here
│  ☐ □ ▶ Drums         (7)   │
│  …                          │
└─────────────────────────────┘
```

### Appearance (inactive state)

- **Container:** `#untagged-label-row` — no checkbox, full-width
- **Tag element:** outlined with `var(--accent-color)` at reduced opacity (≈ 0.45),
  **no background fill** (contrast with regular labels which use a filled clip-path shape)
- **Text:** `UNTAGGED` in `var(--accent-color)`, same font as label names
- **Count badge:** sample count for untagged samples, same position as `.label-count`
  on regular labels, rendered in accent color at reduced opacity
- **Clip-path / border:** use `outline` or `border` instead of background fill to
  convey the "empty / unassigned" semantic. Regular label shape (bookmark clip-path)
  can be kept but with a transparent fill and a 1px accent-colored border via
  `drop-shadow` or SVG outline technique

### Appearance (active/selected state)

- Background fill: `var(--accent-color)` at transparency (same as active preset labels)
- Text color: **black** (`#000`) — inverted from normal accent text
- Count badge: also inverted to black
- The bookmark/tag shape fills with the accent color, same visual rhythm as other
  selected-state labels

### Spacing

- `margin-bottom: 6px` on `#untagged-label-row` (or a thin `<hr>` separator) to
  create visual separation before the regular label list begins

---

## Behavior

### Toggle semantics

- The UNTAGGED label is a **click-only toggle**; it cannot be activated by any other
  means (no preset interaction, no keyboard shortcut to select it directly).
- **Activate:** user clicks UNTAGGED while it is inactive → it becomes active.
- **Deactivate:** user clicks UNTAGGED while it is active → it becomes inactive.
- **Deactivate:** user selects a preset while it is active → it becomes inactive.
- On **activate**: all currently-active preset label selections are cleared
  (`allPresetSelectedLabelIds = []`).
- On **deactivate by label selection**: if the user clicks a regular label (or a
  preset is applied), `untaggedFilterActive` resets to `false` automatically.

### Focus / blur

- After the click handler runs, call `document.activeElement.blur()` so that
  keyboard shortcuts (R, arrow keys, etc.) remain operational immediately.

### Randomization (R key)

When `untaggedFilterActive === true`:
- R key calls `loadNextRandom()` with an additional flag (`untagged_only: true`)
  passed to `POST /api/sample/random`.
- The backend query changes to: fetch a random sample whose `digest` does NOT
  appear in `sample_labels` at all.
- Shift+R (randomize offset on current sample) is unaffected by UNTAGGED state.

### Count update

The UNTAGGED count reflects the number of samples in the library that have zero
entries in `sample_labels`. It must refresh whenever:
1. A label is added to a sample (`toggleSampleLabel` adds a label).
2. A label is removed from a sample (`toggleSampleLabel` removes a label).
3. A new folder scan completes (new samples may arrive untagged).
4. A label is deleted entirely (samples that only had that label become untagged).

The simplest approach is to re-fetch the untagged count after any of the above
operations (same pattern used for `loadLabels()`).

---

## State Changes

Add one new field to `GrooveDropper.state`:

```js
untaggedFilterActive: false,   // true when UNTAGGED toggle is on
```

And one derived value (not stored, computed on render):

```js
untaggedCount: 0,   // fetched from backend; stored as this.untaggedCount
```

---

## JavaScript Changes (`static/js/app.js`)

### 1. State initialisation

```js
untaggedFilterActive: false,
```

### 2. `renderLabelList()`

Before the `<ul>` of regular labels, inject the UNTAGGED row:

```js
renderUntaggedRow() {
    const active = this.state.untaggedFilterActive;
    const row = document.createElement('div');
    row.id = 'untagged-label-row';
    row.className = active ? 'active' : '';
    // tag element (no checkbox)
    const tag = document.createElement('span');
    tag.className = 'label-tag untagged-tag' + (active ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'label-name';
    name.textContent = 'UNTAGGED';
    const count = document.createElement('span');
    count.className = 'label-count';
    count.textContent = this.untaggedCount ?? '…';
    tag.append(name, count);
    row.append(tag);
    row.addEventListener('mousedown', (e) => {
        e.preventDefault();      // prevent focus steal
        this.toggleUntaggedFilter();
    });
    return row;
}
```

Call `renderUntaggedRow()` inside `renderLabelPanel()` / `renderLabelList()` and
insert the element before the `<ul id="label-list">`.

### 3. `toggleUntaggedFilter()`

```js
async toggleUntaggedFilter() {
    if (this.state.untaggedFilterActive) {
        this.state.untaggedFilterActive = false;
    } else {
        this.state.untaggedFilterActive = true;
        // deselect all preset label selections
        this.state.allPresetSelectedLabelIds = [];
    }
    document.activeElement?.blur();
    this.renderLabelList();
}
```

### 4. Deactivation from label / preset interaction

In `togglePresetLabel()`, `toggleAllPresetSelection()`, and `selectPreset()`:

```js
this.state.untaggedFilterActive = false;
```

### 5. `loadNextRandom()`

Pass the untagged flag when building the request body:

```js
if (this.state.untaggedFilterActive) {
    body.untagged_only = true;
    body.label_ids = [];
}
```

### 6. `loadUntaggedCount()` (new method)

```js
async loadUntaggedCount() {
    const res = await fetch('/api/samples/untagged-count');
    const data = await res.json();
    this.untaggedCount = data.count;
}
```

Call after `loadLabels()` and after `toggleSampleLabel()` completes.

---

## Backend Changes (`app.py` + `groove/db.py`)

### New API endpoint: `GET /api/samples/untagged-count`

```python
@app.route('/api/samples/untagged-count')
def untagged_count():
    with db.get_connection() as conn:
        count = db.fetch_untagged_sample_count(conn)
    return jsonify({'count': count})
```

### New DB function: `db.fetch_untagged_sample_count(conn)`

```sql
SELECT COUNT(*) FROM samples s
WHERE NOT EXISTS (
    SELECT 1 FROM sample_labels sl WHERE sl.digest = s.digest
);
```

### Modified: `POST /api/sample/random`

Add support for `untagged_only` in the request body:

```python
untagged_only = data.get('untagged_only', False)
if untagged_only:
    sample = db.fetch_random_untagged_sample(conn, ...)
else:
    # existing logic
```

### New DB function: `db.fetch_random_untagged_sample(conn, excluded_digest=None)`

```sql
SELECT * FROM samples s
WHERE NOT EXISTS (
    SELECT 1 FROM sample_labels sl WHERE sl.digest = s.digest
)
  AND s.digest != :excluded_digest   -- optional: avoid repeating current
ORDER BY RANDOM()
LIMIT 1;
```

---

## CSS Changes (`templates/index.html`)

```css
/* UNTAGGED pseudo-label row */
#untagged-label-row {
    display: flex;
    align-items: center;
    margin-bottom: 6px;       /* gap before regular labels */
    cursor: pointer;
    user-select: none;
}

/* Outlined tag — no fill */
.label-tag.untagged-tag {
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--accent-color) 45%, transparent);
    color: var(--accent-color);
}

/* Active / selected state */
.label-tag.untagged-tag.active {
    background: color-mix(in srgb, var(--accent-color) 35%, transparent);
    border-color: var(--accent-color);
    color: #000;
}

.label-tag.untagged-tag.active .label-name,
.label-tag.untagged-tag.active .label-count {
    color: #000;
}
```

> Note: `color-mix()` is supported in all modern browsers. If the project needs
> to target older environments, replace with a pre-computed RGBA value per theme.

---

## Files to Change

| File | Change |
|---|---|
| `static/js/app.js` | Add `untaggedFilterActive` state, `renderUntaggedRow()`, `toggleUntaggedFilter()`, `loadUntaggedCount()`, modify `loadNextRandom()`, `togglePresetLabel()`, `toggleAllPresetSelection()`, `selectPreset()` |
| `templates/index.html` | Add CSS for `#untagged-label-row`, `.label-tag.untagged-tag`, `.untagged-tag.active` |
| `app.py` | Add `GET /api/samples/untagged-count` route, extend `POST /api/sample/random` to handle `untagged_only` |
| `groove/db.py` | Add `fetch_untagged_sample_count()`, `fetch_random_untagged_sample()` |

---

## User-Facing Documentation

The following sections were added to `docs/USER-MANUAL.md`:

### Under "Labels & Presets" (bullet list intro)

Added a bullet pointing to the UNTAGGED filter subsection so users scanning
the overview know the feature exists.

### New subsection: "The UNTAGGED filter" (under "Filtering with labels")

> Directly below the **Labels** header sits a special **UNTAGGED** entry. It
> has no fill — just an outlined border — and it cannot be edited or assigned
> to samples. Its count badge shows how many samples in your library currently
> carry **no labels at all**.
>
> Click **UNTAGGED** to activate it as a toggle:
> - All other label selections are cleared while UNTAGGED is active.
> - Pressing **`R`** now randomizes exclusively over your unlabeled samples.
> - Click **UNTAGGED** again — or click any regular label or preset — to
>   deactivate it and return to normal filtering.
>
> This is handy for working through an "inbox" of uncategorized samples:
> activate UNTAGGED, hit **`R`** repeatedly, and tag each sample as you go.
> The count updates live as you label samples so you can see your inbox shrink.

---

## Edge Cases

| Scenario | Handling |
|---|---|
| No untagged samples exist | Count shows `0`; R key while UNTAGGED active plays nothing (show toast or no-op) |
| Current sample becomes tagged while UNTAGGED active | UNTAGGED filter stays active; next R skips it correctly |
| All samples are tagged | Count = 0; UNTAGGED toggle still clickable but R produces no result |
| Label deleted (cascades to `sample_labels`) | `loadUntaggedCount()` called after delete to refresh count |
| UNTAGGED active + user presses R = only one untagged sample | Same sample replays; identical to single-label filter behavior |
