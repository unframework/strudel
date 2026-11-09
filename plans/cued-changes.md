# Bar-cued changes

Status: design only, not started.

## Intent

While live editing I want to change a value or a control pattern and have the change take effect on the next bar boundary (1, 2 or 4 bars away) instead of the instant I evaluate. When it helps, the change should ease in over a few bars instead of jumping. Strudel has no state that lasts across evaluations to support this.

The code holds only a stable identity for each change. On its first evaluation, a `.c()` call gets a random id written into it, and that id never changes after that. The timing state (which cycle the switch happens on) is kept in local storage under that id. It only matters for the current uninterrupted run of the sketch, and is cleared once the change has happened or the transport stops. The code is therefore never rewritten while it plays, so undo and redo history only ever contains edits you made yourself, plus the one-time insertion of the id.

The hardware controls (`IN`/`BTN`/`RADIO` on `Deck`) keep their own value log, because a knob's position is device state rather than code state. The two features share the idea of aligning changes to boundaries, but nothing else.

## Design

### Syntax

```js
$bass: note("c2 eb2")
  .lpf("800".c("2000"))                           // switch on the next cycle
  .gain("0.6".c("0.9", 2))                         // next multiple of 2 cycles
  .room(sine.range(0, .2).c(sine.range(.2, .6), 4, 4))  // next multiple of 4 cycles, then ease over 4

$drums: s("bd*4, hh*8").c(s("bd*8, hh*16"))        // whole patterns too
```

- Signature: `OLD.c(NEW, align = 1, ease = 0, id?)`, all positional. `align` is the boundary in cycles. `ease` is the ramp length in cycles, 0 for a hard switch.
- Easing interpolates numeric values per event: `lerp(OLD(t), NEW(t), progress)`. Non-numeric values (notes, `s`) switch at the boundary regardless of `ease`.
- The name `c` is unused in Strudel. `cue` already means sample cues.

### Id token

- The first evaluation of a `.c()` call without an id appends one: `"800".c("2000", 1, 0, 'k3x9')`. Ids are 4 random base-36 characters (about 1.7 million possible), with no meaning of their own and not meant to be edited by hand.
- Ids are minted only by the editor after a successful evaluation. Inserting one is the only rewrite this feature makes during playback, and it happens at eval time, when you expect the code to change.
- Local storage keeps a recently-used list of ids (a few hundred), including ids from calls that have since been deleted, so a freshly minted id doesn't reuse one that may still be in the undo history or another sketch.

### Transition state

- Local storage maps id → boundary cycle while a change is pending, e.g. `{ k3x9: 132 }`.
- The pattern reads that entry at query time:
  - Entry with the boundary still ahead: OLD before the boundary, NEW (or the ramp) after it.
  - No entry: just NEW.
- Life cycle:
  - **Call has no id:** evaluating mints an id and stores a boundary of `alignStamp(now + lookahead, align)`. Stamping from the scheduler's lookahead rather than the audible time stops a boundary from landing inside events that are already scheduled.
  - **Id with a pending entry:** re-evaluating keeps the entry. Editing NEW before the boundary just changes what plays at that same boundary.
  - **Id with no entry:** the change has already happened, so NEW plays. To cue another change, collapse the call and wrap the value in `.c()` again.
  - **Boundary plus ramp has passed:** the entry is deleted. Entries whose boundary is already in the past are treated as finished and deleted when read.
  - **Transport stops or starts:** all entries are cleared, since cycle numbers restart. This matches `Deck._syncTransport`.
- What undo does:
  - Undoing the id insertion removes the id, so the next evaluation mints a new one and cues the change again. That matches what the text now says.
  - Undoing or redoing other edits leaves ids alone, so pending changes keep their timing.
- A copied and pasted call shares its id, and therefore its timing, with the original. That's acceptable; collapsing one of them gives it a fresh start.

### Widget

- An inline widget sits on top of the id (a CodeMirror replace decoration), so the id isn't visible and its length never changes.
- Pending: a tiny arc that fills as the boundary approaches, then shows the ramp's progress while easing. The widget reads its state from storage and never edits the code.
- Done (no entry): shown dimmed.
- A collapse button rewrites `OLD.c(NEW, …, 'k3x9')` to just `NEW` and deletes the entry. This is an ordinary user edit, so undo restores the call.

## Open questions

- Automatically wrap a literal under the cursor as `OLD.c(OLD)` with NEW selected, so a cued edit doesn't mean retyping the old value?
- Two tabs share local storage. Clearing entries when one tab stops would also clear the other tab's pending changes. Should entries be scoped by tab (`sessionStorage`, or a per-tab prefix)?
- Outside the editor (`@strudel/web`, scripts), no id can be minted. Should such a call play NEW immediately, or OLD?
