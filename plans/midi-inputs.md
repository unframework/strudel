# Live MIDI inputs

Branch: `nm/linectrl-controls` (based on `nm/dirt-patches`). Status: ambient controls and the top-bar status widgets are implemented.

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

## Later

- A live list of registered controls in the controller popover (`in:12 = 0.43`, a pending BTN change and when it lands), from a `Deck.getControls()` snapshot.
- Configurable MIDI channel, and more than one controller.
- MIDI learn in the editor: an inline widget on an `IN(…)`/`BTN(…)`/`PUSH(…)`/`RADIO(…)` call that, when armed, takes the next incoming CC or note number from the controller and writes it into the code in place.

## Acceptance testing

1. With the device selected in the controller popover and connected, `IN(12)` follows the fader, and the value is kept after a reload.
2. With the device unplugged, the sketch plays the stored values. Plugging it back in restores the fader positions and lights.
3. `BTN(36, 1)` while playing: the LED pulses on the beat until the next bar, then stays lit and the change is heard. A second press before the bar cancels it.
4. Press a button while stopped: the change applies immediately.
5. The controller chip shows waiting/connected as the device is unplugged and plugged in. Resync restores the faders after they were moved with the page closed.
6. Switching the controller device in the popover detaches the old one with no duplicate messages.
