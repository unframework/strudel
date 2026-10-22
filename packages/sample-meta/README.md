# @strudel/sample-meta

Annotation sidecars for samples. `voice.wav` is described by `voice.wav.json`:

```json
{ "version": 1, "markers": [{ "t": 0.41, "beat": 0 }, { "t": 1.3, "beat": 2, "name": "accent" }], "bpm": 132 }
```

- `t` is seconds into the original file, `beat` is the marker's position on the beat grid (offbeats are `.5`), `name` makes the marker a cue.
- Two or more beat markers define the source tempo by least-squares fit; `bpm` is only used when they don't.
- A warp plan stretches the audio between neighbouring beat markers so that every beat marker lands exactly on the target tempo's grid. Head and tail stretch like their neighbouring segment.
- A grid is `{ t0, spb }`: time of beat 0 and seconds per beat.

The sample server renders warp plans with ffmpeg's `rubberband` filter (pitch-preserving) and serves them as `<file>?bpm=<target>`.
