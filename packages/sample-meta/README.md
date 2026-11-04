# @strudel/sample-meta

Beat and cue markers for samples. Sketches declare them as `[t, beat?, name?]` tuples:

```js
markers('voice:0', [[0.41, 0], [0.86, 1], [1.3, 2, 'accent']])
```

- `t` is seconds into the original file, `beat` is the marker's position on the beat grid (offbeats are `.5`), `name` makes the marker a cue.
- Two or more beat markers define the source tempo by least-squares fit.
- A warp plan stretches the audio between neighbouring beat markers so that every beat marker lands exactly on the target tempo's grid. Head and tail stretch like their neighbouring segment, so loops want markers at both ends.
- A grid is `{ t0, spb }`: time of beat 0 and seconds per beat.

The sample server renders warp plans with ffmpeg's `rubberband` filter (pitch-preserving) and serves them as `<file>?<warpQuery>`. The query carries the beat markers, so the server holds no marker state.
