# Strudel fork (linectrl) Plan

## Goals

- Personal live-coding rig on top of upstream Strudel, kept as a stack of rebasable `nm/*` feature branches
- Hardware-friendly performance: MIDI clock follow, MIDI widgets and buttons, level and measure displays
- Recording, rendering and snippet tooling for turning sessions into finished pieces
- Sample workflow for voice and recorded material: annotate cues and beats, play warped to tempo
- SuperCollider/SuperDirt as an alternative engine via `packages/dirt-patches` and `~/drone-server`

## Context

- Upstream moves independently; `restack.py` rebases each `nm/*` branch onto upstream main, so branches should stay small and self-contained
- Audio editing (trimming, cleanup) stays in Audacity; Strudel-side tooling only annotates and plays back
- The local sample server is the shared hub for the browser and SuperCollider, so data lives next to the audio files on disk
- Pattern-level features are preferred over engine-level ones so that they work for superdough and OSC/SuperDirt alike

## Tasks

- [sample cues, tempo fit and beat warping](plans/sample-cues.md) (`nm/sample-cues`): built, needs acceptance testing
  - add `nm/sample-cues` to `restack.py`
- TBD: SuperDirt loading of warped renders (`X-Warp-Path` → `/strudel/warp/load`)
- TBD: waveform zoom in the annotate tab
- TBD: single continuous warp with `rubberband-cli --timemap` if per-section seams are audible

## TBD
