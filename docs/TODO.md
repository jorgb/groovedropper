## DOING

- fix: save overhaul
  - Truncate the file name in the same way as archiving does!
    - Sample-0000000-48567845.wav slice 00022222 becomes 
      Sample-48567845-0002222-00438463.wav
  - Reflect in keyboard controls 

Export will eventually allow for more options

- fix: checkboxes for label slightly larger

- Export dialog
  - export quickpick set
  - export XPJ
  - export SP404
  - export ZIP
  - export all

History box (Two tabs)
- fix: GroovedDropper bar needs to stay in column detail-play
- Below the controls and waveform
  - All samples that are randomly picked in the history list
    - Remove samples from history that are archived!
  - All samples that are newly found
  - Paging?
  - Clean history button

Reverse MPC sample:
- Make XPJ with no chop points
- Make XPJ with one chop point
- Make XPJ with four chop points

- Manual needs updating!

- Test 
  - Sample needs to be able to be relocatable


- fine grained marker control (shift drag or mouse drag on edit box?)
  - drag, rough movements, marker does not get updated in DB until release
  - shift+drag fine control
  - When playing, the playhead will restart
  - When active marker, the marker will be reese

History table
- Store all randomly selected ramples (FK relation)
- Recall by "H" with a scrollable dialog to pick one 
- Will be placed on top
- Sort key is updated time
- When digest is already in history table, put to front
- Max 128 entries?
- P always get the entry from the DB (propagate to newest?)

THINK ABOUT

- !! refactor the sample table to only have path column (derive name from path!)
- Group mutability controls in controls overview with extra divider
- Consider C change into X (without shift)
- Shift+S saves whole sample

- check how to download with standalone pywebview, is it possible?

- 0.9.3-beta release
  - Test out of box experience (manual link in HTML needs fixing!)
  - Test linux run.sh
  - Can the readme.html BG be patched to dark? 
  - Ask community to test
  - Publish on Reddit
- test: Linux build with new UI

- Saving dialog:
  - Future proof to also include XPJ / PROJ / ZIP
  - same as cut, allow selecting parts    
  - Save all markers to new samples
  - Save current marker
  - S should save from selected marker to next
  - VIBE EXPORT
    - Export icon for all slots to a ZIP file
    - (Shift-V saves all slots to a file as a zip?)
    - future: save this set as a Vibe, reset vibe, reset set

- normalize job with librosa
  - calculation job should work like archiving (old sample = gone), but 
    metadata and link(s) to tags should remain, sample should reload?
  - Librosa can handle this without an extra package.
    librosa.util.normalize normalizes to peak 1.0 (0 dBFS), but you can
    scale the result afterward with a simple multiplier:

    import librosa
    import numpy as np

    normalized = librosa.util.normalize(audio)  # peaks at 0 dBFS
    target_db = -1.0
    scaled = normalized * (10 ** (target_db / 20))  # now peaks at -1 dBFS

    So librosa gives you the normalized signal, and 10^(dB/20) converts
    your target dB to a linear gain factor. At -1 dB that's ~0.891, at -2
    dB it's ~0.794.


## LATER

- Check for new version button
- bufmeacoffee link
- LINUX
  - fix: AppImage installer on linux does not work?
  - skip all together or use a different packager?
- DRAG AND DROP (HTML5 Drag and Drop API)
  - Drag a target to an app (like SP404 app) and the sample is transferred
  - All of the sample, or the slice
- KEY DETECTION
  - investigate: Key detection algorithm on current offset?
  - Investigate key at offset, draw key in text box on export, add the key 
  if set?
- Manual offset, button next to the offset box (find next transient)
- RANDOM NAMER
  - https://github.com/taikuukaits/SimpleWordlists (suggestion: curate the 
    words)
  - Under vibe picks a name generator section 
  - feat: Random vibe generator - random name generator
  - Later? A button next to the vibe edit, that randomizes the name from a 
    long list (like polyend tracker, digitakt 2)
  - Later? Song name randomizer (same code, back end) for inspiration
 UNIFORM KEYBOARD CONTROLS
  - Controls on UI next to key bindings
    - Back button that goes to previous sample, RANDOMIZE for the current
    - Input field for the exact sample offset so that I can trigger replays
    - Export length (in seconds)
  - Keys for unused buttons?
  - feat: "U" key to toggle untagged labels only
  - feat: press arrow keys left and right, one second? SHIFT+ left, right 200ms?
  - feat: press arrow up and down should halve the time in the offset
    - e.g. HOME, arrow up will position the play head in the middle
    - arrow up will place it at 3/4th, etc
    - arrow down will place it at 1/4th, 1/8th etc
- SLICE EXPORT (X)
  - Same as C but with a region
- CHANGE DURATION / SAMPLE TIME
  - Play time == slice export, for short notes to author or little stabs to 
    try, it might be nice to just play 200ms or 500ms of a note, so entering 
    10 will be 10 seconds, 0.2 is 200ms, etc also for the slice time? 
    - The playback should stop after the period exceeded
    - Maybe a checkbox where "disabled" means no end time
    - When drawing a marker, slice window this should also update.
- AD atack, decay
  - For authoring notes, upon the time to release or the playtime, set in the 
    decay, this requires backend logic as the decay needs to set in after 
    the playtime has exceeded 
- feat: draw sample start offset marker in waveform (upon click, or randomize Shift+R) to indicate where sthe slice save or restart is of the sampe
- NOT FILTERING ON LABELS
  - Press shift (or ctrl)+click on label will 'NOT' it
  - This means (Vinyl) AND NOT (Guitar OR Piano) means Vinyl is regular 
    label and Guitar OR Piano are NOT filters so all vinyl is randomized 
    when it is not labeled Guitar or piano.  
  - An icon (and color?) will indicate the not
  - Clicking it again in the NOT state will disable the NOT, same as regular 
    label
- MIDI
  - Enable midi receiving in browser through Web MIDI API
- UI 
  - CRT bloom in de hacker theme
  - Tidy up UI and controls to be intuitive, clear and concise
  - Read and display thumbnail in current folder and display as logo
  - Favicon needs to be a record with a needle
- feat: Adjust sample random offset manually
  - DONE: Manual editing of offset box
  - Arrow up / down micro adjust sample offset, left / right macro adjust offset (200ms / 0.5s?)
  - playhead moves to offset, replays when playing, or moves when stopped
- SEARCHABILITY / INDEXING
  - feat: Make sample name searchable
    - Index tokenized names (lower case), table sample-to-token?
    - Make keyword box that chooses parts of the name
    - When randomizing, send along a query that checks if words are in name 
      (if not emppty), but AND it with the labels  
  - feat: label auto keyword addition
    - for a label, when created or edited, enter comma separated keywords that can be in a path to auto-match
    - what to do with re-scanning?
  - feat: Input description box to add to sample name (or maybe to be changed 
    from keywords?) to have keywords to search for and also maybe write down 
    thoughts about what to do with the (starred) sample
  - Click on a folder to pin that folder in the randomized selection, or maybe use a label functionality to decide what to pick from?
- Nest labels, when I create a label Melodics/Piano the UI can seperate 
  these two into Melodics and child of Piano. And when piano is selected it 
  actually selects Melodics/Piano, when Melodics is selected it should 
  select all child labels (back-end thing)
- MOBILE FRIENDLY
  - Play start / stop button, randomize button (in index banner?), bigger 
    buttons, previous button, randomize in song
  - Double tap anywhere on empty space to randomize the next song?
  - rethink quick pick buttons, maybe click to play, shift-click to erase? 
    (mobile friendly)
- Tap BPM?
  - A BPM tap button that when focussed or mouse press in UI, will determine 
    BPM (stored in DB metadata, in proper pitch, will transpose!)
- Shift+Click mark end of slice, visualize and playback that part only save will save
	- Tag the part of the slice as a certain type (or the whole sample) 
	- Randomize in type, this requires a DB and sample references that do not break (the MD5?)
- Lucky dice mode, a number of strikes before no random can be selected
  - 6 in total, tags can be selected
  - I'm feeling lucky function - Get 3 - 5 or 10 random slices which you need to use, as a ZIP file downloaded
  - Challenge mode, you only get 5 tries to find samples, after that randomize does not work anymore, only back
