# Strudel (linectrl fork) Plan

## Goals

- Personal live-coding rig on top of upstream Strudel
- SuperCollider/SuperDirt as an alternative engine
- Hardware-friendly performance: MIDI clock follow, MIDI widgets and buttons, level and measure displays
- Recording, rendering and snippet tooling for turning sessions into finished pieces

## Context

- Pattern-level features are preferred over engine-level ones so that they work for superdough and OSC/SuperDirt alike

## Tasks

- [live MIDI inputs](plans/midi-inputs.md): controller state outside the sketch, read by ambient controls
  - ✅ `IN`/`BTN`/`PUSH`/`RADIO` controls with bar-aligned changes and pending-change LEDs, `MidiInput` slimmed to connection and raw I/O
  - ✅ top-bar status widgets: meters on one shared frame loop, chip/popover widgets for MIDI clock and controller with device picker and resync
  - ✅ in-editor MIDI learn: inline value + learn widget on each control call, writing the next CC/note number into the code
  - ✅ deck mirrors the device: only `IN` and `BIN` remain, every CC and note is tracked and persisted without registration
- [bar-cued changes](plans/cued-changes.md): edit a value or pattern as `OLD.c(NEW)` and it switches on the next aligned cycle boundary, optionally eased; state is an id in code plus in-memory timing for the current run

## TBD
