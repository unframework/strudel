# Strudel (linectrl fork) Plan

## Goals

- Personal live-coding rig on top of upstream Strudel
- SuperCollider/SuperDirt as an alternative engine
- Hardware-friendly performance: MIDI clock follow, MIDI widgets and buttons, level and measure displays
- Recording, rendering and snippet tooling for turning sessions into finished pieces
- See [RIG.md](RIG.md) for how the pieces fit together in a live setup

## Context

- Pattern-level features are preferred over engine-level ones so that they work for superdough and OSC/SuperDirt alike

## Tasks

- MIDI controller bespoke surface
- [bar-cued changes](plans/cued-changes.md): edit a value or pattern as `OLD.c(NEW)` and it switches on the next aligned cycle boundary, optionally eased; state is an id in code plus in-memory timing for the current run
- [visualizer data feeds](plans/vis.md): push source, highlight activations and other live data to a separate visualizer over one timestamped websocket; highlights measured at a few KB/s; the visualizer may also drive stage lights over sACN/Art-Net
- Continuation mode: after a tab refresh or an accidental stop, resume evaluation at the right moment by preserving clock time instead of restarting from cycle 0

## TBD
