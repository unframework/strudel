# Visualizer data feeds

Branch: `nm/vis`. Status: the source and highlight feed, a terminal reference visualizer and a headless feed generator are built. The signal plot feed is designed but not built. Other feeds are not started.

## Intent

A dedicated visualizer runs separately from the REPL, likely on another machine (the engine box, or a GPU box) and possibly not a browser at all. The engine and the visualizer are separate processes, so they can share a box or not: a Pi running only the engine, a GPU box running both, or three separate boxes. It gets a live feed of what the sketch is doing and draws its own picture. The REPL pushes data to it and never waits on it, so the visuals can't hold up the audio.

This plan covers the feeds the visualizer needs. Each feed is a separate use case with its own message types, but they all share one transport and one clock. The first feed is the source code and its highlights. Others will be added below.

## Shared transport

- Everything is OSC, sent from the REPL through the existing bridge websocket. Each bridge frame already carries its own `host`/`port` (`packages/osc/osc.mjs`, `server.js`, and drone-server's `strudel.ts`), so visualizer messages just target the visualizer's address while engine messages target the engine. This works with the stock `@strudel/osc` bridge, so a WebAudio-only rig needs nothing custom besides the visualizer, and any OSC tool can receive the feeds.
- The REPL does all fan-out, since only it knows which data is for whom. The bridges stay stock and are not changed to duplicate engine traffic, which wouldn't carry the visualizer's data anyway.
- Timed messages go out as OSC bundles, timetagged like the engine's and sent ahead by the scheduler's lookahead. The visualizer schedules them against the timetag rather than drawing them on arrival, with the boxes NTP-synced, the same requirement as the engine.
- Every address is under `/vis/`, with a sub-path per feed, so receivers can ignore feeds they don't draw.
- Bridges send every number as an OSC float. That's fine for indices and offsets below 2^24, but receivers shouldn't expect ints.
- Open: many OSC tools ignore bundle timetags and act on arrival, which would make them run early by the lookahead. Test with TouchDesigner. Fixes could be a per-target just-in-time send mode, or a latency offset on the receiver.

## Feed: source code and highlights

The visualizer shows the whole sketch, zoomed out and independent of the editor's scroll position, and lights up the code that is sounding.

### How highlights work today

- Locations are fixed at evaluation. The transpiler wraps each mini-notation atom, and each plain argument such as `.lpf(800)`, with `withLoc(start, end)` (`core/pattern.mjs`). The full list ends up in `meta.miniLocations`.
- When patterns combine (`appLeft`, `appBoth`, patternified args), their contexts are merged and their `locations` lists are concatenated (`core/hap.mjs`, `core/pattern.mjs`). A single hap therefore carries one location per contributing atom, precursor patterns included. One `raingrains.js` note carries `"4000"`, `"8"`, `"3000"`, `"sine"`, `"db6"`, `"harmonic"`, `"minor"` and several degree atoms. Continuous signals like `perlin` or `sine` have no location, so they never highlight.
- The editor queries haps every frame, lights every `start:end` of the active ones, and dedupes by range (`codemirror/highlight.mjs`).

### Messages

1. **Source:** `/vis/src evalId index count chunk`, the source split into chunks of about 1 KB. A sketch is typically 2–10 KB, which would fit one datagram on localhost, but across a LAN (especially Wi-Fi) a large datagram is split into IP fragments and losing any one loses the whole message. The visualizer reassembles the chunks by `evalId`.
2. **Locations:** `/vis/locs evalId start end start end …`, the eval's location table, chunked the same way if it gets long.
3. **Per event:** `/vis/hl evalId duration idx idx …` in a timetagged bundle, with indices into the eval's location table. Hap values can come along on another feed, or here if a visual wants them (note, gain, orbit).

The REPL sends source and locations on every eval and resends them every 30 s or so, so a visualizer that restarts recovers by itself without a back-channel. A manual resend button covers the impatient case. The visualizer keeps the last source it received across reconnects, and draws nothing for an `evalId` it has no table for yet.

The visualizer keeps the source and table for each `evalId`. It lights a range from the bundle's time for `duration`, merging overlapping events the way the editor dedupes by range.

### Bandwidth

Measured by evaluating each sketch headlessly and querying 32 cycles of haps (onsets only):

| | `raingrains.js` | busy test sketch (4 layers, 16th hats, `off`+`jux`, chords) |
| --- | --- | --- |
| locations at eval | 44 | 72 |
| events/s (average / peak 100 ms window) | 19 / 60 | 48 / 110 |
| locations per event (mean / max) | 6.0 / 13 | 7.3 / 9 |
| hap values as JSON (what OSC already carries) | 4.6 KB/s | 2.0 KB/s |
| locations as JSON `{start,end}` | 2.9 KB/s | 8.4 KB/s |
| locations as an OSC int list | 0.9 KB/s | 2.4 KB/s |
| locations as packed binary (u16 indices) | 0.5 KB/s | 1.3 KB/s |

Bandwidth isn't a concern on a LAN. Even sending everything as JSON stays near 10 KB/s, against 100 Mbit/s ≈ 12 MB/s.

Measured live with the built feed (`vis-tty` status line, OSC payload bytes): typical sketches have 100–200 locations and send 1–2 KB/s. A busy one sends 80–90 events/s at about 9 KB/s, peaking near 15 KB/s when the source is sent on eval. That's about 100 bytes per event, well above the int-list estimate, because each event is its own bundle with a timetag, the `/vis/hl` address, a string `evalId` and float args. Stacking several busy sketches for a show is still a few tens of KB/s and a few hundred packets/s, which is fine. If it ever matters, batch each scheduler tick's events into one bundle and shorten the `evalId`.

### Open problems

- **Stale events:** events already in flight from before a re-eval must not light ranges in the new source. Fix: tag them with `evalId`, and keep the previous table until its last scheduled event has played.
- **Per-block evaluation:** `$:` blocks may be evaluated with a range offset (label-block handling in `core/repl.mjs`). Check that locations stay in full-document coordinates, or send the block offset along with them.
- **Edits between evals:** the editor maps decorations through edits, but the visualizer only knows the evaluated source. That's probably right (it shows what is playing, not what is being typed), but decide whether it should also mirror unevaluated edits.
- **Non-mini highlights:** signal-driven values (`perlin`, `sine`) never light up. Decide whether the visualizer wants their call sites highlighted with a continuous intensity, which would be a separate feed sampling the signals.

## Feed: signal plots

The editor's `_plot` and `_plot1` widgets draw a pattern's value over a window of cycles around the playhead (`draw/plot.mjs`). The visualizer shows the same signals as small bar graphs, docked to the screen edges and joined by a callout line to where the source declares them. It only looks back: it draws the samples it has received so far and never extrapolates, so the REPL only has to stream the present value of each plot.

### What gets collected

- Only the inline widgets `_plot` and `_plot1` take part, since they have a place in the source. The background `.plot()` doesn't.
- The transpiler already records each widget call in `meta.widgets` with its `from`/`to` source span and id, and passes the id into the call. The span covers the whole call chain, so the visualizer anchors at `to`, the end of the `._plot(...)` call on the line that declares it.
- The options that matter (`min`, `max`, `cycles`, `playhead`, `key`) only exist at runtime, when `plot()` runs. So `plot()` also records `{ id, pattern, options }` in a small registry in `@strudel/draw`, cleared on each eval, and the vis module joins it with `meta.widgets` by id after the eval.
- The headless `vis-feed` has no editor widgets, so it registers `_plot` and `_plot1` as widget types itself (so the transpiler still passes ids) with DOM-free methods that only record into the registry.

### Sampling

- The vis module samples each recorded plot on its own clock, like the editor's plot does, rather than at hap onsets. That shows the signal between notes too, and works for plots of sub-patterns that aren't played directly (`const lfo = sine.slow(4)._plot()`, used later in `.lpf(...)`).
- Samples are taken at a fixed step in cycles (e.g. 16 per cycle), and are reduced to one number per series with `plotValue()`, so `key`, note names and booleans behave as in the editor. Stacked patterns give one series each.
- A sample describes the cycle it was taken at, so it goes out in a timetagged bundle for the time that cycle sounds, like the highlights. That needs a cycle-to-time mapping in the vis module. The scheduler has one internally, and each trigger also carries one (`hap.whole.begin`, `targetTime`, `cps`).

### Messages

1. **Plot table:** `/vis/plots evalId index count [end min max lookback] …`, chunked and sent with the source and locations, and needed before an eval counts as complete. `end` is the widget's `to` offset. `min` and `max` are NaN unless the plot sets them (`_plot1` sets 0 and 1), and then the visualizer fits the range itself. `lookback` is how many cycles to keep, `cycles × playhead`, which is 8 for the editor's defaults.
2. **Per sample:** `/vis/plot evalId plotIndex cycle value value …` in a timetagged bundle, with one value per series and NaN for a gap. The cycle lets the visualizer draw cycle marks and spot dropped samples.

At 16 samples per cycle and 0.5 cps, a plot sends 8 messages/s, so even several plots add little to the highlight traffic. Samples could be batched per scheduler tick if needed.

### Open problems

- **History across evals:** a re-eval gives every plot a new `evalId` and index. The visualizer should carry a plot's history over when the new plot's expression (or its stanza) matches an old one, rather than emptying every graph on each edit.
- **Sampling clock:** decide between borrowing the scheduler's own cycle-to-time state and deriving it from triggers. Triggers stop when nothing sounds, while plots should keep going.
- **External input:** the editor resamples upcoming values when MIDI or other input changes them. Sampling only the present avoids that entirely.

## Visualizer host

Likely either TouchDesigner receiving OSC (easy to hand plain `/vis/` feeds to someone else's rig, but it has no Linux build and its project files are binary), or a custom Godot visualizer (text-based scenes and scripts, so it can be developed both agentically and in the editor; a Pi needs the Compatibility renderer).

A bare-bones reference visualizer tests the source and highlight feeds without either: `pnpm vis-tty` (`packages/osc/vis-tty.mjs`, port from `VIS_PORT`, default 57140) listens on UDP and draws the source in the terminal with ANSI highlights, so it needs no browser and no second bridge. In the REPL settings, the Visualizer address works like the OSC bridge URL (default, or a custom `host:port` as seen from the bridge), and a separate checkbox turns on the source and highlight feed. Sketch-driven feeds will go to the same address whenever a sketch uses them, regardless of that checkbox.

### Built

- `packages/osc/vis-protocol.mjs`: addresses, chunking and reassembly, shared by sender and receivers.
- `packages/osc/vis.mjs`: the REPL side. The website publishes each eval's full buffer and `miniLocations` from `afterEval`, and installs a non-dominant `onTrigger` on every pattern through the REPL's `editPattern` option, so haps are seen whichever output plays them. Frames go out through the same bridge connection as `.osc()`, with the visualizer's `host`/`port` and the same timetag clock.
- `packages/osc/vis-scene.mjs`: receiver state (current eval, timed highlights), separate from the terminal rendering in `vis-tty.mjs`.

- `packages/osc/vis-feed.mjs`: headless feed generator. `pnpm vis-feed sketch.js [host:port]` runs the sketch through core's `repl()` and `Cyclist` on Node's clock, with the website's Node-loadable modules in scope and output-only calls stubbed out, and sends the feed over UDP with no browser, bridge or engine involved. It re-evaluates when the file changes, so it also exercises the switch between evals. Heavy sketches skip a few scheduler ticks while starting up and then run on time.
- Next: record and replay a live feed (a relay that rewrites bundle timetags on replay) to capture real sessions.

## Other feeds

Candidates, not yet designed. The source and highlight feed needs low-level wiring into evaluation and hap triggers, but sketch-driven feeds like these would go through a separate pattern helper that sends chosen values to a `/vis/` address.

- Hap values for driving visuals directly from notes, gain and orbit
- Controller values from the linectrl deck
- Cue state: pending and easing `.c()` changes and their progress
- Engine status from drone-server's `/status/watch`
- Audio analysis (levels, spectrum) from the engine output, computed on the engine box so no audio has to travel

## Output: stage lights over sACN / Art-Net

The visualizer can also drive DMX stage lights. It already has the timed feeds and the shared clock, so lighting becomes another thing it renders, next to the screen. Strudel doesn't send DMX itself. This keeps lighting logic (fixture profiles, channel maps, fades, the mapping from hap values to colour and intensity) out of the REPL and the audio path, and lets one machine own the lighting rig.

- **Protocol:** sACN (E1.31) or Art-Net over UDP to an Ethernet DMX node (e.g. DMXKing eDMX1 Pro, or an ESP32 node), which outputs RS-485 DMX to the fixtures. Both are simple enough to send from a small library or by hand: one 512-channel universe per packet, refreshed continuously at about 30–44 Hz, since many fixtures black out if frames stop.
- **USB fallback:** a USB interface using the Enttec Pro protocol (e.g. DMXKing ultraDMX Micro) plugged into the visualizer box. That's a serial device sending framed packets, so the visualizer would need a second output backend. OLA could hide the difference, at the cost of running another daemon.
- **Timing:** lights have to land on the beat, so the visualizer renders DMX frames against the shared clock the same way it schedules highlights, not when messages arrive. Latency through the node and the fixtures (often 10–30 ms, and more for moving heads and some LED dimming curves) needs a per-rig offset, like the audio latency setting.
- **Open:** where the fixture patch (addresses, channel layouts) lives and how it's edited. Whether sketches can address lights directly (e.g. a `light` control on haps that passes through to the visualizer) or only through mappings defined in the visualizer. Behaviour on disconnect: hold the last frame, fade to a default look, or black out.
