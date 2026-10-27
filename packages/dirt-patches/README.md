# @strudel/dirt-patches

SuperDirt patches for [drone-server](https://github.com/unframework/drone-server) and the Strudel controls that drive them, documented in the REPL like built-in ones. The `.mjs` files register and document the controls; `scd/` holds the SuperCollider side, which the drone-server engine loads from this checkout (`DIRT_PATCHES` points at `scd/`, default `~/strudel/packages/dirt-patches/scd`). After editing a patch, `dronectl dirt reload` re-applies it to the running SuperDirt.

| Patch | Adds |
| --- | --- |
| `scd/synths.scd` | superdough-compatible synths, ADSR, `lpf`/`hpf`/`bpf` and their envelopes, Strudel's `gain`, `clip` and `delaysync` semantics |
| `scd/corpus.scd` | `cr…` Corpus resonator |
| `scd/drone.scd` | `dsaw`, `dsine`, `dtri`, `dsquare`, `dpulse` steered drone voices |
| `scd/grit.scd` | `grit…` orbit saturator |
| `scd/ofilters.scd` | `olpf`/`ohpf`/`obpf` orbit filters |
| `scd/daverb.scd` | `daverb`/`dv…` Dattorro plate reverb, needs the DaVerb UGen |
| `scd/tremolo.scd` | Strudel's `tremolo`/`tremolosync` with `tremolodepth`, `tremoloskew`, `tremolophase`, `tremoloshape` |

`scd/index.scd` loads them in order; `ofilters` places itself after `grit`, `daverb` after SuperDirt's reverb, `corpus` runs after the amplitude envelope, and `tremolo` takes the place of SuperDirt's own `tremolo` module (`tremolorate`), so it follows `corpus`.

## daverb

`ugens/DaVerb` is a scsynth port of superdough's `dattorro-reverb` worklet and renders the same output sample for sample. Unlike the browser, where each event has its own send level, `daverb` and the `dv…` parameters apply orbit-wide and the latest event wins, so give reverbed layers their own orbit.

### Building the DaVerb UGen

```sh
sudo apt install cmake
git clone --depth 1 -b Version-3.13.0 https://github.com/supercollider/supercollider ~/src/supercollider  # match scsynth -v
cmake -S ugens/DaVerb -B build -DSC_PATH=~/src/supercollider -DCMAKE_BUILD_TYPE=Release
cmake --build build && cmake --install build
```

This installs into `~/.local/share/SuperCollider/Extensions/DaVerb`. Restart the engine afterwards, since sclang only picks up new classes on startup and `dirt reload` is not enough.

## Strudel compatibility

`synths.scd` makes SuperDirt behave like Strudel's built-in synth engine (superdough), so patterns written for the browser sound roughly the same over OSC:

- **Synths:** `sine`, `sawtooth`, `square`, `triangle` (and `sin`/`saw`/`sqr`/`tri`), `pulse` (`pw`, `pwrate`, `pwsweep`), `supersaw` (`unison` up to 16, `spread`, `detune`; replaces SuperDirt's own `supersaw`), and the noises `white`, `pink`, `brown`, `crackle` (`density`). With no note they play C2, like Strudel. The oscillators take `noise`, vibrato (`vib`, `vibmod`), the pitch envelope (`penv`, `pattack`…, `panchor`) and single-operator FM (`fm`, `fmh`, `fmwave`, `fmattack`…, `fmenv`).
- **Envelope:** `attack`/`decay`/`sustain`/`release` are Strudel's ADSR, with the release after the note ends, on these synths and on samples. `sustain` is the level (0–1), never SuperDirt's note length, so `.sustain(0)` plucks instead of dropping the note.
- **Filters:** `lpf`/`hpf`/`bpf` follow Strudel: `resonance` in its 0–50 dB scale, filter envelopes (`lpenv`, `lpattack`…, `fanchor`), and `ftype` `12db`/`24db`/`ladder` (ladder is lowpass only).
- **Delay:** `delaysync` sets the delay time in cycles, which the browser converts to seconds itself and SuperDirt would ignore. Any event with `delay` gets Strudel's defaults: 3/16 of a cycle and feedback 0.5, capped at 0.98. An explicit `delaytime` in seconds still wins.
- **Levels and length:** `gain` is linear like Strudel (SuperDirt's own curve is gain⁴), and `clip`/`legato` set note length (Strudel sends `clip`, which stock SuperDirt ignores).

It installs through SuperDirt's own extension points: a `~diversion` hook renames Strudel's `sustain` before SuperDirt computes note length, a `~play` hook resolves the envelopes once it has, and the `envelope`, `lpf`, `hpf` and `bpf` modules are replaced. Not ported: filter LFOs (`lprate`…), FM operators beyond the first, noise FM waves, `partials`, `bank`, and the exponential pitch envelope curve.

## Parity harness

`pnpm parity` renders each pattern in `parity/cases.mjs` through both engines and compares the results: overall level, octave-band spectrum, RMS envelope over time, and the strongest spectral peaks. A case passes when all three differences stay within `--tolerance` dB (default 1). Differences more than 40 dB below the loudest part of a render are ignored, so near-silent residue doesn't swamp the result.

```sh
pnpm parity                                    # every case
pnpm parity fm lpf --detail                    # cases whose name contains "fm" or "lpf", with full tables
pnpm parity --code 'note("c2").s("sawtooth").fm("2:4.01")'   # ad-hoc pattern
```

Both sides run the real code. Strudel renders through `@strudel/render` (superdough in headless Chromium on an `OfflineAudioContext`). SuperDirt runs in a separate sclang with these patches loaded, against a server that is never booted: its OSC output is recorded and played through `scsynth` in non-realtime mode, so the live drone engine is never touched. Each hap reaches SuperDirt as the same controls `@strudel/osc` would send it. Orbit `amp` is 1, so levels compare the synthesis, not the engine's mix. Renders, the event list and `report.json` land in `parity/out/<case>/` for listening.

To cover a newly ported feature, add a case with a pattern that isolates it.
