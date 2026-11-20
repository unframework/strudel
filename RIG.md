# Live rig

A personal guide to performing with this fork: what the pieces are, how they connect, how to pack and set up for a show, and how to run one. `PLAN.md` and `plans/` track how features get built. This file covers using them together. It's a first draft, so expect sections marked TBD.

## The pieces

```
 X-TOUCH COMPACT ──MIDI──┐
 external MIDI clock ────┤
                         ▼
               browser REPL (linectrl fork)
               sketches, snippets, .c() cues, IN/BTN, plot
                  │                      │
          superdough (WebAudio)    OSC over websocket
          headphones / preview           │
                                         ▼
                                    OSC bridge ──OSC──► drone-server box
                                                         sclang engine + SuperDirt
                                                         + dirt-patches/scd
                                                         └► PipeWire ► PA / USB interface
               sample server ◄── samples('local:'), warps
               visuals (TBD) ◄── hap stream?
```

- **REPL**: this repo's website, deployed as the linectrl build. Settings, the controller deck and snippets live in the browser's localStorage, keyed by origin.
- **Sound engine**: [drone-server](https://github.com/unframework/drone-server) (`~/drone-server`) runs one sclang engine with SuperDirt as a layer: `dronectl dirt start`. It loads `packages/dirt-patches/scd` (`DIRT_PATCHES`), so drone voices, daverb, corpus, grit, orbit filters, tremolo and duck sound like superdough. After editing a patch, run `dronectl dirt reload`. After changing the DaVerb UGen, restart the engine.
- **OSC bridge**: turns the REPL's websocket messages into OSC for SuperDirt (`pnpm osc`). Its URL is a REPL setting, so the bridge can run on the engine box instead of the laptop.
- **Controller**: Behringer X-TOUCH COMPACT, picked in the top bar. Sketches only use `IN(cc)` / `BTN(note)` and never name the device, so they still play without it, using the stored values.
- **Clock**: either the REPL's own clock or an external MIDI clock, picked in the top bar.
- **Samples**: `pnpm sampler` serves `samples/` along with beat-warped renders for `beatsync`/`beatwarp`/`cue`.
- **Recording/rendering**: `dronectl rec start` records the engine output, and `packages/render` renders sketches offline (audio, and keyframed code video) to turn sessions into finished pieces.
- **Visuals**: TBD, see below.

## Feature map

Branches stack in this order: `main` ← `nm/plot` ← `nm/osc-bridge` ← `nm/cues` ← `nm/dirt-patches` ← (`nm/linectrl-controls`, `nm/sample-cues`). A show build needs the tips of both leaf branches merged together.

| Feature | Where | Used live for |
| --- | --- | --- |
| Snippets tab | `main` | searchable library of patterns to copy into the stage sketch |
| MIDI clock follow, beat/measure display, level meter | `main` (moved to top bar in `nm/linectrl-controls`) | locking to other gear, knowing where the bar is |
| Supabase private pattern sync | `main` | same sketches on every device |
| `plot` / `plot1` | `nm/plot` | checking slow modulators before letting them loose |
| OSC bridge URL setting, safe control encoding | `nm/osc-bridge` | pointing the REPL at the engine box |
| `OLD.c(NEW, ease, align)` cued changes | `nm/cues` | edits that land on the bar and ease in instead of jumping |
| dirt-patches + parity harness | `nm/dirt-patches` | SuperDirt sounding like the browser, drone voices, orbit FX |
| Screen wake lock while playing | `nm/dirt-patches` | OSC-only sessions where the browser makes no sound |
| `IN`/`BTN`/`PUSH`/`RADIO`, MIDI learn, controller widget | `nm/linectrl-controls` | hands-on mixing and bar-cued toggles |
| `markers`, `beatsync`, `beatwarp`, `cue`, `fitbpm` | `nm/sample-cues` | voice and recorded material locked to the grid |

## Traveling rig

### Pack list

- Laptop running the REPL, plus its charger
- Engine box running drone-server, or the laptop itself running the engine (TBD: decide which; one box means fewer failure points, two boxes keep the audio safe from browser hiccups)
- USB audio interface, cables to the PA (TRS/XLR, DI box)
- X-TOUCH COMPACT and its USB cable, plus a hub if needed
- Headphones, for previewing
- Network: a travel router, or a direct cable between laptop and engine box. Don't rely on venue Wi-Fi, since the OSC bridge and Tailscale need a link between the two machines.
- Offline copies: the `samples/` folder, all sketches exported to local files in case Supabase can't be reached

### Before leaving

1. Build and deploy the show build (the merged leaf branches), then confirm the deployed URL loads.
2. Run `pnpm parity` on the engine box to catch patch regressions.
3. Play every scene of the set start to finish on the real engine.
4. `dronectl rec start` during a full run-through, then listen back.

### At the venue

1. Engine: `dronectl out usb`, `dronectl dirt start`, then wait for `dirt` 2 in `dronectl status`.
2. Bridge: start it, then check the REPL's OSC URL setting.
3. Controller: plug it in, pick it in the top bar, resync so the faders match the stored values.
4. Clock: internal, or follow the house clock if there's other gear.
5. Line check with a sine on each orbit, and set the PA gain with `dronectl vol`.
6. `dronectl rec start` before doors.

## Multiple REPL instances

A browser keeps localStorage per origin, so deploying the same build under two domains gives two fully independent REPLs: separate settings, sketch, controller deck, OSC URL and audio output. Possible roles:

- **Stage**: sends OSC to SuperDirt, holds the controller, and plays only the current scene.
- **Prep**: uses superdough to headphones. Here I audition the next scene or snippet, tweak it until it's ready, then paste it into the stage tab with a `.c()` so it comes in on the bar. Because of the parity work, what I hear in the prep tab is close to what the PA will play.

Things to work out:

- Timing between tabs. Each tab runs its own clock, so a prep tab won't share a downbeat with the stage tab. To align them, both tabs could follow one MIDI clock source (the clock follower is already on `main`), or the prep tab could stay loose since it's only for headphones.
- Two tabs on one origin share the controller deck and settings. That's another reason to use separate domains rather than two tabs of the same deploy.
- If both tabs ever send OSC, keep them on separate orbits so their orbit FX (daverb, duck, grit) don't overwrite each other.

## Running a show

Sets are mostly ambient, so the job is to keep a slow arc going and avoid fast switching.

- **Scenes as sketches.** Each scene is a sketch (like `raingrains.js`) with a few named layers on their own orbits. For each scene, write down where it starts (its key, tempo and the layer that comes in first), where it ends, and which layers can carry over into the next scene.
- **Transitions.** Bring the next scene's layers into the stage sketch one at a time with `.c()`, at a long `ease` and `align` set to the phrase length, then drop the old scene's layers the same way. Use duck and daverb tails to cover any seams.
- **Hands.** Map one fader to each layer's `mgain` and a few knobs to slow macros (filter sweep, verb size, drone pitch). Use `BTN(note, 4)` toggles to bring layers in and out on the phrase. Keep the mapping the same in every scene so I can play by muscle memory.
- **Setlist file.** TBD: one file listing scene order, key/tempo, carry-over layers and fallback notes, open in a third tab or printed out.
- **Safety nets.** Have a drone that can hold by itself (`dronectl drone start` plays without the browser) to cover a browser crash or reload. Keep a panic action that fades everything out (TBD: decide between a controller button and `dronectl vol`).

## Visuals

A separate, GPU-heavy renderer, probably on the engine box so one machine handles both sound and image. The feature plan, including the data streams it needs, is in [plans/vis.md](plans/vis.md).

## Open questions

- One machine or two?
- Should the bridge live on the engine box permanently?
- Setlist format, and whether scenes should be sketches, snippets or both.
- Whether to deploy a dedicated show build or always use the merged branch tips.
