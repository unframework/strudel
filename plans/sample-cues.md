# Sample cues, tempo fit and beat warping

Branch: `nm/sample-cues`

## Intent

Strudel's sampler only knows sample URLs. For voice and recorded-drum material that is the main friction: you can't say where the accent of a phrase is, you can't line that accent up with a downbeat, you don't know the sample's tempo, and you can't nudge loose speech timing onto a beat grid.

The workflow this targets:

1. Clean the raw recording in Audacity (trim, denoise, normalise). This feature deliberately does no destructive editing.
2. As a final annotation step, mark beats and named cues on the clean sample with the waveform editor inside the sketch.
3. Use the annotations from patterns: start samples early so a cue lands on the beat, and play time-stretched versions that sit on the current tempo's grid.

Annotations are part of the sketch, like `slider()` values: the code is the source of truth, share links carry them, and editor undo covers them. The sample server only serves audio and renders warps on request, so it holds no marker state.

## Design

### Markers in code

```js
samples('local:')
markers('voice:0', [[0.41, 0], [0.86, 1], [1.3, 2, 'accent']])
$: s("voice").beatsync().cue("accent")
```

- Each marker is a `[t, beat?, name?]` tuple. `t` is seconds into the original file. `beat` places a marker on the beat grid (offbeats are `.5`). `name` makes it a cue that patterns can refer to.
- The sample is named like in `s()`, with an optional index. Evaluating registers the markers for that sample's URL, which is where `cue`, `beatwarp` and `fitbpm` look them up.
- The transpiler rewrites the call to `markersWithID(id, sound, tuples)`. The widget id comes from the sound, so it stays stable while the array changes length.

### Tempo from markers

- Two or more beat markers define the source tempo with a least-squares fit of `t = t0 + beat · secondsPerBeat`.
- What's left over at each marker is its nudge: how far the performance drifts from a steady grid. The editor shows the worst nudge in ms and draws each one as a tick.
- "Auto-number beats" numbers markers by the median spacing, for when markers were tapped without beat numbers.

### Warping

- A warp plan stretches each stretch of audio between neighbouring beat markers so that every beat marker lands exactly on the target tempo's grid. The audio before the first marker and after the last one stretch at the same rate as the section next to them, so loops want a marker at each end (e.g. beat 8 at the end of a 2-bar loop) to keep their length exact.
- Pitch is preserved, and rendering happens offline on the server rather than in real time: ffmpeg's `rubberband` filter stretches each section, then the sections are joined.
- `GET /file.wav?bpm=X&beats=t:beat,…` renders on demand and caches in `.warp-cache/`, keyed by the audio content hash, the beat markers and the BPM (rounded to 0.01). Cue names aren't in the query, so renaming a cue doesn't re-render.
- The shared logic lives in `packages/sample-meta`, used by the server, superdough and the UI: the marker format, tempo fit, warp plan, warp query, time mapping and cue lookup.

### Patterns

- `beatwarp(bpm)` plays the render for a given tempo, and `beatsync()` uses the current REPL tempo (4 beats per cycle). It's not called `warp` because that name is already the wavetable warp control.
- While a render loads, the first hits play the original file resampled to the target tempo, so they aren't silent.
- `cue(name)` moves each event's onset earlier by the cue's position in the file (or in the warped render), taking `speed` into account. The sample still starts at its beginning, so the audio before the cue sounds before the beat. This shift happens in the pattern because the scheduler can only start a sound about 0.1 s early. As a result it works for any output, including OSC. The maximum pre-roll is 1 cycle.
- `fitbpm()` matches tempo by plain resampling, so pitch changes along with speed.

### Inline editor

- A summary line under the `markers()` call (marker count, fitted tempo, cue names) expands into a waveform editor. The waveform is decoded and drawn in the browser.
- Waveform with marker flags (amber, pink for cues), the fitted beat grid and the nudge ticks.
- Editing: double-click adds a marker, drag moves it (committed on release), and the fields below edit its time, beat and cue name or delete it.
- Every edit updates patterns right away and rewrites the array literal in the editor, found through the syntax tree from the widget's position.
- Preview checkboxes that combine freely:
  - **marker blips:** a short beep at each marker.
  - **grid click:** a metronome on the grid, accented on the downbeat.
  - **warped:** plays the server render of the current markers and redraws them on the grid.
  - **custom bpm:** the warp target. Unticked, it uses the REPL tempo.

## Known limitations

- Renders lag by about 5 ms (stretcher latency). Spacing between markers is exact.
- Sections are stretched separately and then joined, so seams may be audible at markers. If so, switch to `rubberband-cli --timemap` for a single continuous pass.
- `cue` can't be combined with `begin`, and it must come after `beatwarp`, `beatsync` and `speed` in the chain.
- The waveform has no zoom, and there's no tap-along marking yet.
- Undo changes the code, but the widget only catches up on the next evaluation.
- Deleting a `markers()` call leaves its markers registered until reload. Two calls for the same sample share one widget.
- The array literal makes a long line. It could be folded behind the summary.
- The sample index in `voice:0` points at a different file when files are added to the folder.
- The `bpm` fallback for samples with fewer than two beat markers has no way to be set from code.
- `@strudel/sampler` now depends on the private `@strudel/sample-meta` package, so it can't be published to npm as is.
- Out of scope for now: SuperCollider loading warped buffers. Pattern-level `cue` already reaches SuperDirt over OSC.

## Acceptance testing

Setup: put some samples in a folder, e.g. `~/samples/voice/hey.wav` and a drum loop. Then:

- Run `node packages/sampler/sample-server.mjs --dir ~/samples`.
- Run `pnpm dev` and evaluate `samples('local:')`.

Sample server:

- [ ] `curl localhost:5432/` lists banks.
- [ ] A malformed warp query is refused with 400.
- [ ] `..` paths are refused with 403 (`curl --path-as-is 'localhost:5432/..%2f..%2fetc%2fpasswd'`).
- [ ] `?bpm=120&beats=…` renders once; asking again is instant, and a new file appears in `.warp-cache/`.

Inline editor:

- [ ] Evaluating `markers('voice:0', [])` shows the summary line, and expanding it shows the waveform.
- [ ] The waveform matches what Audacity shows, and the playhead follows playback.
- [ ] Double-click adds a marker, drag moves it, and delete removes it. Each edit rewrites the array in the code, and times are rounded to 0.1 ms.
- [ ] With three or more beat markers, the fitted BPM is plausible and the nudge ticks shrink as you correct markers.
- [ ] Marker blips land on the transients you marked.
- [ ] Grid click stays on time with the speech once the fit is good.
- [ ] Warped: the render of the current markers plays, markers sit on grid lines, and blips match the click. You can hear whether there are seams at markers.
- [ ] Custom BPM: a new tempo triggers a render ("rendering…"), and returning to an earlier tempo is instant.
- [ ] Re-evaluating keeps the editor open and shows what the code says.
- [ ] A share link reproduces the markers.

Patterns:

- [ ] `$: s("bd*4")` with `$: s("voice").beatsync().cue("accent")` puts the accent on the kick.
- [ ] `setcpm(...)` triggers a re-render, and alignment holds after the first few hits.
- [ ] `s("voice").beatwarp(100).cue("accent")` aligns at a fixed tempo regardless of the REPL tempo.
- [ ] `s("voice").cue("accent").speed(2)` still lands the cue on the onset.
- [ ] `s("loop").fitbpm()` loops in time with the tempo, with pitch shifted.
- [ ] A missing cue or a sample without markers logs a readable error rather than breaking the REPL.
- [ ] `cue` over OSC to SuperDirt: the onset arrives early by the cue offset.
