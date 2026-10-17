# @strudel/dirt-patches

SuperDirt patches for [drone-server](https://github.com/unframework/drone-server) and the Strudel controls that drive them, documented in the REPL like built-in ones. The `.mjs` files register and document the controls; `scd/` holds the SuperCollider side, which the drone-server engine loads from this checkout (`DIRT_PATCHES` points at `scd/`, default `~/strudel/packages/dirt-patches/scd`). After editing a patch, `dronectl dirt reload` re-applies it to the running SuperDirt.

| Patch | Adds |
| --- | --- |
| `scd/synths.scd` | superdough-compatible synths, ADSR, `lpf`/`hpf`/`bpf` and their envelopes, Strudel's `gain`, `clip` and `delaysync` semantics |
| `scd/corpus.scd` | `cr…` Corpus resonator |
| `scd/drone.scd` | `dsaw`, `dsine`, `dtri`, `dsquare` steered drone voices |
| `scd/grit.scd` | `grit…` orbit saturator |
| `scd/ofilters.scd` | `olpf`/`ohpf` orbit filters |

`scd/index.scd` loads them in order; `ofilters` places itself after `grit`, and `corpus` runs after the amplitude envelope.

## Strudel compatibility

`synths.scd` makes SuperDirt behave like Strudel's built-in synth engine (superdough), so patterns written for the browser sound roughly the same over OSC:

- **Synths:** `sine`, `sawtooth`, `square`, `triangle` (and `sin`/`saw`/`sqr`/`tri`), `pulse` (`pw`, `pwrate`, `pwsweep`), `supersaw` (`unison` up to 16, `spread`, `detune`; replaces SuperDirt's own `supersaw`), and the noises `white`, `pink`, `brown`, `crackle` (`density`). With no note they play C2, like Strudel. The oscillators take `noise`, vibrato (`vib`, `vibmod`), the pitch envelope (`penv`, `pattack`…, `panchor`) and single-operator FM (`fm`, `fmh`, `fmwave`, `fmattack`…, `fmenv`).
- **Envelope:** `attack`/`decay`/`sustain`/`release` are Strudel's ADSR, with the release after the note ends, on these synths and on samples. `sustain` is the level (0–1), never SuperDirt's note length, so `.sustain(0)` plucks instead of dropping the note.
- **Filters:** `lpf`/`hpf`/`bpf` follow Strudel: `resonance` in its 0–50 dB scale, filter envelopes (`lpenv`, `lpattack`…, `fanchor`), and `ftype` `12db`/`24db`/`ladder` (ladder is lowpass only).
- **Delay:** `delaysync` sets the delay time in cycles, which the browser converts to seconds itself and SuperDirt would ignore. Any event with `delay` gets Strudel's defaults: 3/16 of a cycle and feedback 0.5, capped at 0.98. An explicit `delaytime` in seconds still wins.
- **Levels and length:** `gain` is linear like Strudel (SuperDirt's own curve is gain⁴), and `clip`/`legato` set note length (Strudel sends `clip`, which stock SuperDirt ignores).

It installs through SuperDirt's own extension points: a `~diversion` hook renames Strudel's `sustain` before SuperDirt computes note length, a `~play` hook resolves the envelopes once it has, and the `envelope`, `lpf`, `hpf` and `bpf` modules are replaced. Not ported: filter LFOs (`lprate`…), FM operators beyond the first, noise FM waves, `partials`, `bank`, and the exponential pitch envelope curve.
