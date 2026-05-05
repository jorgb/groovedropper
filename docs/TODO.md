## DOING

Create a design document in @docs/UNTAGGED-DESIGN.md and summarize this 
behaviour and the changes needed to create it:
The application has a special label under the label-list-header that:
- Is outlined in the dimmed accent color but not filled like the other labels
- Has the text UNTAGGED in it in the same ACCENT color
- Has the count of samples on the side that have no associated tags
- When selected, it is highlighted like any other label, with accent color 
  transparency but black font (invert the font)
- When selected all other labels deselect
- When a label is selected or preset, it deselects again
- This is a toggle to randomize over all samples that do not belong to a label
- Once a sample is tagged to a label by the checkbox, the facet count of 
  this UNTAGGED label updates as well
- Pressing R will randomize over all samples that have no label associated 
  with it
- This label cannot be edited, as it acts like a toggle
- There should be a slight margin between this label and the others
- there should be no checkbox in front of it
- The label should only activate when it's used clicked and deactivated 
  again when it was activated
- The focus should be released (blur) upon clicking so keyboard shortcuts 
  will stay working

- feat: select "untagged" find all samples that are not tagged
  - Simple label that deselects all, but is different in color, find all untagged labels for quick classification
- feat: Make sample name searchable
  - Index tokenized names (lower case), table sample-to-token?
  - Make keyword box that chooses parts of the name
  - When randomizing, send along a query that checks if words are in name 
    (if not emppty), but AND it with the labels  
- feat: Input description box to add to sample name (or maybe to be changed 
  from keywords?)
- feat: Adjust sample random offset manually
  - Manual editing of offset box
  - Arrow up / down micro adjust sample offset, left / right macro adjust offset (200ms / 0.5s?)
  - playhead moves to offset, replays when playing, or moves when stopped

## LATER

- 1.0 release!
  - Publish on Reddit
- feat: draw sample start offset marker in waveform (upon click, or randomize Shift+R) to indicate where sthe slice save or restart is of the sampe
- feat: Slice mode in waveform editor
  - Shift+Click or C will set the END point and draw a small masked overlay
  - Shift+Space will play and loop only between the start and end (or end sample if no slice stop)
  - Shift+R will reset the end slice to none, or clicking anywhere in the sample
  - Saving the slice will save only selected part
  - Shift+S saves the whole sample (from location as-is without conversion)
  - Slice management + offset rework (do not use seconds to randomize but slice offset?)
  - Save slice time customizable, 5s by default? -- NEEDED?
- feat: label auto keyword addition
  - for a label, when created or edited, enter comma separated keywords that can be in a path to auto-match
  - what to do with re-scanning?
- Controls on UI next to key bindings
  - Back button that goes to previous sample, RANDOMIZE for the current
  - Input field for the exact sample offset so that I can trigger replays
  - Export length (in seconds)
- Not labeled filter option 
  - Randomize over all not labeled samples (for classification)
  - And: If labels are selected, randomize over all BUT the selected labels??
- fix: scan worker kan crashen, er moet een /stat endpoint komen dat de UI permanent een refresh application message kan sturen
- UI 
  - CRT bloom in de hacker theme
  - Tidy up UI and controls to be intuitive, clear and concise
  - Read and display thumbnail in current folder and display as logo
  - Favicon needs to be a record with a needle

## MAYBE

- feat: Save sample slots (inspired by tape stopping)
  - 1,2 to 0 are used for storing the randomized spots
  - green / red key squares indicate something is stored there
  - upon pressing a key, sample loads at stored offset
  - Shift+S saves all slots to a file as a zip?
  - future: save this set as a Vibe, reset vibe, reset set
- feat: Add a star to the sample before the labels row, and a star in the preset field, the star needs to filter only "starred" items 
- Download whole sample, as-is?
  - IF wanting to slice, or run remotely
  - slice sample metadata in WAV?
- Starred items, because some are just cool but not used right now
  - Add one to five stars or just one star for "favorite for later?"
- fix: Random seems to only pick from the beginning
- Mobile UI front-end and running on another URL but 127.0.0.1?
- Shift+Click mark end of slice, visualize and playback that part only save will save
	- Tag the part of the slice as a certain type (or the whole sample) 
	- Randomize in type, this requires a DB and sample references that do not break (the MD5?)
- description box per sample, to have keywords to search for and also maybe write down thoughts about what to do with the (starred) sample
- Lucky dice mode, a number of strikes before no random can be selected
  - 6 in total, tags can be selected
  - I'm feeling lucky function - Get 3 - 5 or 10 random slices which you need to use, as a ZIP file downloaded
  - Challenge mode, you only get 5 tries to find samples, after that randomize does not work anymore, only back
- Slice mark in current sample, persistent?
- Vibe list!
  - When a sample matches a vibe, add it to the current list with V, or make a new one if it does not exist 
  - It will display the clickable samples to the right in a vibe list with playhead preservation
  - If the current sample is in the list of vibes and the playhead randomizes in the sample or is clicked, update the vibe position as well
  - There should be a button next to the item that dismisses it from the current vibe
  - There should be a button under it exporting the chops from the vibe as a zip
  - There should be a button under it to export all samples from the vibe
  - Above the vibe list there should be an (editable) name, auto generated with a name (and randomize for the name) - wordlist?
  - There should be a button to save this vibe and a vibes dropdown with all previous vibes on the top next to the theme

- A recent marker list, that is clickable as session info, selects when playing, max 20?
- Click on a folder to pin that folder in the randomized selection, or maybe use a label functionality to decide what to pick from?
