# Preset Shortcuts — Design Document

## Overview

A new **Quick Pick Bar** sits between the waveform and the sample-info panel. It lets the user store up to 10 sample snapshots (sample + pitch + playback offset) per named preset, and recall them instantly via number keys 1–0 on the keyboard. Multiple named presets can be switched from a dropdown, making it easy to prepare different "palettes" of sounds for a session.

---

## UI Layout

```
[ + ] [ dropdown ▾ ]  [ ☐ Play Instantly ]  [1] [2] [3] [4] [5] [6] [7] [8] [9]
[0]  [ 🗑 ]
```

### Elements (left to right)

| Element | Icon / Control | Purpose |
|---|---|---|
| Add preset button | `fa-solid fa-plus` | Create a new empty quick-pick preset |
| Preset dropdown | `<select>` or editable combobox | Select the active preset; type a new name + Enter to rename it |
| Play Instantly checkbox | `fa-solid fa-bolt` label | When checked, recalling a slot also starts playback immediately |
| Slot keys 1–0 | Outlined square buttons | Show fill state of each slot; press to recall |
| Delete preset button | `fa-solid fa-trash-can` | Delete the active preset and all its slots |

### Key Button Visual States

- **Empty slot** — outlined border in accent color, key digit in accent color, no fill
- **Filled slot** — accent color background, key digit in black (or `var(--bg-color)`) so it reads against the filled background
- **Filled slot, hovered** — a diagonal cross (`×`) overlaid on the button (CSS `::after` pseudo-element or an absolutely positioned `<i class="fa-solid fa-xmark">`) to signal that clicking will delete the slot; the digit is still visible underneath at reduced opacity
- **Active / just triggered** — brief flash or pressed state (CSS `:active`)

Font size and button size should match the compact bar height; square aspect ratio enforced via equal `width` / `height` or `aspect-ratio: 1`.

---

## Keyboard Shortcuts

| Key combo | Action |
|---|---|
| `Shift` + `1`–`9` | Save current sample snapshot into slot 1–9 of the active preset |
| `Shift` + `0` | Save current sample snapshot into slot 10 of the active preset |
| `1`–`9` | Recall slot 1–9; load sample, pitch, and offset from that slot |
| `0` | Recall slot 10 |

"Slot number" displayed on the button always matches the key pressed: key `1` = slot 1, key `0` = slot 10.

---

## Behavior — Saving a Slot (Shift + number)

1. Capture `state.currentSampleId` (or digest), `state.pitchSemitones`, `state.pitchCents`, `state.currentOffset`.
2. POST to the backend with the active preset ID and slot number.
3. If the active preset has no name yet (newly created), the backend assigns the current date-time as `YYYY-MM-DD HH:mm:ss.SSS` before storing.
4. The key button for that slot transitions to the **filled** visual state.
5. No playback change occurs.
6. Show a toast: `Slot X saved to preset Y` 
  - `X` = slot number (1–10, where key `0` = 10)
  - `Y` = active preset name

---

## Behavior — Clicking a Slot Button (mouse)

Slot buttons respond differently to a mouse click depending on their fill state.

### Clicking an empty slot
- No action. The empty-state toast is only shown on keyboard recall, not on mouse click, to avoid accidental noise when the user is browsing.

### Clicking a filled slot (delete)
- The slot is immediately deleted from the backend via `DELETE /api/quickpick/presets/<id>/slots/<slot>`.
- The button transitions back to the **empty** visual state.
- Show a toast: `Slot X deleted from quick pick preset Y`
  - `X` = slot number (1–10)
  - `Y` = active preset name

The hover cross must be shown **only** on filled slots; hovering an empty slot changes nothing visually.

---

## Behavior — Recalling a Slot (number key, no Shift)

### Slot is empty
- Show a toast: `Slot X is empty of quick pick preset Y`
  - `X` = slot number (1–10, where key `0` = 10)
  - `Y` = active preset name

### Slot is filled, Play Instantly **unchecked**
- Load the sample (same pipeline as loading by digest/index).
- Seek to the stored offset.
- Apply stored pitch.
- Respect current play/pause state: if paused, stay paused at the new position; if playing, resume from the new position.

### Slot is filled, Play Instantly **checked**
- Load the sample, seek to the stored offset, apply stored pitch.
- Always start playback, mirroring the `Shift`+`Space` behavior.
- If the sample recalled is **already loaded** and Play Instantly is on, restart from the stored offset (do not skip the load step; just seek and play).
- Pressing the same key again always restarts from the stored offset, making it suitable for live performance re-triggering.

---

## Behavior — Managing Presets

### Pressing a key for a slot when no preset is loaded
- Create a new preset record in the database with an auto-generated name (`YYYY-MM-DD HH:mm:ss.SSS`).
- Select it in the dropdown immediately.
- Fill the slot that the key corresponds to

### Adding a new preset (`fa-plus` button)
- Create a new preset record in the database with an auto-generated name (`YYYY-MM-DD HH:mm:ss.SSS`).
- Select it in the dropdown immediately.
- All 10 slot buttons become empty.
- The name field is focused so the user can type a meaningful name right away.

### Renaming a preset
- The dropdown is rendered as an editable text input (or the dropdown is accompanied by a text input showing the current preset name).
- Typing a new name and pressing `Enter` sends a PATCH to the backend to rename the preset.
- The dropdown updates to reflect the new name.

### Deleting a preset (`fa-trash-can` button)
- Deletes the active preset and all its slots from the database.
- The dropdown reverts to an undefined/placeholder state (e.g. `— select preset —`).
- All 10 slot buttons become empty and visually reset.
- No confirmation dialog needed (slots can be re-saved easily).

---

## Database Schema

### New table: `quickpick_presets`

```sql
CREATE TABLE IF NOT EXISTS quickpick_presets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    created_at REAL    NOT NULL
);
```

### New table: `quickpick_slots`

```sql
CREATE TABLE IF NOT EXISTS quickpick_slots (
    preset_id       INTEGER NOT NULL REFERENCES quickpick_presets(id) ON DELETE CASCADE,
    slot_number     INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
    digest          TEXT    NOT NULL,
    start_offset    INTEGER NOT NULL DEFAULT 0,
    pitch_semitones INTEGER NOT NULL DEFAULT 0,
    pitch_cents     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (preset_id, slot_number)
);
```

The `digest` column references the sample file. A foreign key with `ON DELETE CASCADE` from `samples` ensures that when a sample is removed from the library, all slots pointing to that digest are also removed automatically:

```sql
-- If samples table uses digest as PK or unique key:
FOREIGN KEY (digest) REFERENCES samples(digest) ON DELETE CASCADE
```

> **Note:** SQLite foreign key enforcement requires `PRAGMA foreign_keys = ON` at connection time. Verify this is already set in `db.get_db()`; add it if not.

---

## Migration Script

A new migration function should be added to `groove/db.py` and called from the startup migration runner:

```python
def migrate_quickpick(conn):
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
```

---

## API Endpoints

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/api/quickpick/presets` | — | List all presets (id, name) |
| `POST` | `/api/quickpick/presets` | `{ name? }` | Create preset; name defaults to timestamp |
| `PATCH` | `/api/quickpick/presets/<id>` | `{ name }` | Rename preset |
| `DELETE` | `/api/quickpick/presets/<id>` | — | Delete preset + all slots |
| `GET` | `/api/quickpick/presets/<id>/slots` | — | Get all 10 slots for a preset (empty slots omitted or returned as null) |
| `PUT` | `/api/quickpick/presets/<id>/slots/<slot>` | `{ digest, start_offset, pitch_semitones, pitch_cents }` | Save or overwrite a slot |
| `DELETE` | `/api/quickpick/presets/<id>/slots/<slot>` | — | Clear a single slot |

`GET /api/quickpick/presets/<id>/slots` response shape:

```json
{
  "slots": {
    "1": { "digest": "abc123", "start_offset": 4410, "pitch_semitones": 0, "pitch_cents": 0, "sample_name": "kick.wav" },
    "3": { "digest": "def456", "start_offset": 0,    "pitch_semitones": -2, "pitch_cents": 0, "sample_name": "snare.wav" }
  }
}
```

Slots not present in the map are empty.

---

## Frontend State

```js
quickpick: {
    presets: [],          // [{ id, name }, ...]
    activePresetId: null,
    slots: {},            // { "1": { digest, start_offset, ... }, ... }  — keyed by slot_number string
    playInstantly: false,
}
```

Loading a preset: fetch `/api/quickpick/presets/<id>/slots`, store in `quickpick.slots`, re-render the key buttons.

---

## Design Notes & Open Questions

1. **Preset dropdown vs. editable combobox** — A plain `<select>` is simplest. A rename field below or beside the dropdown avoids the complexity of a true combobox while still being clear. Alternatively, a small `fa-pen-to-square` icon next to the dropdown opens an inline rename input (similar to the label rename pattern already in the codebase).

2. **Key conflict with existing shortcuts** — Number keys 1–0 are not currently mapped. Verify there are no conflicts before implementation, and guard the handlers so they are ignored when focus is inside a text input.

3. **Slot 0 = slot 10 mapping** — Handle in a helper: `const slotNumber = (key === '0') ? 10 : parseInt(key)`.

4. **Sample removed mid-session** — If the database cascade deletes a slot's digest, the frontend slot state may be stale. A reload of slots on each preset switch is enough to keep it consistent.

5. **Bar placement** — The Quick Pick Bar sits in its own `<div id="quickpick-bar">` between `#waveform-container` and `#sample-info`. It should be hidden (or show a "no preset" placeholder) when no presets exist yet.

---

## Persistence — Active Preset

The active quick-pick preset must survive application restarts. It is stored in the existing `config` table under the key `quick-pick-preset` as the preset's integer ID.

### Write

Whenever the active preset changes (selection from dropdown, creation of a new preset, or deletion that clears the selection) the frontend PATCHes or POSTs to the config endpoint with `{ "key": "quick-pick-preset", "value": "<id>" }`. If the preset is cleared (no selection), the key is deleted or set to an empty string.

### Read on startup

During `init()`, after `loadConfig()` resolves, read the `quick-pick-preset` config value. If it contains a valid preset ID that still exists in the database, select that preset and load its slots. If the ID no longer exists (preset was deleted while the app was closed), fall back to no selection and clear the slot buttons.
