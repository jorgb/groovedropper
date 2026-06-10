## Testdata

t3-slices.json is taken from the WAV metadata block, it seems the default sample is where trimming is also stored.

Also the "slic" section seems to contain slice offset.

The chop points are located **IN** the wav files. The first section in the sample metadata contains the slice points as JSON. The XPJ's are minimally changed and very static.

Therefor the WAV file export itself, if exported to XPJ needs to contain the pinned markers as slice points, and / or when quick picks are used, the start offset of the sample.

TODO: How are begin / end stored for a sample? I assume this is per pad, as every pad can have a trimmed part of the original or will it always store the whole wav as a new one?

t0 - One chop points placed (2 pads)
t1 - Two chop points placed (3 pads)
t2 - Three chop points placed (4 pads)

The rest of the projects are unchanged

