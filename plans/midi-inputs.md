# Live MIDI inputs

Branch: `nm/linectrl-controls` (based on `nm/dirt-patches`). Status: ambient controls are implemented; the top-bar status widgets are proposed.

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
- `Deck` (`linectrl/controls/deck.mjs`) is one shared object for the whole page, created lazily on the first control read. It holds one `ControlLog` per control key (`in:12`, `btn:36`, `radio:16,17,18`), and saves each log's latest value to localStorage (`linectrl-controls`).
- `ControlLog` records value changes stamped in cycles and applies alignment when read, so the same knob can be heard immediately by one reader and on the next half-bar by another. Old events are pruned into the base value.
- Changes made while the transport is stopped apply immediately. Starting or stopping the transport makes pending changes take effect at once, since cycle numbers restart.
- LEDs: steady while settled, pulsing on the beat while a change is pending (`lights.mjs`). `refresh()` runs every 20 ms while attached and only sends note messages when a velocity changes.
- On connect, `attach(input)` sends the stored knob and fader positions to the device (for encoders and motorized faders) and starts the light refresh. `detach()` stops it.
- The device and channel are constants in `linectrl/controls/index.mjs` (`DEVICE = 'X-TOUCH COMPACT'`, `CHANNEL = 1`).

### MidiInput slimmed down

- `@strudel/midi`'s `MidiInput` now only handles connection, reconnection, the per-CC values used by `midin`'s `cc()`, and raw I/O: `onMessage`, `onConnectionChange`, `sendCC`, `sendNote`.
- Note toggles, cue scheduling and LED rendering moved out of it into the deck. `cc.noteToggle` is gone from `midin`.
- The connection widget in `midi.mjs` uses `onConnectionChange` instead of the old widget listener.

## Top-bar status widgets (proposed)

### Controller session API

`linectrl/controls/session.mjs`, with no UI dependencies:

- `getStatus()`: `{ phase: 'idle' } | { phase: 'waiting', device } | { phase: 'connected', device } | { phase: 'unavailable', device, error }`
- `subscribe(listener)` returns an unsubscribe function, so React can read it with `useSyncExternalStore`.
- `setDevice(name)` closes the current input and opens a new one. This replaces the `DEVICE` constant.
- `resync()` calls `deck.attach(input)` again, which re-sends knob and fader positions and clears the sent-velocity cache so every light repaints.
- Needs `MidiInput.close()`: the connection loop currently runs forever, so switching devices would leak the old input. Each input becomes a single-use handle.

### UI structure

There are two kinds of top-bar item:

- **Meters** update every frame and write to the DOM directly, with no popover: level meter, beat display.
- **Status widgets** re-render only when their status changes. Each is a chip that opens a popover with details and actions: MIDI clock, controller.

```
website/src/repl/components/topbar/
  TopBar.jsx            brand | meters | widgets | menu; embedded/zen visibility decided once
  useFrame.mjs          one shared animation loop with an on/off flag
  Chip.jsx              status dot + label + title
  ChipPopover.jsx       headlessui Popover anchored under a chip
  MidiInputSelect.jsx   device picker shared by clock and controller
  LevelMeter.jsx        meter
  BeatDisplay.jsx       meter (today's MeasureDisplay)
  ClockWidget.jsx       chip "♩ 120.0" → input select, follow state, re-cue button
  ControllerWidget.jsx  chip "X-TOUCH ●" → device select, status, resync button
```

- Widgets are composed by hand in `TopBar`, not through a registry, until per-widget visibility settings are wanted.
- Today each top-bar item runs its own loop (two separate animation loops, plus a 200 ms poll and another animation loop in `ClockFollowerStatus`) and checks `isEmbedded` itself. The meter and beat display sit inside the `<h1>`.

### Steps

1. Extract `TopBar`, `useFrame` and `MidiInputSelect`, and move the meter and beat display onto `useFrame`. No visible change.
2. Add `Chip` and `ChipPopover`, and turn the clock selector into `ClockWidget`.
3. Add the controller session API and `MidiInput.close()`, with tests against a fake input.
4. Add `ControllerWidget` with the device picker and resync button.

## Later

- A live list of registered controls in the controller popover (`in:12 = 0.43`, a pending BTN change and when it lands), from a `Deck.getControls()` snapshot.
- Configurable MIDI channel, and more than one controller.

## Open questions

- Should the clock input picker move into the popover, leaving only the BPM chip in the bar? It's more consistent, but changing devices takes an extra click.
- Where should the controller device setting live: website settings (`controllerInput`, next to `midiClockInput`, passed to `setDevice`), or linectrl's own storage so it also works outside the website? Leaning towards website settings.

## Acceptance testing

1. With the device connected, `IN(12)` follows the fader, and the value is kept after a reload.
2. With the device unplugged, the sketch plays the stored values. Plugging it back in restores the fader positions and lights.
3. `BTN(36, 1)` while playing: the LED pulses on the beat until the next bar, then stays lit and the change is heard. A second press before the bar cancels it.
4. Press a button while stopped: the change applies immediately.
5. (proposed) The controller chip shows waiting/connected as the device is unplugged and plugged in. Resync restores the faders after they were moved with the page closed.
6. (proposed) Switching the controller device in the popover detaches the old one with no duplicate messages.
