# Bar-cued changes

Status: design only, not started.

## Intent

While live editing I want to change a value or a control pattern and have the change take effect on the next bar boundary (1, 2 or 4 bars away) instead of the instant I evaluate. When it helps, the change should ease in over a few bars instead of jumping. Strudel has no state that lasts across evaluations to support this.

The state lives in the sketch code itself, as it does for `slider()` and `markers()`. Evaluating writes a short token into the call that records when the switch happens. An inline widget keeps that token up to date, shows a countdown and offers a collapse button. As a result there is no central registry, no keys that drift when code moves, and re-evaluating identical code is a no-op. Share links and reloads also carry pending changes.

The hardware controls (`IN`/`BTN`/`RADIO` on `Deck`) keep their own value log, because a knob's position is device state rather than code state. The two features share the idea of aligning changes to boundaries, but nothing else.

## Design

### Syntax

```js
$bass: note("c2 eb2")
  .lpf("800".c("2000"))                           // switch on the next bar
  .gain("0.6".c("0.9", 2))                         // next 2-bar boundary
  .room(sine.range(0, .2).c(sine.range(.2, .6), 4, 4))  // next 4-bar boundary, then ease over 4 cycles

$drums: s("bd*4, hh*8").c(s("bd*8, hh*16"))        // whole patterns too
```

- Signature: `OLD.c(NEW, align = 1, ease = 0, state?)`. `align` is the boundary in cycles (1 cycle = 1 bar). `ease` is the ramp length in cycles, 0 for a hard switch.
- Easing interpolates numeric values per event: `lerp(OLD(t), NEW(t), progress)`. Non-numeric values (notes, `s`) switch at the boundary regardless of `ease`.
- The name `c` is unused in Strudel. `cue` already means sample cues.

### State token

- The first evaluation of a `.c()` call without a token appends one: `"800".c("2000", 1, 0, 'p0084')`.
- Format: one status character plus 4 hex digits giving the boundary cycle. `p` means pending, `d` means done. 4 hex digits cover 65535 cycles, about 36 hours at 0.5 cps. The token isn't meant to be edited by hand.
- The token always has the same length, so the editor can flip `p0084` to `d0084` in place while you type. Nothing reflows and the cursor doesn't move.
- The pattern is a pure function of the code:
  - `p`: OLD before the boundary, NEW (or the ramp) after it.
  - `d`: just NEW, with no time dependency.
- A pending token whose boundary has already passed counts as done. This makes stale tokens safe after a reload, after a transport restart (the cycle resets to about 0), or in someone else's copy of the sketch.
- Re-evaluating while a change is pending keeps the token. Editing NEW before the boundary just changes what plays at that same boundary.

### Stamping

- The transpiler finds `.c()` calls with no token and records their positions, as it does for sliders. It also rewrites each call so the runtime computes the boundary: `alignStamp(now + lookahead, align)`. Stamping from the scheduler's lookahead rather than the audible time stops a boundary from landing inside events that are already scheduled.
- After a successful evaluation, the editor writes the computed token into the code. A failed evaluation writes nothing.
- When the transport stops or starts, all pending tokens are flipped to done, matching `Deck._syncTransport`.

### Widget

- An inline widget sits on top of the token text (a CodeMirror replace decoration), so the hex isn't visible. The text underneath keeps its fixed length.
- Pending: a tiny arc that fills as the boundary approaches, then shows the ramp's progress while easing.
- Done: shown dimmed. The editor flips `p` to `d` in place once the boundary (plus the ramp) has passed. These rewrites stay out of undo history.
- A collapse button rewrites `OLD.c(NEW, …, 'd0084')` to just `NEW`, ready for the next `.c()`.
- Widget identity follows the slider approach, but uses mapped decorations instead of the `${from}:${to}` ids, which break when code above them is edited.

## Open questions

- Automatically wrap a literal under the cursor as `OLD.c(OLD)` with NEW selected, so a cued edit doesn't mean retyping the old value?
- Should `align` be measured in cycles, or follow the 4-beats-per-cycle `setBpm` convention when a bar isn't one cycle?
- Positional `ease` before the token is awkward. Use short method variants (`c2`, `c4`) or an options object instead?
- Outside the editor (`@strudel/web`, scripts) a call with no token can't be stamped. Should it play NEW immediately, or OLD?
