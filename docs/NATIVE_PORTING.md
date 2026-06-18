# GrooveDropper — Native Port Design Document

> **Status:** Planning / Pre-implementation  
> **Scope:** Full rewrite from Python/Flask/WebView to a native compiled application  
> **Author:** Architecture review based on full codebase survey

---

## Table of Contents

1. [What We Are Porting](#1-what-we-are-porting)
2. [Why Rust](#2-why-rust)
3. [Recommendation: Rust](#3-recommendation-rust)
4. [UI Framework](#4-ui-framework)
5. [Audio Subsystem](#5-audio-subsystem)
6. [Build System & VSCode Setup](#6-build-system--vscode-setup)
7. [Architecture Overview](#7-architecture-overview)
8. [Subsystem-by-Subsystem Mapping](#8-subsystem-by-subsystem-mapping)
9. [Thread Safety Model](#9-thread-safety-model)
10. [Cross-Platform Considerations](#10-cross-platform-considerations)
11. [Waveform Rendering & Zoom](#11-waveform-rendering--zoom)
12. [Phased Migration Path](#12-phased-migration-path)
13. [Risk & Trade-off Summary](#13-risk--trade-off-summary)
14. [Hybrid Repository Approach](#14-hybrid-repository-approach)

---

## 1. What We Are Porting

GrooveDropper is a sample browser with the following active subsystems:

| Subsystem | Complexity | Notes |
|---|---|---|
| Sample library scanning | Medium | `os.walk`, mtime fast-path, MD5 digest |
| SQLite database (schema v4) | Low | 9 tables, FK cascades, digest-keyed labels |
| Waveform rendering | Medium | Server-rendered PNG (1024×204), stored as BLOB |
| Audio decode & playback | Medium | WAV via soundfile, MP3 via miniaudio; pitch via playbackRate |
| Transient detection | High | Librosa STFT → onset strength → peak pick → zero-cross snap |
| Job queue | Low | Single worker thread, in-memory results |
| Export (slice / ZIP / bulk) | Medium | WAV slice, multi-marker ZIP, raw copy |
| Tag / label / preset system | Low | Pure data, maps trivially |
| Quick Pick slots | Low | 10 bookmarks per preset with offset + pitch |
| UI (layout, waveform, markers) | High | Drag markers, seek, playhead, cut dialog |
| Config persistence | Low | Key-value in SQLite |

The most significant gains from a native port:
- **No HTTP overhead** — all data is a direct function call, not a round-trip
- **Real waveform zoom** — the current architecture cannot zoom; a native canvas redraws instantly
- **Native audio** — no Web Audio API quirks; proper multi-channel support in future
- **Single distributable binary** — no Python, no venv, no Flask dev server

---

## 2. Why Rust

**Strengths for this project:**
- Thread safety is enforced by the compiler — the job queue, scan worker, and audio callback cannot accidentally share state unsafely. This is not a style rule; it is a compile error.
- No garbage collector — zero GC pauses. Critical for the audio callback thread, which must never stall.
- `cargo` is the best build system of any systems language today. Dependency management, cross-compilation, and testing are first-class.
- The audio ecosystem has matured significantly: `cpal` (cross-platform I/O), `symphonia` (WAV + MP3 + FLAC decode, pure Rust), `rubato` (resampling), `realfft` (FFT for transient detection).
- GUI ecosystem is young but `egui` is production-quality and particularly well-suited to a custom-drawn waveform view.
- Binary size with `opt-level = "z"` and `lto = true` is typically 3–8 MB for a UI application.
- `rust-analyzer` in VSCode is best-in-class — better autocomplete and inline diagnostics than most C++ setups.

**Weaknesses:**
- Steeper initial learning curve than C++, primarily the borrow checker. Plan for 2–4 weeks of friction before it becomes intuitive.
- GUI ecosystem has fewer pre-built widgets than Qt. Custom look-and-feel is easier, but a standard "settings dialog" takes more code.
- Compile times are slower than Go (though `cargo check` is fast and `rust-analyzer` gives instant feedback).

---

## 3. Recommendation: Rust

**Use Rust.** The combination of enforced thread safety, zero-cost abstractions, a first-class build system, and a capable audio/GUI ecosystem makes it the best fit.

The learning investment pays off quickly for a project like this because the two hardest problems — audio thread safety and waveform rendering performance — are exactly where Rust's model provides the most value.

---

## 4. UI Framework

### 4.1 Primary Recommendation: `egui` via `eframe`

**Repository:** `github.com/emilk/egui`  
**License:** MIT / Apache 2.0  
**Backend:** `wgpu` (Vulkan/Metal/DX12/WebGPU) or `glow` (OpenGL 3.x)

`egui` is an immediate-mode GUI library. Every frame, you describe what the UI looks like right now — there is no retained widget tree, no invalidation, no diffing. This model is unusual but is a very natural fit for a waveform display:

```
// Pseudocode — every frame:
let rect = ui.allocate_rect(...);
let painter = ui.painter_at(rect);
for (x, (min, max)) in waveform_overview.iter().enumerate() {
    painter.line_segment([x, mid - max*h], [x, mid - min*h], stroke);
}
// Zoom: just change which slice of waveform_overview you iterate
```

**Customizing look and feel:**  
`egui` exposes the full style as a data structure (`egui::Style`, `egui::Visuals`). You set it once at startup:

```rust
ctx.set_style(egui::Style {
    visuals: egui::Visuals {
        panel_fill: Color32::from_hex("#1a1a1a").unwrap(),
        widgets: egui::style::Widgets {
            inactive: egui::style::WidgetVisuals {
                bg_fill: Color32::from_hex("#2a2a2a").unwrap(),
                fg_stroke: Stroke::new(1.0, Color32::from_hex("#e07d30").unwrap()),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    },
    ..Default::default()
});
```

The three existing themes (default dark-orange, hacker green, protracker blue) translate directly.

**Custom fonts:** Load any `.ttf` at startup via `egui::FontDefinitions`. The current monospace aesthetic is fully reproducible.

**What egui gives you for free:**
- Drag-and-drop (marker dragging)
- Keyboard input handling
- Scrollable panels
- Modal dialogs (via `egui::Window`)
- Text input, checkboxes, dropdowns, sliders — all customizable via the style

**What requires custom painting:**
- The waveform itself (min/max bar chart) — a few dozen lines
- The playhead line — one `painter.line_segment` call
- Marker pins (SVG-style pentagon) — a `painter.add(Shape::convex_polygon(...))` call

### 4.2 Alternative: `slint`

**Repository:** `github.com/slint-ui/slint`  
**License:** GPL 3.0 (free for open-source), commercial license available  
**Model:** Declarative `.slint` markup files, compiled to Rust

Slint uses a designer-friendly markup language (similar to QML) and generates Rust bindings. It has a VSCode extension with live preview. Styling is CSS-like within `.slint` files.

**When to choose Slint over egui:**
- If you want a visual UI designer workflow
- If the UI has many standard form-style panels and dialogs
- If you prefer keeping layout separate from logic

**Why egui is better for this project:**
- The waveform is the centrepiece. In egui it is just painting code; in Slint it requires a custom `RenderingHelper` or going through a native item, which is more friction.
- Slint's GPL licence may be a constraint depending on future distribution plans.

---

## 5. Audio Subsystem

### 5.1 Decode & Format Support

| Current | Native Rust replacement |
|---|---|
| `soundfile` (WAV) | `symphonia` — pure Rust, WAV/MP3/FLAC/OGG/AIFF/ALAC |
| `miniaudio` (MP3) | `symphonia` — same library handles both formats |
| `hound` (WAV write) | `hound` crate (simple, well-maintained) or `symphonia`'s encoder |

`symphonia` is the right single dependency for all decode. It is pure Rust (no C FFI), supports seeking, streaming block reads, and exposes sample rate, channel count, and duration — everything currently split across `soundfile` and `miniaudio`.

### 5.2 Playback

**Library:** `cpal`  
**Model:** Callback-based. You register a closure that fills an output buffer on demand. The closure runs on a dedicated OS audio thread.

```rust
// Sketch — the audio callback
stream = device.build_output_stream(
    &config,
    move |data: &mut [f32], _| {
        // Pull samples from a lock-free ring buffer
        // Never lock a mutex here
        ring_consumer.pop_slice(data);
    },
    |err| eprintln!("audio error: {err}"),
)?;
```

**Platforms:** Core Audio (macOS), WASAPI (Windows), ALSA/PipeWire (Linux). All handled transparently by `cpal`.

### 5.3 Pitch Shifting

Currently GrooveDropper shifts pitch entirely client-side via `audio.playbackRate` with `preservesPitch = false`. This is a time-scaling trick — it changes both speed and pitch together. Two native options:

**Option A — Rate-only (same as current behaviour):**  
Maintain a `playback_speed: f64` multiplier in the audio callback. Advance the read position by `playback_speed` samples per output sample (with linear interpolation). Simple, zero-latency, sounds identical to the current behaviour for small deviations.

**Option B — Quality pitch shifting (future upgrade):**  
Use `rubberband` (C library via FFI) for formant-preserving pitch shift, or the pure-Rust `pitch_shifting` crate for a rougher but dependency-free approach. This is the upgrade path for professional pitch-shifting in exports.

For the initial port, Option A is recommended — it is the exact current behaviour with no perceived quality change.

### 5.4 Resampling

**Library:** `rubato`  
Pure Rust, high-quality sinc resampling. Used when the source sample rate does not match the output device rate (e.g. a 48 kHz file played on a 44.1 kHz output). Rubato is real-time safe and lock-free.

### 5.5 Transient Detection

The current implementation in `groove/transient.py` is:
1. Block-stream the audio file (64-frame blocks at ~0.74 s each)
2. Skip silent blocks (max amplitude < 0.001)
3. For each block: compute STFT magnitude (`librosa.stft`)
4. Optional high-frequency cutoff at 8 kHz (for "big transients only" mode)
5. Compute onset strength via `librosa.onset.onset_strength`
6. Peak pick with `librosa.util.peak_pick` (pre/post window, delta threshold)
7. Snap detected frame to nearest zero crossing in the raw waveform

This algorithm is straightforward DSP that ports directly without any external library:

**Native implementation plan:**
- **FFT:** `realfft` crate — efficient real-valued FFT, no complex output for negative frequencies. Drop-in for `librosa.stft` magnitude.
- **Onset strength:** Manual implementation — compute spectral flux (sum of positive differences in log-magnitude spectrum between consecutive frames). This is what librosa does internally.
- **Peak pick:** Implement the standard sliding-window maximum suppression (pre_max, post_max, pre_avg, post_avg, delta, wait) — it is 30 lines of code.
- **Zero-cross snap:** Walk backwards from the detected frame offset until `sample[n] * sample[n-1] < 0`. Identical logic.

The full transient detector in native Rust should be approximately 150–200 lines, running faster than the current Python implementation (no numba JIT warmup required).

### 5.6 Waveform Overview Pre-computation

Currently stored as a 1024×204 PNG BLOB in SQLite. The native port should replace this with a compact binary format:

**Proposed format:** Store two `Vec<f32>` arrays — `min_peaks` and `max_peaks`, each with 1024 elements (one per horizontal pixel at default zoom). At zoom, sub-sample or recompute from the raw audio. Total size per sample: 1024 × 4 × 2 = 8 KB, compared to a PNG BLOB of ~15–40 KB. SQLite stores it as a BLOB of bytes.

The overview is computed once during scan and cached. Live zoom re-computes from the raw audio on demand (see [Section 11](#11-waveform-rendering--zoom)).

---

## 6. Build System & VSCode Setup

### 6.1 Cargo (Rust)

`cargo` is the Rust build system and is the only tool needed:

```
# Debug build (fast compile, slow runtime)
cargo build

# Release build (optimised binary)
cargo build --release

# Run
cargo run --release

# Run tests
cargo test
```

**Cross-compilation:**
```
# macOS → Linux x86_64
cargo install cross
cross build --release --target x86_64-unknown-linux-gnu

# macOS → Windows
cross build --release --target x86_64-pc-windows-gnu
```

**Binary size optimisation** (add to `Cargo.toml`):
```toml
[profile.release]
opt-level = "z"      # Optimise for size
lto = true           # Link-time optimisation
codegen-units = 1    # Single codegen unit (slower compile, smaller binary)
strip = true         # Strip debug symbols
panic = "abort"      # No unwinding runtime
```

Expected output size: 5–12 MB for the full application including egui and symphonia.

### 6.2 VSCode Extensions (Rust)

| Extension | Purpose |
|---|---|
| `rust-analyzer` | Full IDE: autocomplete, inline errors, go-to-definition, refactoring |
| `CodeLLDB` | Native debugger on all three platforms |
| `Even Better TOML` | `Cargo.toml` syntax, schema validation |
| `crates` | Shows latest crate versions inline in `Cargo.toml` |
| `Error Lens` | Inline error display (works great with rust-analyzer) |

**`.vscode/tasks.json`:**
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build (debug)",
      "type": "cargo",
      "command": "build",
      "problemMatcher": ["$rustc"],
      "group": "build"
    },
    {
      "label": "Build (release)",
      "type": "cargo",
      "command": "build",
      "args": ["--release"],
      "problemMatcher": ["$rustc"]
    },
    {
      "label": "Run",
      "type": "cargo",
      "command": "run",
      "args": ["--release"],
      "problemMatcher": ["$rustc"],
      "group": { "kind": "build", "isDefault": true }
    }
  ]
}
```

**`.vscode/launch.json`:**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug",
      "type": "lldb",
      "request": "launch",
      "program": "${workspaceFolder}/target/debug/groovedropper",
      "args": ["--db-file", "${userHome}/groovedropper.db"],
      "cwd": "${workspaceFolder}",
      "sourceLanguages": ["rust"]
    }
  ]
}
```

---

## 7. Architecture Overview

### Current Architecture

```
User browser / pywebview window
        │  HTTP (localhost)
        ▼
Flask dev server (app.py)
   ├── Route handlers (30+ endpoints)
   ├── scan_worker thread (os.walk + SQLite)
   ├── job_worker thread (single serialised queue)
   │       ├── jobs_saving.py     (WAV/ZIP export)
   │       ├── jobs_cutting.py    (split at markers)
   │       ├── jobs_merging.py    (concatenate regions)
   │       └── jobs_archiving.py  (rename to .bak)
   ├── SQLite (rusqlite)
   └── In-process audio modules
           ├── groove/audio_wav.py   (soundfile)
           ├── groove/audio_mp3.py   (miniaudio)
           ├── groove/audio_common.py (Pillow PNG render)
           └── groove/transient.py   (librosa STFT)
```

### Native Architecture

```
Main thread (egui event loop @ 60fps)
   ├── AppState: Arc<RwLock<AppState>>
   │       ├── current_sample: Option<SampleMeta>
   │       ├── waveform_overview: Vec<(f32, f32)>  (min/max pairs)
   │       ├── markers: Vec<u64>                   (frame offsets)
   │       ├── playhead_pos: Arc<AtomicU64>        (lock-free)
   │       ├── labels, presets, quickpick slots
   │       └── job_statuses: Vec<JobStatus>
   │
   ├── Audio thread (cpal callback — real-time, never locks)
   │       └── ring_consumer: ringbuf::Consumer<f32>
   │               (filled by decode thread)
   │
   ├── Decode thread (feeds the ring buffer)
   │       ├── symphonia decoder (WAV / MP3)
   │       ├── rubato resampler (if needed)
   │       └── rate multiplier (pitch via playback speed)
   │
   ├── Job worker thread  (mpsc channel)
   │       ├── Export (WAV / ZIP)
   │       ├── Cut (split at markers)
   │       ├── Merge (concatenate)
   │       └── Archive (rename to .bak)
   │
   ├── Scan worker thread  (mpsc channel)
   │       ├── os::walk (walkdir crate)
   │       ├── mtime fast-path
   │       ├── MD5 digest (md5 / blake3 crate)
   │       ├── symphonia audio info
   │       └── waveform overview pre-compute
   │
   └── SQLite  (rusqlite, per-thread connections)
```

The HTTP layer is completely eliminated. All communication between threads uses Rust channels (`std::sync::mpsc`) or `Arc<RwLock<>>` for shared state. The UI reads from `AppState` directly on every frame render.

---

## 8. Subsystem-by-Subsystem Mapping

### 8.1 Database

| Current | Native |
|---|---|
| `sqlite3` (stdlib) | `rusqlite` crate |
| Migration via `schema_version` table | Same migration table, same version numbers |
| Digest-keyed `sample_labels` | Preserved exactly |
| `config` key-value table | Preserved exactly |
| Long-lived scan connection | `rusqlite::Connection` per thread |

The entire schema migrates unchanged. The migration functions (v1→v4) port directly as Rust functions executing `conn.execute_batch(sql)`.

### 8.2 Sample Scanning

| Current | Native |
|---|---|
| `os.walk` | `walkdir` crate (cross-platform, respects symlinks) |
| `os.stat().st_mtime` | `std::fs::metadata().modified()` |
| MD5 digest | `blake3` crate (faster, same purpose) or `md5` for compatibility |
| `audio.generate_waveform` (Pillow PNG) | Pre-compute `Vec<(f32,f32)>` overview, store as raw bytes |
| Push to `ScanQueue._samples` | `mpsc::Sender<PathBuf>` to scan worker |

**Note on digest compatibility:** If you want existing user label assignments to survive the transition, keep MD5 (`md5` crate) for digest computation so digests match the existing database. If starting fresh, blake3 is faster and produces better hashes.

### 8.3 Job Queue

| Current | Native |
|---|---|
| `JobQueue` class with `threading.Condition` | `std::sync::mpsc::channel` |
| `_queue` list (index 0 = running) | `VecDeque<Job>` behind `Mutex` |
| `_completed` ring buffer (20 slots) | Fixed-size `VecDeque` with `pop_front` when full |
| `SampleBusyError` check | Same: check `locked_samples: HashSet<i64>` |
| In-memory result `bytes` | `Vec<u8>` held in the completed job |
| `GET /api/jobs/<id>/download` | Direct UI button triggers `std::fs::write` to user's download folder |

**Design improvement:** Instead of keeping results in memory and requiring a poll-then-download, write the export file directly to a user-configured output folder and show a system notification (via the `notify-rust` crate). No polling needed.

### 8.4 Export

| Current | Native |
|---|---|
| WAV slice via `sf.read + sf.write` | `symphonia` decode + `hound::WavWriter` |
| Multi-marker ZIP | `zip` crate (`ZipWriter`) |
| Raw file copy | `std::fs::copy` |
| Bulk export by tag (stub) | Implement properly: iterate DB results, ZIP all matching files |

### 8.5 Cut & Merge

| Current | Native |
|---|---|
| `sf.SoundFile` frame seek + block copy | `symphonia` packet seek + `hound::WavWriter` |
| Linear crossfade (disabled, code complete) | Port the crossfade ramp logic — it is pure arithmetic |
| Archive original (rename to .bak) | `std::fs::rename` |

### 8.6 Config

Stored in the `config` SQLite table. Identical in the native port. At startup, read all rows into a `HashMap<String, String>` and apply theme, loop state, etc. Persist on change with a single `INSERT OR REPLACE`.

### 8.7 Pitch Control

The semitone + cents inputs currently drive `audio.playbackRate`. In the native port:

- Maintain `pitch_semitones: i32` and `pitch_cents: i32` in `AppState`
- Compute `speed = 2.0_f64.powf((semitones as f64 * 100.0 + cents as f64) / 1200.0)`
- In the decode thread, advance the read position by `speed` samples per output sample with linear interpolation between adjacent samples
- This is exactly what the browser does — identical audible result

---

## 9. Thread Safety Model

Rust's ownership rules enforce the following at compile time:

### Audio Callback (highest priority — must never block)

```
cpal callback thread
    └── reads from: ringbuf::HeapConsumer<f32>   ← lock-free
    └── writes to:  AtomicU64 (playhead position) ← lock-free
```

The audio callback **must not** touch any `Mutex`. `ringbuf` provides a single-producer, single-consumer lock-free ring buffer. The decoder thread fills it; the callback drains it.

### Decode Thread (medium priority)

```
Decode thread
    └── reads:  AppState (sample path, start offset, speed) via Arc<RwLock> — read lock only
    └── writes: ringbuf::HeapProducer<f32>                  ← lock-free
    └── signals: AtomicBool (buffer_underrun flag)           ← lock-free
```

A `crossbeam::channel` or `std::sync::mpsc` carries `DecodeCommand` messages (Play, Seek, Stop, SetSpeed) from the UI thread to the decode thread.

### Job Worker Thread (low priority, not real-time)

```
Job thread
    └── receives: mpsc::Receiver<JobRequest>
    └── sends:    mpsc::Sender<JobResult>
    └── uses:     rusqlite::Connection (its own connection, not shared)
    └── writes:   std::fs (export files)
```

Jobs are serialised (one at a time) which matches the current behaviour. Future: use a thread pool (`rayon` crate) for parallel bulk exports.

### Scan Worker Thread (background, low priority)

```
Scan thread
    └── receives: mpsc::Receiver<ScanRequest> (folder paths)
    └── sends:    mpsc::Sender<ScanProgress>  (for status bar)
    └── uses:     rusqlite::Connection (its own long-lived connection)
```

### UI Thread (main thread)

```
UI thread (egui)
    └── reads:  AppState via Arc<RwLock>     (every frame)
    └── writes: AppState via Arc<RwLock>     (on user actions)
    └── sends:  mpsc::Sender<DecodeCommand>  (play/seek/stop)
    └── sends:  mpsc::Sender<JobRequest>     (export/cut/merge)
    └── reads:  mpsc::Receiver<JobResult>    (drain each frame)
    └── reads:  AtomicU64 (playhead)         (lock-free, every frame)
```

The UI never blocks. `RwLock` write locks are held for microseconds (update a value, release). The playhead is an `AtomicU64` (frame offset as fixed-point), readable without any lock.

---

## 10. Cross-Platform Considerations

### Build Matrix

| Platform | Rust toolchain | Audio backend | Notes |
|---|---|---|---|
| Windows 10/11 | `x86_64-pc-windows-msvc` | WASAPI (via cpal) | Requires Visual Studio Build Tools or `cargo-xwin` |
| macOS 12+ | `aarch64-apple-darwin` + `x86_64-apple-darwin` | Core Audio (via cpal) | Universal binary via `lipo` or `cargo-universal` |
| Linux (Ubuntu/Fedora) | `x86_64-unknown-linux-gnu` | ALSA or PipeWire (via cpal) | Link against system ALSA (`libasound2-dev`) |

### Packaging

| Platform | Tool | Output |
|---|---|---|
| Windows | `cargo-wix` | `.msi` installer |
| macOS | `cargo-bundle` | `.app` bundle |
| Linux | `cargo-deb` | `.deb` package |
| All | Manual | Single binary + README |

### File Paths

Use the `dirs` crate for platform-appropriate config and data directories:
- Database: `dirs::data_local_dir() / "GrooveDropper" / "groovedropper.db"`
- Exports: `dirs::download_dir()` (falls back to home)

### Audio Device Enumeration

`cpal` handles this transparently. Use `cpal::default_output_device()` for the initial port. Future: expose a device picker in settings.

---

## 11. Waveform Rendering & Zoom

This is the single largest UX improvement the native port enables. The current architecture cannot zoom — the waveform is always a 1024-pixel PNG of the entire file.

### Overview Pre-computation (scan time)

During scan, compute a multi-resolution overview:

```
Level 0:  1 value per 512 samples   →  fast overview for long files
Level 1:  1 value per 64 samples    →  medium zoom
Level 2:  1 value per 8 samples     →  fine zoom
Level 3:  raw samples               →  maximum zoom (loaded on demand)
```

Each level stores `(min: f32, max: f32)` pairs. Store levels 0–2 in SQLite as compact binary blobs (little-endian f32 pairs). Level 3 is read from the audio file on demand.

### Render Loop (every egui frame)

```
view_start: u64  (sample frame)
view_end:   u64  (sample frame)
view_width: usize  (pixels available)

samples_per_pixel = (view_end - view_start) / view_width

→ choose overview level where level_resolution ≤ samples_per_pixel
→ for each pixel x:
      idx = (view_start / level_resolution) + x * (samples_per_pixel / level_resolution)
      min = overview[idx].0
      max = overview[idx].1
      painter.line_segment(
          [x, centre - max * half_height],
          [x, centre - min * half_height],
          stroke
      )
```

### Zoom Controls

- **Mouse wheel** over the waveform → adjust `view_start`/`view_end`, centred on cursor position
- **Click-drag** on empty waveform area → pan `view_start`/`view_end`
- **Double-click** → zoom to fit entire file
- **Ctrl+scroll** → zoom in/out (same as mouse wheel, keyboard-driven)
- **Zoom level indicator** — text overlay showing the visible time range (e.g. "0:00.000 – 0:04.512")

This is approximately 80 lines of egui painting code and replaces the entire server-side PNG generation pipeline.

---

## 12. Phased Migration Path

Attempting a full rewrite in one pass is risky. A phased approach:

### Phase 1 — Data layer (2–3 weeks)
Port the SQLite schema and all queries to `rusqlite`. Port the scan worker. Verify that scan results, label assignments, and config survive the transition. Run this headlessly with `cargo test`.

### Phase 2 — Audio engine (2–3 weeks)
Port audio decode (symphonia), playback (cpal), resampling (rubato), and rate-based pitch. Wire up a minimal egui window with a Play/Stop button and a sample path input. No waveform yet.

### Phase 3 — Waveform display (1–2 weeks)
Implement the multi-resolution overview pre-computation. Implement the egui waveform painter. Add zoom and pan. Add the playhead `AtomicU64` and the rAF-equivalent egui repaint request.

### Phase 4 — Markers & job system (2–3 weeks)
Port marker add/delete/drag. Port the job queue. Port cut, merge, export (WAV + ZIP). Port the archive (rename to .bak) job.

### Phase 5 — Full UI (3–4 weeks)
Port the label/preset panel, quick pick system, folder management dialogs, config UI, theme switching. Match the existing keyboard shortcuts exactly.

### Phase 6 — Transient detection (1 week)
Port the STFT-based onset detector. Validate against the Python implementation on the same audio files.

### Phase 7 — Bulk export (1–2 weeks)
Implement the `export_bytag` job properly (it is a stub in the current Python code).

**Total estimate:** 14–20 weeks working part-time, or 6–10 weeks full-time.

---

## 13. Risk & Trade-off Summary

### Rust Risks

| Risk | Mitigation |
|---|---|
| Borrow checker learning curve | Plan 2–4 weeks. The hardest part is `Arc<Mutex<>>` patterns, which you will hit in Phase 1. After that, the compiler teaches you. |
| egui widget library has fewer pre-built widgets than mature toolkits | All missing widgets can be custom-painted. For this app's UI, the gap is small. |
| symphonia MP3 decoder quality | Symphonia's MP3 decoder is production quality and passes the same test vectors as FFmpeg. No concern. |
| Compile times | `cargo check` (used by rust-analyzer) is fast. Full `cargo build --release` takes 60–90 s on first build, then incremental. |

### What Not To Do

- **Do not use Tauri.** Tauri is a Rust shell around a WebView — it still renders HTML and keeps the JS/CSS stack. It does not give you a native waveform canvas or real-time audio. The goal is to eliminate the web layer entirely.
- **Do not port the HTTP API.** There is no need for a localhost server in a native app. Every route becomes a direct function call. Remove Flask entirely.

---

## 14. Hybrid Repository Approach

The Python app does not need to be abandoned on day one. A side-by-side monorepo lets
the existing application remain the production version while the Rust rewrite is built
incrementally in the same repository.

### Concept

Two apps, one repo, one shared database:

```
GrooveDropper/
├── Cargo.toml          ← Cargo workspace root (new)
├── native/             ← Rust rewrite (new, grows over time)
│   ├── Cargo.toml
│   └── src/main.rs
├── groove/             ← Python package (unchanged)
├── app.py              ← Flask entry point (unchanged)
├── app_gui.py          ← pywebview shell (unchanged)
└── requirements.txt    ← (unchanged)
```

The Python app has zero awareness of the Rust code. No build step changes, no new
Python dependencies. Developers who only run the Python app never need to install Rust.

### Shared SQLite database

Both apps point at the same `~/groovedropper.db` by default. The Rust app reads the
database the Python app wrote — labels, markers, presets, and scan results are all
immediately available. This means you can run both apps against your real library
simultaneously to compare behaviour during development.

Add `PRAGMA journal_mode=WAL;` to both apps' connection initialisation. WAL mode
allows concurrent reads from multiple processes without blocking, so both apps can
read at the same time safely.

### Two layers of hybrid (choose your pace)

**Layer 1 — Pure side-by-side (start here)**

The Rust app in `native/` is developed independently. No Python code is touched.
Each phase from [Section 12](#12-phased-migration-path) lands in `native/` while the
Python app ships normally. Switch to Rust as the primary app when it reaches feature
parity.

**Layer 2 — PyO3 acceleration (optional, later)**

Once a Rust module is proven correct — `groove/transient.py` is the most valuable
candidate, as it is the most CPU-intensive module and depends on librosa/numba — it
can be compiled as a Python extension module (`.pyd` on Windows, `.so` on Linux/macOS)
and imported transparently by the existing Flask app. The call signature stays
identical; Python does not know it is calling Rust.

This requires adding `pyo3` as a crate dependency and `maturin` as a Python build
tool. It is entirely optional and additive — the Python app functions correctly without
it.

### `.gitignore` additions needed

```
target/     # Cargo build output
*.pyd       # Windows PyO3 extension DLLs (Layer 2 only)
```

Cargo places its `target/` directory at the workspace root (next to the root
`Cargo.toml`). Without this entry it will show up in `git status` immediately.

### CI strategy

Keep the existing Python CI job untouched. Add a lightweight `rust-check` job
alongside it that runs `cargo check` (not a full release build — it is fast and
catches compile errors without the wait):

```yaml
rust-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - run: cargo check
```

Promote this to `cargo build --release` and add artifact upload once the native app
reaches a state worth distributing.

### Cross-compiling for Linux from Windows

During hybrid development on Windows, build the Linux binary using `cross`
(Docker-based, requires Docker Desktop) or by building natively inside WSL2.
See [Section 10](#10-cross-platform-considerations) for the full matrix.
