# Visualizer data feeds

Branch: TBD. Status: exploration. The highlight stream has been measured, nothing is built.

## Intent

A dedicated visualizer runs separately from the REPL, likely on another machine (the engine box, or a GPU box) and possibly not a browser at all. It gets a live feed of what the sketch is doing and draws its own picture. The REPL pushes data to it and never waits on it, so the visuals can't hold up the audio.

This plan covers the feeds the visualizer needs. Each feed is a separate use case with its own message types, but they all share one transport, one clock and one way of connecting. The first feed is the source code and its highlights. Others will be added below.

## Shared transport

- One websocket from the REPL, or from the OSC bridge fanning out what it already receives, to the visualizer. Small, rare messages, as well as messages too big for one UDP datagram, go over it as JSON. If a feed ever gets dense enough to matter, it can switch to packed binary frames.
- Timed messages carry their audio time and are sent ahead of it, the same way OSC bundles are. The visualizer schedules them against a shared clock rather than drawing them when they arrive. TBD: which clock (the bridge's, NTP between boxes, or an offset handshake on connect).
- Every message is tagged with its feed, so the visualizer can ignore feeds it doesn't draw.

## Feed: source code and highlights

The visualizer shows the whole sketch, zoomed out and independent of the editor's scroll position, and lights up the code that is sounding.

### How highlights work today

- Locations are fixed at evaluation. The transpiler wraps each mini-notation atom, and each plain argument such as `.lpf(800)`, with `withLoc(start, end)` (`core/pattern.mjs`). The full list ends up in `meta.miniLocations`.
- When patterns combine (`appLeft`, `appBoth`, patternified args), their contexts are merged and their `locations` lists are concatenated (`core/hap.mjs`, `core/pattern.mjs`). A single hap therefore carries one location per contributing atom, precursor patterns included. One `raingrains.js` note carries `"4000"`, `"8"`, `"3000"`, `"sine"`, `"db6"`, `"harmonic"`, `"minor"` and several degree atoms. Continuous signals like `perlin` or `sine` have no location, so they never highlight.
- The editor queries haps every frame, lights every `start:end` of the active ones, and dedupes by range (`codemirror/highlight.mjs`). The old TTY mirror (`codemirror/tty.mjs` with `terminal.mjs`, pushing JSON through a serial websocket server) does the same thing for its visible terminal window, so it's a working example of sending highlights off the page.

### Messages

1. **On evaluation:** `{ evalId, source, locations: [[start, end], …] }`. This is rare and only a few KB, but a 1.7 KB sketch already exceeds a single UDP MTU, which is why it goes over the websocket.
2. **Per event:** `{ evalId, time, duration, locIdx: [i, …] }`, indices into the eval's location table. Hap values can come along on another feed, or here if a visual wants them (note, gain, orbit). The OSC send path already has the hap in hand, so the bridge is a natural place to emit this.

The visualizer keeps the source and table for each `evalId`. It lights a range from `time` for `duration`, merging overlapping events the way the editor dedupes by range.

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

Bandwidth isn't a concern on a LAN. Even sending everything as JSON stays near 10 KB/s, against 100 Mbit/s ≈ 12 MB/s. It only matters on a serial link like the TTY one, where 115200 baud is about 11.5 KB/s and JSON locations at peak would saturate it. Indices fit easily there.

### Open problems

- **Stale events:** events already in flight from before a re-eval must not light ranges in the new source. Fix: tag them with `evalId`, and keep the previous table until its last scheduled event has played.
- **Per-block evaluation:** `$:` blocks may be evaluated with a range offset (label-block handling in `core/repl.mjs`). Check that locations stay in full-document coordinates, or send the block offset along with them.
- **Edits between evals:** the editor maps decorations through edits, but the visualizer only knows the evaluated source. That's probably right (it shows what is playing, not what is being typed), but decide whether it should also mirror unevaluated edits.
- **Non-mini highlights:** signal-driven values (`perlin`, `sine`) never light up. Decide whether the visualizer wants their call sites highlighted with a continuous intensity, which would be a separate feed sampling the signals.

## Other feeds

Candidates, not yet designed:

- Hap values for driving visuals directly from notes, gain and orbit
- Controller values from the linectrl deck
- Cue state: pending and easing `.c()` changes and their progress
- Engine status from drone-server's `/status/watch`
- Audio analysis (levels, spectrum) from the engine output, computed on the engine box so no audio has to travel
