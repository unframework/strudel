# Bar-cued changes

Branch: `nm/cues` (based on `nm/dirt-patches`). Status: implemented except the collapse button and the wrap shortcut.

## Intent

While live editing I want to change a value or a control pattern and have the change take effect on the next bar boundary (1, 2 or 4 bars away) instead of the instant I evaluate. When it helps, the change should ease in over a few bars instead of jumping. Strudel has no state that lasts across evaluations to support this.

The code holds only a stable identity for each change. On its first evaluation, a `.c()` call gets a random id written into it, and that id never changes after that. The timing state (which cycle the switch happens on) is kept in memory by the current run of the sketch, under that id. It only matters for that uninterrupted run, and is dropped once the change has happened or the transport stops. Nothing is persisted, so reloads and other tabs can't see or disturb it. The code is therefore never rewritten while it plays, so undo and redo history only ever contains edits you made yourself, plus the one-time insertion of the id.

The hardware controls (`IN`/`BTN`/`RADIO` on `Deck`) keep their own value log, because a knob's position is device state rather than code state. The two features share the idea of aligning changes to boundaries, but nothing else.

## Design

### Syntax

```js
$bass: note("c2 eb2")
  .lpf("800".c("2000"))                           // ease over 1 cycle, starting right away
  .gain("0.6".c("0.9", 0, 2))                      // hard switch on the next multiple of 2 cycles
  .room(sine.range(0, .2).c(sine.range(.2, .6), 4, 4))  // next multiple of 4 cycles, then ease over 4

$drums: s("bd*4, hh*8").c(s("bd*8, hh*16"))        // whole patterns too
```

- Signature: `OLD.c(NEW, ease = 1, align = 0, id?)`, all positional, with the id after whichever of `ease` and `align` are written. `ease` is the ramp length in cycles, 0 for a hard switch. `align` is the boundary in cycles, 0 to start as soon as the scheduler can play it (about 0.1 s after evaluation).
- Easing interpolates numeric values per event: `lerp(OLD(t), NEW(t), progress)`. Non-numeric values (notes, `s`) switch at the boundary regardless of `ease`.
- Outside the editor (`@strudel/web`, scripts) no id can be minted, so `.c()` just plays NEW.
- The name `c` is unused in Strudel. `cue` already means sample cues.

### Id token

- The first evaluation of a `.c()` call without an id appends one, filling in the default `ease` to show it but leaving the default `align` of 0 implicit: `"800".c("2000",1,'#k3x9')`. Ids are `#` plus 4 random base-36 characters (about 1.7 million possible), with no meaning of their own and not meant to be edited by hand. The `#` makes them easy for the editor to find.
- The transpiler mints ids, but only when an editor is attached (`cueRun.isMinting`). The editor writes them into the code after a successful evaluation; if the code was edited while the evaluation ran, it writes nothing and logs a warning, and the next evaluation mints again. Inserting one is the only rewrite this feature makes during playback, and it happens at eval time, when you expect the code to change.
- A new id must not match any id minted earlier in the same run, or any id already in the document. Ids from earlier runs, other sketches or the undo history have no entry, so they can't pick up someone else's timing.

### Transition state

- The run (`cueRun` in core) keeps an in-memory map of id → `{ armedAt, at, ease }` for the changes it has cued, e.g. `{ '#k3x9': { armedAt: 130.6, at: 132, ease: 0 } }`. Only ids minted during this run are ever in it.
- The pattern reads that entry at query time:
  - Entry with the boundary still ahead: OLD before the boundary, NEW (or the ramp) after it.
  - Entry with the boundary passed, or no entry: just NEW.
- Life cycle:
  - **Call has no id:** evaluating mints an id and stores a boundary of `nextBoundary(now + 0.1 s, align)`. Stamping a little ahead of the scheduler's position stops a boundary from landing inside events that are already scheduled.
  - **Id with a pending entry:** re-evaluating keeps the entry. Editing NEW before the boundary just changes what plays at that same boundary.
  - **Id with no entry:** the change has already happened, or the id comes from an earlier run, so NEW plays. To cue another change, collapse the call and wrap the value in `.c()` again.
  - **Boundary plus ramp has passed:** NEW plays from then on. The entry stays until the run ends, which is harmless.
  - **Transport stops or starts:** the run ends and its map is dropped, since cycle numbers restart. A page reload has the same effect.
- What undo does:
  - Undoing the id insertion removes the id, so the next evaluation mints a new one and cues the change again. That matches what the text now says.
  - Undoing or redoing other edits leaves ids alone, so pending changes keep their timing.
- A copied and pasted call shares its id, and therefore its timing, with the original. That's acceptable; collapsing one of them gives it a fresh start.

### Widget

- An inline widget sits on top of the id (a CodeMirror replace decoration), so the id isn't visible and its length never changes.
- A `MatchDecorator` finds `'#xxxx'` literals anywhere in the code, so widgets appear on load, paste and undo without waiting for an evaluation. The id is an atomic range, so the cursor skips over it and backspace deletes it whole.
- Waiting: a tiny arc that fills as the boundary approaches. Easing: the arc shows the ramp's progress, slightly dimmed. Settled: a dim full ring.
- The widget reads its state from the run's map and never edits the code.

### Code

- `packages/core/cue.mjs`: `CueRun`, the `.c()` method and the switch/ease pattern.
- `packages/transpiler/plugin-cues.mjs`: mints ids and fills in the default `ease`. Since only the runtime knows whether the receiver is a pattern, it routes `X.c(…)` through `cueWithId(X, id, …)`. Only a pattern receiver uses the id, and the editor writes only ids that were used, so other objects' `c` methods are left alone. NEW can be any value.
- `packages/codemirror/cues.mjs`: writes minted ids after evaluation, and the arc widget.

## Later

- A collapse button in the widget that rewrites `OLD.c(NEW, …, '#k3x9')` to just `NEW`. An ordinary user edit, so undo restores the call.
- A keyboard shortcut that wraps the literal under the cursor as `OLD.c(OLD)` with NEW selected, so a cued edit doesn't mean retyping the old value.

## Known limitations

- Block evaluation only checks the evaluated block for ids already in use, so a new id could in theory match one in another block (about 1 in 1.7 million per id).
- If an evaluation fails after transpiling, its minted ids are never written and simply go unused.
- On long lines the widget can wrap onto its own line.

## Acceptance testing

1. Play `$: s("bd*4").gain("0.3")`, then change it to `$: s("bd*4").gain("0.3".c("1", 0, 2))` and evaluate. An id appears in the call, drawn as an arc that fills up, and the kick gets louder exactly on the next even cycle.
2. Evaluate again without changes: nothing re-cues and the ring stays dim.
3. Use `.c("1", 4, 2)` on a fresh call: the gain ramps up over 4 cycles after the boundary, with the arc tracking the ramp.
4. Cue a change, then stop before the boundary and start again: NEW plays right away.
5. Undo the id insertion and evaluate: a new id is minted and the change is cued again.
6. Evaluate a `.c()` block with block-based evaluation enabled: the id lands in the right call.

## Later

- A collapse button in the widget that rewrites `OLD.c(NEW, …, '#k3x9')` to just `NEW`. An ordinary user edit, so undo restores the call.
- A keyboard shortcut that wraps the literal under the cursor as `OLD.c(OLD)` with NEW selected, so a cued edit doesn't mean retyping the old value.

## Known limitations

- Block evaluation only checks the evaluated block for ids already in use, so a new id could in theory match one in another block (about 1 in 1.7 million per id).
- If an evaluation fails after transpiling, its minted ids are never written and simply go unused.
- On long lines the widget can wrap onto its own line.

## Acceptance testing

1. Play `$: s("bd*4").gain("0.3")`, then change it to `$: s("bd*4").gain("0.3".c("1", 0, 2))` and evaluate. An id appears in the call, drawn as an arc that fills up, and the kick gets louder exactly on the next even cycle.
2. Evaluate again without changes: nothing re-cues and the ring stays dim.
3. Use `.c("1", 4, 2)` on a fresh call: the gain ramps up over 4 cycles after the boundary, with the arc tracking the ramp.
4. Cue a change, then stop before the boundary and start again: NEW plays right away.
5. Undo the id insertion and evaluate: a new id is minted and the change is cued again.
6. Evaluate a `.c()` block with block-based evaluation enabled: the id lands in the right call.

## Open questions

- Automatically wrap a literal under the cursor as `OLD.c(OLD)` with NEW selected, so a cued edit doesn't mean retyping the old value?
