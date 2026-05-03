# User Manual

GrooveDropper is **100% local**. It runs entirely on your machine. No 
accounts, no cloud, no subscriptions, no phone-home. 
Your sample library is never modified: the app only reads your files to build
a searchable index and stream audio for playback.

## Contents

1. [Getting Started](#getting-started)
2. [Keyboard Shortcuts](#keyboard-shortcuts)
3. [Digging for Samples](#digging-for-samples)
4. [Sharing & Saving](#sharing--saving)
5. [Pitch Control](#pitch-control)
6. [Labels & Presets](#labels--presets)
7. [Themes](#themes)
8. [Database Migration Policy](#database-migration-policy)
9. [Troubleshooting](#troubleshooting)

---

## Getting Started

When you launch GrooveDropper for the first time the library database is empty. 
The first step is to point it at a folder of WAV files.  

Click the **folder `+` button** in the top-right of the waveform area to 
open the *Add Scan Folder* dialog. Enter the path to your samples folder, 
and click on an optional label (e.g. "Breaks", "Melodics", "Chops"), and click 
**Scan**. GrooveDropper walks the folder recursively, indexes every `.wav` 
file it finds, and generates waveform thumbnails in the background.

⚠️ You can only select folders to be scanned this way as dragging and 
dropping a folder does not work in a web browser. If you want to have other 
labels to classify, please create them first before adding a folder.

![Add folder dialog](images/add-scan-folder.png)

You can add as many folders as you like. Each folder can carry its own 
auto-label so every file from that folder is tagged automatically, which is A 
quick way to categorize a whole collection in one go. Once the scan 
finishes the waveform will be available upon the next randomization.

### Notes on scanning

- When you quit the application when scanning, it will pick up where it left.
- When you move samples around, they will retain their tag information as 
  long as the sample data is unaltered 
- When new samples are added to a monitored folder, they will be added upon 
  restart

---

## Keyboard Shortcuts

| Key | Action                                                                                                   |
|-----|----------------------------------------------------------------------------------------------------------|
| `Space` | Play / Pause — see [Play and Pause](#play-and-pause)                                                      |
| `Shift + Space` | Reset playhead to the original randomized position                                                       |
| `Ctrl + Space` | Copy a direct URL for the current sample and offset — see [Sharing & Saving](#3-sharing-saving)          |
| `R` | Pick a new random sample and play immediately — see [Digging for Samples](#2-digging-for-samples)        |
| `Shift + R` | Randomize the playhead offset within the current sample                                                  |
| `P` | Go back in history                                                                                       |
| `Click` waveform | Scrub to clicked position                                                                                |
| `S` | Save a 10-second slice from the current playhead position                                                |
| `,` / `.` | Pitch down / up 1 semitone (hold `Shift` for 10-cent fine steps) — see [Pitch Control](#4-pitch-control) |
| `L` | Reset pitch to zero                                                                                      |

---

## Digging for Samples

This is the main interface window. The playhead will show an approximation 
of where the sample is playing from, but since it is a small image, there it 
is imprecise for large samples.

![Main interface](images/groovedropper-main-default.png)

### Picking a random sample

Press **`R`** to have GrooveDropper pick a random file from your library 
and drop the needle at a random offset. It plays immediately, no clicking 
required.

### Randomize within the sample

If you are digging the sample but you want to explore more part of it, press 
**`Shift + R`** to stay on the same file but jump to a different random 
positions. This is useful when a sample sounds promising but the current 
chop is not what you want.

It is also nice to use this method to record the glitchiness directly into a 
sampler for unpredictable results. 

### Play and pause

**`Space`** toggles playback. After scrubbing around, press **`Shift + Space`** 
to snap the playhead back to the position where the needle originally landed, 
and resume from there.

The sample can be started and stopped, but it will always remember the 
picked (or clicked) offset, you can reset it to this offet even when it is 
stopped with 
**`Shift + Space`**

### Scrub with the mouse

Click anywhere on the waveform to jump to that position, in playback mode 
this will immediately let you listen what is there, clicking in the 
waveform also counts as a new offset. And **`Shift + Space`** will reset to 
that location.

### Navigate history

GrooveDropper remembers everything you've heard in the session.
Press **`P`** to step back through history.

⚠️ Pressing **`R`** will void all history that comes after the last selected 
sample.

---

## Sharing & Saving

### Sharing a link

Press **`Ctrl + Space`** to copy a direct URL to your clipboard. The link 
encodes MD5 digest of the file and the play offset position, so you can:

- Paste it into a note-taking tool (Notion, Obsidian, Bear, …) to build a 
  running list of samples that inspires you for a song and recall them by 
  clicking on the link when GrooveDropper runs
- Send it to a friend. If they have the same sample library indexed locally, 
  the link opens at the exact same spot.

Because of the MD5 digest, it does not matter how often you reindex your 
database, or where the sample ends up, as long as the data of the sample is 
unaltered, it will always be found. 

The link will look like: `http://127.0.0.1:5000/?sample=801730016a4a44d2f18c8538daad086e&start=4216491`

### Saving a slice

Press **`S`** to export a 10-second WAV clip starting from the randomized 
start offset (this is not the current offset where the playhead stopped). The 
file downloads straight to your browser's download folder, ready to drag 
into your sample or a DAW.

---

## Pitch Control

Use the pitch controls to transpose on the fly and audition a sample  
against the key you're working in, without leaving the app.

| Key       | Action                                                          |
|-----------|-----------------------------------------------------------------|
| `,` / `.` | Pitch down / up 1 semitone; hold `Shift` for 10-cent fine steps |
| `L`       | Reset pitch to zero                                             |

Use your mouse to drag over the semitones or cents to control the pitch by 
mouse.

**Important:** pitch adjustment is handled by the browser's audio engine 
and is not baked into the [exported slice](#saving-a-slice). Exporting at a 
shifted pitch would involve resampling that introduces audible or 
different artifacts, so GrooveDropper intentionally saves the clip at its 
original pitch. Transpose it in your DAW after importing.

---

## Labels & Presets

![Labels and Presets](images/labels-and-presets.png)

- The checkbox in front of the label will add the label to the current 
  sample, and it will be displayed under the waveform as well.
- Clicking the label will highlight it, and the next randomized sample will 
  be picked from the categories that are highlighted (the count behind the 
  label will show how many samples are in this category)
- The ALL preset will reset all labels to dimmed so that all samples match
- If you added a preset by hand, clicking that preset will highlight the 
  labels in that preset

### Labelling samples

Click the `+` button in the **Labels** panel to create a label. Toggle a 
label on or off for the currently loaded sample by clicking it. Labels are 
stored by MD5 digest, if you move a file to a different folder and rescan, 
all its labels are automatically restored (unless you explicitly delete it).

### Filtering with labels

When one or more labels are active, random picks are restricted to files 
that carry **at least one** of those labels (OR logic). Select "Soul" and
"Funk" and you'll get files tagged with either. In the future maybe and 
logic might be added but for now just include what you need is best.


### Presets

A preset is a saved snapshot of a label selection. Type a name into the 
preset field and click `+` to save the current active labels as a preset. 
Clicking a preset later restores that exact label combination in one shot which 
is handy for quickly switching between "Drums only", "Keys only", or any other 
mood that you feel at the moment.

---

## Themes

GrooveDropper ships with a default theme and a dark **hacker** theme, 
and a **soundtracker** theme.

![Hacker theme](images/groovedropper-main-hacker.png)

Switch themes using the theme toggle in the interface.

---

## Database Migration Policy

The application has a migration policy with a crude versioning system which 
means after a new release, the application will migrate the database for you.
However it is always a good idea if you have manually tagged a lot of WAV 
files or have other information you do not want to lose, to make a backup of 
your database before running a new version.

This application comes with a MIT License, which means the software can be 
used "AS-IS" and without any warranty. I am not liable for your lost time, 
but I will try my best to not mess with your data 🙂 

---

## Troubleshooting

**The scan finishes but no samples appear.**
Check that the folder contains `.wav` files — GrooveDropper only indexes WAV format.

**A file I moved is showing as missing.**
Re-add the folder at its new location and trigger a refresh. Because labels
are stored by an MD5 file hash, any tags you applied will be picked up 
automatically once the file is reindexed.

**Playback cuts out or sounds glitchy.**
This is usually a browser audio issue. Reload the page; if the problem persists try a different browser.
