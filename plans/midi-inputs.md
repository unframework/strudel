# Live MIDI inputs

Branch: `nm/linectrl-controls` (based on `nm/dirt-patches`). Status: ambient controls, the top-bar status widgets and in-editor MIDI learn are implemented.

## Intent

A hardware controller (currently a Behringer X-TOUCH COMPACT) is part of the rig, not part of a sketch. Its knobs, faders and buttons keep their state across evaluations, reloads and sketches, and sketches just read them. Button presses can be cued to the next bar, like `.c()` does for code edits, and the button LEDs show what is heard and what is pending.

The device is chosen outside the sketch. Sketches never name it, so the same code plays with or without the device connected (stored values are used while it is absent).

Seeing and fixing the controller's state should not need the console: whether it's connected, which device, and a way to push stored values back to the hardware after it has drifted (power cycle, another app touching it).

## Ambient controls (done)

```js
$: s("bd*4").gain(IN(12))                  // knob/fader CC 12, 0..1
$: s("hh*8").mask(BTN(36, 1))              // toggle, switches on the next bar
$: s("cp").struct("x*4").mask(PUSH(40))    // 1 only while held
$: note(RADIO([16, 17, 18], 1).pick(["c", "e", "g"]))  // one of a group, on the next bar
```

- `IN(cc, align)`, `BTN(note, align)`, `PUSH(note, align)`, `RADIO(...notes)` or `RADIO([notes], align)` are globals from `@strudel/linectrl`. `align` is in cycles, 0 for immediate.
- `Deck` (`linectrl/controls/deck.mjs`) is one shared object for the whole page, created in `linectrl/controls/rig.mjs` together with the controller session. It holds one `ControlLog` per control key (`in:12`, `btn:36`, `radio:16,17,18`), and saves each log's latest value to localStorage (`linectrl-controls`).
- `ControlLog` records value changes stamped in cycles and applies alignment when read, so the same knob can be heard immediately by one reader and on the next half-bar by another. Old events are pruned into the base value.
- Changes made while the transport is stopped apply immediately. Starting or stopping the transport makes pending changes take effect at once, since cycle numbers restart.
- LEDs: steady while settled, pulsing on the beat while a change is pending (`lights.mjs`). `refresh()` runs every 20 ms while attached and only sends note messages when a velocity changes.
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

Each `IN(…)`, `BTN(…)`, `PUSH(…)` and `RADIO(…)` call gets a small inline widget right after it, showing the control's current value (`0.43`, `on`/`off`, the RADIO index) and a learn dot.

- Clicking the dot arms it (it blinks red), and the next CC (for `IN`) or note-on (for the buttons) from the controller is written into the call: it replaces or fills the first argument, and for `RADIO` it is appended to the note list (`RADIO(16, 17)` → `RADIO(16, 17, 18)`, `RADIO([16], 1)` → `RADIO([16, 17], 1)`), skipping a note already there. Clicking again or pressing Escape in the editor cancels.
- One learner at a time: arming another widget disarms the previous one. The learned message still reaches the deck.
- The code is edited but not evaluated, like any other edit.
- Widgets come from the syntax tree as you type, not from evaluation, so `IN()` can be learned before it ever ran. Calls whose addresses are not number literals (`IN(cc)`) get no widget.
- `linectrl/controls/calls.mjs` reads control calls from the syntax tree and builds the learned edit; `linectrl/controls/editor.mjs` has the widget and view plugin (`controlWidgets`), which the website adds to the main REPL editor with `StateEffect.appendConfig`.
- `ControllerSession.learn(type, onLearned)` returns a learner handle with `isArmed` and `cancel()`. `Deck.watch(kind, addr)` tracks a control for the widget without claiming its lights, so a freshly learned control follows the device before the sketch is evaluated.

## Simplifying control state (open, undecided)

Most of the deck's complexity comes from controls whose meaning depends on the sketch: RADIO groups and PUSH buttons need to be registered before the deck knows how to apply a message and which lights they own, and registrations come from evaluation only (with `Deck.watch` as a stopgap for the editor widget). Two directions are on the table.

### Option A: deck mirrors the device

Keep only `IN` (CC value) and `BTN` (note toggle) as primitives, and drop RADIO and PUSH.

- The deck logs every incoming message regardless of code: each CC records its value under `cc:12`, each note-on flips a toggle under `note:36`. That is what is persisted, so no registration, `watch()` or light registry is needed.
- Readers stay as they are: `IN(12, align)` and `BTN(36, align)` read the shared log at their own alignment, so two readers with different alignments each hear the change when they asked to.
- LED: steady from the toggle's latest value. While the transport runs, it pulses as long as any reader still has the change pending, i.e. until the longest alignment in use has passed. Readers count as in use while the playing sketch keeps querying them, so removing `BTN(36, 4)` from the code drops its alignment within a moment, with no evaluation hook and no code scan.
- The editor widget reads the number directly, and could show its own reader's pending state or countdown from its literal alignment.
- Costs: exclusive groups are gone (no direct replacement for `RADIO(…).pick(…)`), momentary holds are gone (PUSH could come back as a read of whether a note is held, but its LED would toggle), every button on the channel becomes a lit toggle including ones no sketch reads, and stored keys migrate (`in:` → `cc:`, `btn:` → `note:`, `radio:`/`push:` dropped).

### Option B: state lives in the editor text

Like the `.c()` cue ids, the state is written into the code itself: `IN(12, 0.43)`, `BTN(36, 1)`, `RADIO([16, 17, 18], 2)`, with no hidden storage.

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
  - Two calls with the same number (`BTN(36)` twice) both have to be updated on a press.
  - Saved and shared sketches (URL hash, database) carry control values, which may or may not be wanted.

## Later

- A live list of registered controls in the controller popover (`in:12 = 0.43`, a pending BTN change and when it lands), from a `Deck.getControls()` snapshot.
- Configurable MIDI channel, and more than one controller.

## Acceptance testing

1. With the device selected in the controller popover and connected, `IN(12)` follows the fader, and the value is kept after a reload.
2. With the device unplugged, the sketch plays the stored values. Plugging it back in restores the fader positions and lights.
3. `BTN(36, 1)` while playing: the LED pulses on the beat until the next bar, then stays lit and the change is heard. A second press before the bar cancels it.
4. Press a button while stopped: the change applies immediately.
5. The controller chip shows waiting/connected as the device is unplugged and plugged in. Resync restores the faders after they were moved with the page closed.
6. Switching the controller device in the popover detaches the old one with no duplicate messages.
7. Type `IN()`, click its learn dot and move a fader: its CC number is written in and the widget follows the fader. `RADIO()` learns one note per click.
