# Live MIDI inputs

Branch: `nm/linectrl-controls` (based on `nm/dirt-patches`). Status: ambient controls, the top-bar status widgets and in-editor MIDI learn are implemented, and control state is simplified to a deck mirroring the device.

## Intent

A hardware controller (currently a Behringer X-TOUCH COMPACT) is part of the rig, not part of a sketch. Its knobs, faders and buttons keep their state across evaluations, reloads and sketches, and sketches just read them. Button presses can be cued to the next bar, like `.c()` does for code edits, and the button LEDs show what is heard and what is pending.

The device is chosen outside the sketch. Sketches never name it, so the same code plays with or without the device connected (stored values are used while it is absent).

Seeing and fixing the controller's state should not need the console: whether it's connected, which device, and a way to push stored values back to the hardware after it has drifted (power cycle, another app touching it).

## Ambient controls (done)

```js
$: s("bd*4").gain(IN(12))                  // knob/fader CC 12, 0..1
$: s("hh*8").mask(BIN(36, 1))              // toggle, switches on the next bar
```

- `IN(cc, align)` and `BIN(note, align)` are globals from `@strudel/linectrl`. `align` is in cycles, 0 for immediate.
- `Deck` (`linectrl/controls/deck.mjs`) is one shared object for the whole page, created in `linectrl/controls/rig.mjs` together with the controller session. It mirrors the device regardless of code: each incoming CC records its value under `cc:12`, each note-on flips a toggle under `note:36`. It holds one `ControlLog` per key and saves each log's latest value to localStorage (`linectrl-controls`), so nothing needs registering before a control follows the device.
- `ControlLog` records value changes stamped in cycles and applies alignment when read, so the same knob can be heard immediately by one reader and on the next half-bar by another. Old events are pruned into the base value.
- Changes made while the transport is stopped apply immediately. Starting or stopping the transport makes pending changes take effect at once, since cycle numbers restart.
- LEDs: every note toggle on the channel is lit from its latest value, including ones no sketch reads. While the transport runs, a light pulses on the beat as long as any reader still has the change pending (`lights.mjs`). Readers count as in use while the sketch keeps querying them (within the last cycle), so removing `BIN(36, 4)` from the code drops its alignment without an evaluation hook. `refresh()` runs every 20 ms while attached and only sends note messages when a velocity changes.
- On connect, `attach(input)` sends the stored knob and fader positions to the device (for encoders and motorized faders) and starts the light refresh. `detach()` stops it.
- The device comes from the website's `controllerInput` setting (see below). The channel is a constant in `rig.mjs` (`CHANNEL = 1`).

### MidiInput slimmed down

- `@strudel/midi`'s `MidiInput` now only handles connection, reconnection, the per-CC values used by `midin`'s `cc()`, and raw I/O: `onMessage`, `onConnectionChange`, `sendCC`, `sendNote`.
- Note toggles, cue scheduling and LED rendering moved out of it into the deck. `cc.noteToggle` is gone from `midin`.
- The connection widget in `midi.mjs` uses `onConnectionChange` instead of the old widget listener.

## Top-bar status widgets (done)

### Controller session API

`linectrl/controls/session.mjs`, with no UI dependencies:

- `getStatus()`: `{ phase: 'idle' } | { phase: 'waiting', device } | { phase: 'connected', device } | { phase: 'unavailable', device, error }`
- `subscribe(listener)` returns an unsubscribe function, so React can read it with `useSyncExternalStore`.
- `setDevice(name)` closes the current input and opens a new one, `''` for none. A switch that lands while an older one is still opening closes the stale input.
- `resync()` calls `deck.attach(input)` again, which re-sends knob and fader positions and clears the sent-velocity cache so every light repaints. It throws unless connected.
- `MidiInput.close()` stops the connection loop and drops its listeners, so each input is a single-use handle and switching devices leaks nothing.
- The shared `controller` instance lives in `rig.mjs`, and the website imports it from `@strudel/linectrl/controls/rig.mjs` so it is not a sketch global.

### UI structure

There are two kinds of top-bar item:

- **Meters** update every frame and write to the DOM directly, with no popover: level meter, beat display.
- **Status widgets** re-render only when their status changes. Each is a chip that opens a popover with details and actions: MIDI clock, controller.

```
website/src/repl/components/topbar/
  TopBar.jsx            brand | meters | widgets | menu; embedded/zen visibility decided once; applies the MIDI input settings
  useFrame.mjs          one shared animation loop with an on/off flag
  Chip.jsx              status dot + label + title
  ChipPopover.jsx       headlessui Popover anchored under a chip
  MidiInputSelect.jsx   device picker shared by clock and controller
  LevelMeter.jsx        meter
  BeatDisplay.jsx       meter
  ClockWidget.jsx       chip "● ♩ 120.0" → input select, follow state, re-cue button
  ControllerWidget.jsx  chip "● X-TOUCH" → device select, status, resync button
```

- Widgets are composed by hand in `TopBar`, not through a registry, until per-widget visibility settings are wanted.
- `TopBar` follows the `midiClockInput` and `controllerInput` settings with effects, so the clock and controller connect in zen mode too, where the widgets are hidden. Embedded REPLs connect neither.
- The clock widget polls the follower on `useFrame` and only re-renders when the device, BPM or running state changes; its dot blinks on the beat by direct DOM writes.
- The clock input picker moved into the popover, leaving the BPM chip in the bar.

### Message log (done)

The controller popover shows the last 50 incoming messages (channel, cc/note on/note off, number, value) in a small scrolling list, newest first, so pressing buttons and moving faders reveals their CC and note numbers.

- `ControllerSession` keeps the buffer: `getRecentMessages()` returns an immutable snapshot and `subscribeMessages(listener)` notifies on each message, separate from status so the chip does not re-render on fader moves.
- The buffer is cleared on device switch.

## MIDI learn in the editor (done)

Each `IN(…)` and `BIN(…)` call gets a small inline widget right after it, showing the control's current value (`0.43`, `on`/`off`) and a learn dot.

- Clicking the dot arms it (it blinks red), and the next CC (for `IN`) or note-on (for `BIN`) from the controller is written into the call, replacing or filling the first argument. Clicking again or pressing Escape in the editor cancels.
- One learner at a time: arming another widget disarms the previous one. The learned message still reaches the deck.
- The code is edited but not evaluated, like any other edit.
- Widgets come from the syntax tree as you type, not from evaluation, so `IN()` can be learned before it ever ran. Calls whose addresses are not number literals (`IN(cc)`) get no widget.
- `linectrl/controls/calls.mjs` reads control calls from the syntax tree and builds the learned edit; `linectrl/controls/editor.mjs` has the widget and view plugin (`controlWidgets`), which the website adds to the main REPL editor with `StateEffect.appendConfig`.
- `ControllerSession.learn(type, onLearned)` returns a learner handle with `isArmed` and `cancel()`. The widget reads `Deck.value(kind, num)`, so a freshly learned control follows the device before the sketch is evaluated.

## Simplifying control state (done)

The deck used to need sketch-specific registrations: RADIO groups and PUSH buttons had to be registered by evaluation before the deck knew how to apply a message and which lights they owned. Option A was chosen: the deck mirrors the device, with only `IN` (CC value) and `BIN` (note toggle) as primitives.

- RADIO and PUSH are gone, along with `Deck.watch` and the light registry. Exclusive groups and momentary holds have no replacement yet; PUSH could come back as a read of whether a note is held.
- Stored keys moved from `in:`/`btn:` to `cc:`/`note:` without migration, so old values are dropped on first save.
- The editor widget could later show its own reader's pending state or countdown from its literal alignment.

### Option B: state lives in the editor text (not taken)

Like the `.c()` cue ids, the state is written into the code itself: `IN(12, 0.43)`, `BIN(36, 1)`, `RADIO([16, 17, 18], 2)`, with no hidden storage.

- Addresses and state must be literals, so everything is known from the syntax tree without evaluation. Variables are not supported, which covers nearly all real use and keeps it simple.
- Incoming MIDI updates the literal in the text; at runtime the sketch reads a live in-memory value seeded from the literal at evaluation, the same split as the existing `slider()` (`sliderWithID`: code → state at eval, state at query time, the widget writes the text).
- RADIO and toggles keep working, since their shape is visible in the code. PUSH needs no stored state at all: held notes can be tracked by the MIDI input, the widget just shows it.
- Alignment and pending LEDs stay runtime-only on top of the control log; the text holds the latest intended value.
- Each sketch carries its own control values. That reverses the current intent that controller state belongs to the rig and is shared across sketches, though loading a sketch could then move motorized faders to its values via resync.
- Risks to settle:
  - A fader sends a stream of CCs, so text edits must be throttled and kept out of undo history (`addToHistory: false`), or undo becomes unusable.
  - The REPL marks the code dirty whenever text differs from the evaluated code (`isDirty` in `core/repl.mjs`), so every knob move would look like an unevaluated edit unless control literals are excluded from that comparison.
  - MIDI edits land while the user is typing, possibly on the same line: selection mapping handles positions, but a literal under the cursor could fight the keyboard, and vim/emacs modes need checking.
  - Evaluating mid-stream reads the text as it was, so the live value must win over a stale literal at eval when they differ.
  - Two calls with the same number (`BIN(36)` twice) both have to be updated on a press.
  - Saved and shared sketches (URL hash, database) carry control values, which may or may not be wanted.

## Alignments declared by evaluation

Blinking currently depends on which alignments the playing sketch queried within the last cycle, so a removed `BIN(36, 4)` keeps a button blinking for up to a cycle. Instead, each evaluation declares the alignments it uses.

- Readers stay stateless over the log: any `BIN(1, 4)`, old or freshly evaluated, reads the press stamp with its own alignment, so it returns the old value until the 4-bar boundary. Re-evaluating mid-wait keeps the original boundary, and an identical copy of the call elsewhere behaves the same.
- `deck.reader(...)` called during an evaluation adds its (note, align) to that evaluation's set, and a successful evaluation replaces the previous set as a whole. Collected at runtime, so computed alignments (`BIN(1, a)`) count too. The set holds while the transport is stopped, until the next evaluation.
- A button is pending while any declared alignment for it has not yet heard the latest change. Pruning keeps history back to the longest declared alignment, so an alignment that a re-evaluation newly lengthens can find older history gone, which is acceptable.
- Bookkeeping and rendering split: the deck keeps the logs and the declared set and answers `value` and `isPending(note, now)`, while a lights layer owns the output, the refresh timer, the sent-velocity cache and the beat pulse, and asks the deck for each note's state.
- Evaluation is the only source; the editor syntax tree does not declare anything. Between evaluations the hardware may behave slightly out of step with the code, which is fine.
- Block-based evaluation (`evaluateBlock`) re-runs only some blocks, so replacing the whole set would drop the others' alignments. Not used for now; a per-label set fixes it later.
- RADIO could return later as another evaluation-declared kind, replaced the same way: a rule that turns the group's other toggles off at the press stamp, so aligned readers hear the swap on one boundary, and conflicting groups only ever clear toggles.

## Later

- A live list of controls in the controller popover (`cc:12 = 0.43`, a pending BIN change and when it lands), from a `Deck.getControls()` snapshot.
- Configurable MIDI channel, and more than one controller.

## Acceptance testing

1. With the device selected in the controller popover and connected, `IN(12)` follows the fader, and the value is kept after a reload.
2. With the device unplugged, the sketch plays the stored values. Plugging it back in restores the fader positions and lights.
3. `BIN(36, 1)` while playing: the LED pulses on the beat until the next bar, then stays lit and the change is heard. A second press before the bar cancels it.
4. Press a button while stopped: the change applies immediately.
5. The controller chip shows waiting/connected as the device is unplugged and plugged in. Resync restores the faders after they were moved with the page closed.
6. Switching the controller device in the popover detaches the old one with no duplicate messages.
7. Type `IN()`, click its learn dot and move a fader: its CC number is written in and the widget follows the fader.
8. With `BIN(36, 4)` playing, press the button: its LED pulses until the 4-cycle boundary. Remove the call, re-evaluate and press again: the LED switches steadily within a cycle.
