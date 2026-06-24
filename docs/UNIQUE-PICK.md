# Unique Pick — Design Document

## Problem

The current random pick (`R`) selects from the full filtered pool with no memory. You can
get the same sample repeatedly. The goal is a persistent, filter-agnostic "front-load
unvisited samples" mode that survives restarts and lets you navigate the visit history
linearly with J / K.

---

## Core Idea

Attach a monotonically increasing **pick order** integer to each sample the moment it is
selected in unique-pick mode. Unvisited samples (NULL pick order) are always preferred;
once every sample in the current filter has been visited the oldest one (lowest pick
order) is chosen — an LRU restart that avoids an explicit reset.

---

## Data Model

### Column on `samples`

```sql
ALTER TABLE samples ADD COLUMN pick_order INTEGER DEFAULT NULL;
```

| Value | Meaning |
|-------|---------|
| `NULL` | Never picked in unique-pick mode |
| `1, 2, 3 …` | Visited; lower = older |

A global monotonic counter is maintained as `MAX(pick_order)` at pick time, incremented
by one and written back in the same transaction. No separate counter table is needed;
`SELECT COALESCE(MAX(pick_order), 0) + 1 FROM samples` is atomic in SQLite.

### In-memory cursor

The **cursor** tracks the current position inside the ordered pick window. It is **not**
stored in the database — it is reconstructed on load from the sample that is currently
displayed. It resets when the application starts or when unique-pick mode is toggled off
and back on.

```
cursor_sample_id : int | None   — which sample the view is currently on
```

---

## Ordered Pick Window

The **pick window** is the virtual ordered list of all samples that have `pick_order IS
NOT NULL`, sorted ascending by `pick_order`, then optionally narrowed by the active
filter. It grows at the right end every time a new sample is forward-picked.

```
window = [s₁, s₂, … sₙ]   oldest → newest
                          ↑
                       cursor
```

---

## Pick Algorithm

### Forward pick  (R key, or K when cursor is at the frontier)

```
pool    ← all samples matching the current filter

unvisited ← pool WHERE pick_order IS NULL
if unvisited is non-empty:
    candidate ← random sample from unvisited
else:
    candidate ← sample in pool with the lowest pick_order   # LRU restart
    # at this point pick_order will be updated and it rises to the top again

candidate.pick_order ← MAX(pick_order across ALL samples) + 1
cursor ← candidate
load candidate
```

Key properties:
- **All-unvisited pool:** purely random among unseen samples — no bias from previous
  filters.
- **Fully-visited pool (LRU restart):** the oldest visited sample is recycled. Its
  `pick_order` is updated so it moves to the end of the window, and the next-oldest
  becomes the new LRU target on the following pick. The window effectively becomes a
  round-robin over the current filter pool.
- **pick_order is global** — a sample visited under filter A still counts as visited
  when filter B is active.

### Backward navigate  (J key)

```
pos ← index of cursor_sample_id in window (filtered view)
if pos > 0:
    cursor ← window[pos - 1]
    load cursor          # no pick_order update
```

Does **not** change pick_order. Pure read-only navigation toward older samples.

### Forward navigate  (K key)

```
pos ← index of cursor_sample_id in window (filtered view)
if pos < len(window) - 1:
    cursor ← window[pos + 1]
    load cursor          # no pick_order update
else:
    run Forward pick     # cursor is at the frontier — consume next unique sample
```

---

## Filter Interaction

The filter is applied at **query time only**. The pick_order column is untouched by
filter changes.

| Scenario | Behaviour |
|----------|-----------|
| Switch from filter A → B before picking | Next pick draws from B's unvisited set |
| Sample visited under A, now in B's pool | Counts as visited; will be picked last |
| Filter B has zero unvisited samples | LRU restart within B's pool |
| Filter cleared (show all) | All previously visited samples in the full pool rank by pick_order |
| Filter returns zero samples | No pick; show a toast |

J / K navigation always respects the **current** filter. If you were on a sample that is
no longer in the active filter, backward/forward skips over it to the nearest in-filter
neighbour.

---

## Restart / Wrap Behaviour

There is no explicit reset. Instead:

1. Once the filter pool is fully visited the LRU candidate is picked (lowest pick_order
   in the pool).
2. Its `pick_order` is updated to the new global maximum → it sinks to the end of the
   window.
3. The next-oldest sample is now the new LRU.

This creates a natural round-robin without destroying historical order for samples
outside the current filter.

To **hard-reset** (clear all visit history) a separate "Clear pick history" action could
be added: `UPDATE samples SET pick_order = NULL`. This is outside the scope of this
document but the schema supports it trivially.

The **Refresh button** triggers an incremental re-scan of all configured folders; it does
**not** rebuild the database from scratch. However, pressing refresh is an intentional
"start over" gesture, so the `POST /api/samples/refresh` endpoint should explicitly reset
the pick window before queuing the scan:

```python
conn.execute('UPDATE samples SET pick_order = NULL')
```

This single statement empties the pick window so unique-pick mode starts fresh after the
refresh completes.

**Important:** this reset must only run inside the `refresh_samples()` Flask route — not
inside the background scanner or any scan job. Folder auto-adds, scheduled re-scans, or
scans triggered by watching the filesystem must never touch `pick_order`. Only the
explicit refresh button endpoint may reset it.

---

## Toggle

The **"Pick unique"** checkbox controls **only the R key (forward pick)**:

| State                     | R key behaviour | J / K / pick window |
|---------------------------|-----------------|---------------------|
| Pick unique OFF           | Picks fully at random from the filter pool | Always active — see below |
| Pick unique ON (default)  | Prefers unvisited samples; LRU restart when pool is exhausted | Always active — see below |

`pick_order` is recorded on **every** pick regardless of the toggle, so the pick window
is always being built. Toggling the checkbox never clears the window.

The toggle state is persisted in user config under key `pick-unique` (`"true"` /
`"false"`), set true by default.

UI element: checkbox labelled **"Pick unique"** placed next to the existing Autoplay
checkbox in the toolbar.

---

## J / K Navigation — Always Active

J / K **always** navigate the pick window, independent of the "Pick unique" checkbox.
This lets you slide back and forward over every sample you have visited in the current
session (or across restarts, since `pick_order` is persistent) regardless of whether
unique-pick mode is on.

| Key | Behaviour |
|-----|-----------|
| J | Backward in pick window — load the previously picked sample, no `pick_order` update |
| K | Forward in pick window; if at the frontier, forward-pick the next sample (respects the Pick unique toggle for candidate selection) |
| SHIFT + J | Jump to the **first** (oldest) sample in the filtered pick window |
| SHIFT + K | Jump to the **last** (most recently picked) sample in the filtered pick window |

Because J/K now always own pick-window navigation, quick-pick slot focus is no longer
reachable via J/K. Slots remain fully accessible through the `1–9 / 0` number keys.

---

## Code Organisation

All sample-selection logic — both the existing random pick and the new unique-pick
algorithm — lives in **`groove/sample_select.py`**. Flask endpoints in `app.py` stay as
thin wrappers that call into this module.

### What moves to `groove/sample_select.py`

| Function | Description |
|----------|-------------|
| `pick_random(conn, label_ids, filter_mode, untagged_only, sample_id_override)` | Replaces the inline logic currently in the `random_sample()` Flask route. Calls the existing `db.fetch_random_*` helpers and `get_random_offset`. Returns a ready-to-serialize result dict. |
| `pick_unique_next(conn, label_ids, filter_mode, untagged_only)` | Implements the forward-pick algorithm: prefers unvisited samples, LRU restarts when the pool is exhausted, writes `pick_order`, returns the sample. |
| `pick_window(conn, label_ids, filter_mode, untagged_only, around_id, limit)` | Returns an ordered slice of the pick window for J/K cursor positioning. |
| `pick_adjacent(conn, sample_id, direction, label_ids, filter_mode, untagged_only)` | Returns the adjacent sample in the filtered pick window without modifying `pick_order`. Used by J (direction=+1, not at frontier) and K (direction=-1). |

### What stays in `groove/db.py`

The raw SQL helpers (`fetch_random_sample`, `fetch_random_untagged_sample`,
`fetch_sample_by_id`, etc.) remain in `db.py`. `sample_select.py` imports them and
composes higher-level pick behaviour on top.

New DB helpers needed for unique-pick:

| Helper | SQL |
|--------|-----|
| `fetch_next_pick_order(conn)` | `SELECT COALESCE(MAX(pick_order), 0) + 1 FROM samples` |
| `set_pick_order(conn, sample_id, pick_order)` | `UPDATE samples SET pick_order = ? WHERE id = ?` |
| `fetch_unvisited_sample(conn, label_ids, filter_mode, untagged_only)` | Filtered `SELECT … WHERE pick_order IS NULL ORDER BY RANDOM() LIMIT 1` |
| `fetch_lru_sample(conn, label_ids, filter_mode, untagged_only)` | Filtered `SELECT … WHERE pick_order IS NOT NULL ORDER BY pick_order ASC LIMIT 1` |
| `fetch_pick_window(conn, label_ids, filter_mode, untagged_only, limit, offset)` | Filtered `SELECT … WHERE pick_order IS NOT NULL ORDER BY pick_order ASC` |
| `fetch_adjacent_in_window(conn, sample_id, direction, label_ids, filter_mode, untagged_only)` | One-step neighbour lookup in the filtered pick window |

### What stays in `app.py`

Only the Flask route decorators and request/response plumbing remain:

```python
@app.route('/api/sample/random', methods=['POST'])
def random_sample():
    ...
    result = sample_select.pick_random(conn, label_ids, filter_mode, untagged_only, sample_id_override)
    return jsonify(result)

@app.route('/api/unique-pick/next', methods=['POST'])
def unique_pick_next():
    ...
    result = sample_select.pick_unique_next(conn, label_ids, filter_mode, untagged_only)
    return jsonify(result)

@app.route('/api/unique-pick/window', methods=['GET'])
def unique_pick_window():
    ...
    result = sample_select.pick_window(conn, label_ids, filter_mode, untagged_only, around_id, limit)
    return jsonify(result)

@app.route('/api/unique-pick/adjacent', methods=['GET'])
def unique_pick_adjacent():
    ...
    result = sample_select.pick_adjacent(conn, sample_id, direction, label_ids, filter_mode, untagged_only)
    return jsonify(result)
```

---

## API Sketch

### `POST /api/unique-pick/next`

Request body: `{ label_ids, filter_mode, untagged }`  
Response: full sample object (same shape as the existing random-pick endpoint) plus
`pick_order` field.

Atomically:
1. Finds the next candidate per the algorithm above.
2. Writes the new `pick_order`.
3. Returns the sample.

### `GET /api/unique-pick/window`

Request params: `label_ids`, `filter_mode`, `untagged`, `around_id` (optional),
`limit` (default 50)

Returns an ordered slice of the pick window (filtered), for J/K cursor positioning.
Response: `{ samples: [...], total: N }` sorted by `pick_order ASC`.

### `GET /api/unique-pick/adjacent`

Params: `sample_id`, `direction` (`-1` or `+1`), filter params.

Returns the adjacent sample in the filtered pick window without modifying pick_order.
Used by J (direction=-1) and K when not at the frontier (direction=+1).

---

## Migration: Removing the Front-End History Stack

The current front end maintains an **in-memory history stack** (`historyQueue` /
`historyIndex` in `app.js` state) with `_pushHistory()` / `loadPrevHistory()`. The `P`
key walks it backwards. This stack is session-scoped, single-direction, and has no DB
backing.

With J/K pick-window navigation always active (see above), the history stack is
superseded:

| Capability | Old history stack | J / K pick window |
|------------|------------------|-------------------|
| Go back one sample | P key | K key |
| Go forward one sample | — (not possible) | J key |
| Persists across page reload | No | Yes (`pick_order` in DB) |
| Survives filter changes | No | Yes (filter applied at query time) |
| Jump to oldest / newest | No | SHIFT+J / SHIFT+K |

### What to remove

| Item | Location | Action |
|------|----------|--------|
| `state.historyQueue` | `app.js` state initialiser | Delete |
| `state.historyIndex` | `app.js` state initialiser | Delete |
| `_pushHistory(snapshot)` | `app.js` | Delete method |
| `loadPrevHistory(playInstantly)` | `app.js` | Delete method |
| `P` key binding | `app.js` keydown handler (`e.code === 'KeyP'`) | Delete |
| History push in `loadNextRandom()` | `app.js:456` | Remove `_pushHistory(data)` call |
| History push in `loadSpecificIndex()` | `app.js:469` | Remove `_pushHistory(data)` call |
| History push in `loadSpecificDigest()` | `app.js:492` | Remove `_pushHistory(data)` call |
| History push in quick-pick load | `app-quickpick.js:357` | Remove `_pushHistory(data)` call |
| `P` row in controls dialog | `templates/dialogs/controls.html` | Delete `<tr>` |
| J / K row under "Quick Pick" | `templates/dialogs/controls.html` | Move/update — see below |

### Controls dialog update

Remove the J/K row from the **Quick Pick** section. Add a new **Pick Window** section
(or append rows to **Samples**):

```
Pick Window
  J            Forward in pick window (forward-pick at frontier)
  K            Backward in pick window
  SHIFT + J    Jump to oldest sample in pick window
  SHIFT + K    Jump to most recently picked sample in pick window
```

The `1–9 / 0` and `V` / `SHIFT + 1–9` rows remain in Quick Pick unchanged.

### What does NOT change

- **Quick-pick slot loads** (`1–9 / 0`) load a snapshot and update `updateUI()` directly.
  They are deliberate slot recalls, not part of the forward-pick flow, so they do **not**
  move the pick-window cursor. No `pick_order` update occurs.
- **Digest / URL loads** (`loadSpecificDigest`) similarly do not trigger a pick-order
  write; they land the cursor on that sample's position in the window (if it has one).
- **`start_offset`** within a sample is not stored per pick-window entry. Loading a
  window neighbour always starts at the sample's configured start offset, matching the
  current behaviour of `loadPrevHistory`.

### Migration order

1. Implement and ship J/K pick-window backend + frontend.
2. Verify K replicates the most common P-key usage (go back one). 
3. Remove the history stack and P key in a follow-up commit.

---

## Edge Cases

| Case | Resolution |
|------|-----------|
| Pool size = 1 | The single sample is always picked (LRU restarts immediately) |
| Sample deleted from DB | `pick_order` gap is harmless; ordering still works |
| Sample added to DB | `pick_order = NULL` → it joins the unvisited front immediately |
| Application restart | Cursor reconstructed from the currently-loaded sample's `pick_order` position |
| pick unique toggled off and back on | Cursor resets to the currently displayed sample |
| All samples in the entire DB visited | Full LRU restart across the DB |
| Forward-pick while already navigating back through history | Picks next unique, appends to window end, moves cursor there |
