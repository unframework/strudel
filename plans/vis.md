# Visualizer data feeds

Branch: `nm/vis`. Status: the source and highlight feed and a terminal reference visualizer are built. Other feeds and a real visualizer host are not started.

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

Bandwidth isn't a concern on a LAN. Even sending everything as JSON stays near 10 KB/s, against 100 Mbit/s ≈ 12 MB/s. It only matters on a serial link like the TTY one, where 115200 baud is about 11.5 KB/s and JSON locations at peak would saturate it. Indices fit easily there.

### Open problems

- **Stale events:** events already in flight from before a re-eval must not light ranges in the new source. Fix: tag them with `evalId`, and keep the previous table until its last scheduled event has played.
- **Per-block evaluation:** `$:` blocks may be evaluated with a range offset (label-block handling in `core/repl.mjs`). Check that locations stay in full-document coordinates, or send the block offset along with them.
- **Edits between evals:** the editor maps decorations through edits, but the visualizer only knows the evaluated source. That's probably right (it shows what is playing, not what is being typed), but decide whether it should also mirror unevaluated edits.
- **Non-mini highlights:** signal-driven values (`perlin`, `sine`) never light up. Decide whether the visualizer wants their call sites highlighted with a continuous intensity, which would be a separate feed sampling the signals.

## Visualizer host

Likely either TouchDesigner receiving OSC (easy to hand plain `/vis/` feeds to someone else's rig, but it has no Linux build and its project files are binary), or a custom Godot visualizer (text-based scenes and scripts, so it can be developed both agentically and in the editor; a Pi needs the Compatibility renderer).

A bare-bones reference visualizer tests the source and highlight feeds without either: `pnpm vis-tty` (`packages/osc/vis-tty.mjs`, port from `VIS_PORT`, default 57140) listens on UDP and draws the source in the terminal with ANSI highlights, so it needs no browser and no second bridge. Turn on "Visualizer" in the REPL settings and give its address as seen from the bridge.

### Built

- `packages/osc/vis-protocol.mjs`: addresses, chunking and reassembly, shared by sender and receivers.
- `packages/osc/vis.mjs`: the REPL side. The website publishes each eval's full buffer and `miniLocations` from `afterEval`, and installs a non-dominant `onTrigger` on every pattern through the REPL's `editPattern` option, so haps are seen whichever output plays them. Frames go out through the same bridge connection as `.osc()`, with the visualizer's `host`/`port` and the same timetag clock.
- `packages/osc/vis-scene.mjs`: receiver state (current eval, timed highlights), separate from the terminal rendering in `vis-tty.mjs`.

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
