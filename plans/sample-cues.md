# Sample cues, tempo fit and beat warping

Branch: `nm/sample-cues`

## Intent

Strudel's sampler only knows sample URLs. For voice and recorded-drum material that is the main friction: you can't say where the accent of a phrase is, you can't line that accent up with a downbeat, you don't know the sample's tempo, and you can't nudge loose speech timing onto a beat grid.

The workflow this targets:

1. Clean the raw recording in Audacity (trim, denoise, normalise). This feature deliberately does no destructive editing.
2. As a final annotation step, mark beats and named cues on the clean sample in the REPL's annotate tab.
3. Use the annotations from patterns: start samples early so a cue lands on the beat, and play time-stretched versions that sit on the current tempo's grid.

The sample server is the hub. Annotations live next to the audio files, and warped renders are produced and cached by the server, so the browser now (and SuperCollider later) read the same data and the same renders.

## Design

### Sidecar annotations

`voice.wav` is described by `voice.wav.json` in the same folder:

```json
{ "version": 1, "markers": [{ "t": 0.41, "beat": 0 }, { "t": 1.3, "beat": 2, "name": "accent" }], "bpm": 132 }
```

- `t` is seconds into the original file. `beat` places a marker on the beat grid (offbeats are `.5`). `name` makes it a cue that patterns can refer to.
- Sidecars rather than `strudel.json`: they survive copying folders around, regenerating the sample map can't overwrite them, and SuperCollider can read the same file.
- `bpm` is only a fallback when there are fewer than two beat markers.

### Tempo from markers

- Two or more beat markers define the source tempo with a least-squares fit of `t = t0 + beat · secondsPerBeat`.
- What's left over at each marker is its nudge: how far the performance drifts from a steady grid. The tab shows the worst nudge in ms and draws each one as a tick.
- "Auto-number beats" numbers markers by the median spacing, for when markers were tapped without beat numbers.

### Warping

- A warp plan stretches each stretch of audio between neighbouring beat markers so that every beat marker lands exactly on the target tempo's grid. The audio before the first marker and after the last one stretch at the same rate as the section next to them.
- Pitch is preserved, and rendering happens offline on the server rather than in real time: ffmpeg's `rubberband` filter stretches each section, then the sections are joined.
- `GET /file.wav?bpm=X` renders on demand and caches in `.warp-cache/`, keyed by the audio content hash, the markers and the BPM (rounded to 0.01). Clients add `&rev=<marker hash>` so the browser's own URL cache never serves a render made from older markers.
- The shared logic lives in `packages/sample-meta`, used by the server, superdough and the UI: the sidecar format check, tempo fit, warp plan, time mapping and cue lookup.

### Patterns

- `beatwarp(bpm)` plays the render for a given tempo, and `beatsync()` uses the current REPL tempo (4 beats per cycle). It's not called `warp` because that name is already the wavetable warp control.
- While a render loads, the first hits play the original file resampled to the target tempo, so they aren't silent.
- `cue(name)` moves each event's onset earlier by the cue's position in the file (or in the warped render), taking `speed` into account. The sample still starts at its beginning, so the audio before the cue sounds before the beat. This shift happens in the pattern because the scheduler can only start a sound about 0.1 s early. As a result it works for any output, including OSC. The maximum pre-roll is 1 cycle.
- `fitbpm()` matches tempo by plain resampling, so pitch changes along with speed.

### Annotate tab

- Waveform with marker flags (amber, pink for cues), the fitted beat grid and the nudge ticks.
- Editing: double-click adds a marker, drag moves it, and the fields below edit its time, beat and cue name. Delete removes the selected marker. Pressing `t` during playback drops beat markers in order, in half-beat steps when "tap offbeats" is on.
- Preview checkboxes that combine freely:
  - **marker blips:** a short beep at each marker.
  - **grid click:** a metronome on the grid, accented on the downbeat.
  - **warped:** plays the server render and redraws markers on the grid.
  - **custom bpm:** the warp target. Unticked, it uses the REPL tempo.
- "Save" writes the sidecar with a PUT, which only works when the server runs with `--writable`. Patterns pick up the new markers immediately.

## Known limitations

- The warped preview reflects saved markers only; unsaved edits aren't rendered.
- Renders lag by about 5 ms (stretcher latency). Spacing between markers is exact.
- Sections are stretched separately and then joined, so seams may be audible at markers. If so, switch to `rubberband-cli --timemap` for a single continuous pass.
- `cue` can't be combined with `begin`, and it must come after `beatwarp`, `beatsync` and `speed` in the chain.
- The waveform has no zoom.
- `@strudel/sampler` now depends on the private `@strudel/sample-meta` package, so it can't be published to npm as is.
- Out of scope for now: SuperCollider loading warped buffers. Pattern-level `cue` already reaches SuperDirt over OSC.

## Acceptance testing

Setup: put some samples in a folder, e.g. `~/samples/voice/hey.wav` and a drum loop. Then:

- Run `node packages/sampler/sample-server.mjs --dir ~/samples --writable`.
- Run `pnpm dev` and evaluate `samples('local:')`.

Sample server:

- [ ] `curl localhost:5432/` lists banks, plus `_meta` for samples that have sidecars.
- [ ] A PUT without `--writable` is refused with 405. A malformed sidecar is refused with 400.
- [ ] `..` paths are refused with 403 (`curl --path-as-is 'localhost:5432/..%2f..%2fetc%2fpasswd'`).
- [ ] `?bpm=120` renders once; asking again is instant, and a new file appears in `.warp-cache/`.

Annotate tab:

- [ ] The sample picker lists user samples, and the number input picks among several files in a bank.
- [ ] The waveform matches what Audacity shows, and the playhead follows playback.
- [ ] Double-click adds a marker, drag moves it, and Delete removes it. Times are rounded to 0.1 ms.
- [ ] Tapping `t` during playback adds beat markers numbered 0, 1, 2… (0, 0.5, 1… with tap offbeats).
- [ ] With three or more beat markers, the fitted BPM is plausible and the nudge ticks shrink as you correct markers.
- [ ] Marker blips land on the transients you marked.
- [ ] Grid click stays on time with the speech once the fit is good.
- [ ] Warped: after saving, the render plays, markers sit on grid lines, and blips match the click.
- [ ] Custom BPM: a new tempo triggers a render ("rendering…"), and returning to an earlier tempo is instant.
- [ ] Save writes the sidecar, revert discards edits, and you can hear whether there are seams at markers.

Patterns:

- [ ] `$: s("bd*4")` with `$: s("voice").beatsync().cue("accent")` puts the accent on the kick.
- [ ] `setcpm(...)` triggers a re-render, and alignment holds after the first few hits.
- [ ] `s("voice").beatwarp(100).cue("accent")` aligns at a fixed tempo regardless of the REPL tempo.
- [ ] `s("voice").cue("accent").speed(2)` still lands the cue on the onset.
- [ ] `s("loop").fitbpm()` loops in time with the tempo, with pitch shifted.
- [ ] A missing cue or a sample without markers logs a readable error rather than breaking the REPL.
- [ ] `cue` over OSC to SuperDirt: the onset arrives early by the cue offset.
