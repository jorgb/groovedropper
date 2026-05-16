## DOING

- refactor: MP3 playback 20260511-mp3-support
- 0.9.2-beta release
  - Explain in README how to extract to run (online)
  - Test out of box experience (manual link in HTML needs fixing!)
  - Test linux run.sh
  - Can the readme.html BG be patched to dark? 
  - Ask community to test
  - Publish on Reddit
- test: Linux build with new UI

## LATER

- CUT MODE (C)
  - When C is pressed, a dialog appears with:
    - The waveform displayed, marker where the cut is made
    - User can select keep left / right (default), discard both sides, 
      delete all (trash?)
    - Inform that original sample is backed up (renamed to *.bak), inform 
      mutability!
    - One or two samples are created, original sample renamed
    - HTTP post that does this synchronously (wait dialog), rename at end!
    - When sample is selected, a new one is randomized
    - Indexing is restarted to pick up the mutation
    - Slice write name is "original-name-{begin-offset}-{end-offset}.wav"
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
- VIBE EXPORT
  - Export icon for all slots to a ZIP file
  - (Shift-V saves all slots to a file as a zip?)
  - future: save this set as a Vibe, reset vibe, reset set
- TRANSIENT SKIP (forward)
  - Let Claude design the transient detection algorithm, with zero crossing 
    (if possible) 
  - Press fa-wave-square icon and the back-end will find the next transient
  - The offset it sent back to the UI plus information that transient is 
    detected on that offset
  - The button should be below the waveform editor
  - The playhead is updated
  - Pressing the button again will forward to the next transient
  - When playing, the sample should continue to play 
- UNIFORM KEYBOARD CONTROLS
  - Controls on UI next to key bindings
    - Back button that goes to previous sample, RANDOMIZE for the current
    - Input field for the exact sample offset so that I can trigger replays
    - Export length (in seconds)
  - Keys for unused buttons?
  - feat: "U" key to toggle untagged labels only
- SLICING AND CHOPPING
  - feat: Slice mode in waveform editor
    - Shift+Click or ?? will set the END point and draw a small masked overlay
    - HARD??? Shift+Space will play and loop only between the start and end (or 
      end sample if no slice stop)
    - Shift+R will reset the end slice to none, or clicking anywhere in the sample
    - Saving the slice will save only selected part
    - Shift+S saves the whole sample (from location as-is without conversion)
    - Slice management + offset rework (do not use seconds to randomize but slice offset?)
    - Save slice time customizable, 5s by default? -- NEEDED?
  - Look into splitting samples left / right, maybe "removing" the source by renaming it?
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
- Download whole sample, as-is?
  - Shift+S Saves whole sample?
  - IF wanting to slice, or run remotely
  - slice sample metadata in WAV?
- Shift+Click mark end of slice, visualize and playback that part only save will save
	- Tag the part of the slice as a certain type (or the whole sample) 
	- Randomize in type, this requires a DB and sample references that do not break (the MD5?)
- Lucky dice mode, a number of strikes before no random can be selected
  - 6 in total, tags can be selected
  - I'm feeling lucky function - Get 3 - 5 or 10 random slices which you need to use, as a ZIP file downloaded
  - Challenge mode, you only get 5 tries to find samples, after that randomize does not work anymore, only back
- Slice mark in current sample, persistent?
