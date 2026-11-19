import { describe, expect, it, vi } from 'vitest';
import {
  CueRun,
  SETTLED,
  cuePattern,
  cuePhase,
  cueRun,
  cueWithId,
  nextBoundary,
  pure,
  s,
  sequence,
} from '../index.mjs';

function createRun(randoms = [0.1, 0.2, 0.3]) {
  const clock = { cycle: 10.5, now: () => clock.cycle };
  let i = 0;
  const run = new CueRun(clock, () => randoms[i++ % randoms.length]);
  return { run, clock };
}

const values = (pat, begin, end) => pat.queryArc(begin, end).map((hap) => hap.value);

describe('CueRun', () => {
  it('mints ids it has not minted before and that the code does not use', () => {
    const { run } = createRun([0.5, 0.5, 0.25, 0.75, 0.1]);

    expect(run.mint(new Set())).toBe('#i000');
    expect(run.mint(new Set())).toBe('#9000');
    expect(run.mint(new Set(['#r000']))).toBe('#3lll');
  });

  it('arms a fresh id at the next aligned boundary, once', () => {
    const { run, clock } = createRun();
    const id = run.mint(new Set());

    run.arm(id, 0, 4);
    clock.cycle = 11;
    run.arm(id, 0, 1);

    expect(run.get(id)).toEqual({ armedAt: 10.5, at: 12, ease: 0 });
  });

  it('leaves ids from earlier runs or other sketches settled', () => {
    const { run } = createRun();
    run.arm('#abcd', 1, 0);
    expect(run.get('#abcd')).toBe(SETTLED);
  });

  it('settles fresh ids evaluated while stopped', () => {
    const { run, clock } = createRun();
    clock.cycle = null;
    const id = run.mint(new Set());
    run.arm(id, 1, 0);
    expect(run.get(id)).toBe(SETTLED);
  });

  it('drops pending changes when the transport stops or restarts', () => {
    const { run, clock } = createRun();
    const id = run.mint(new Set());
    run.arm(id, 1, 0);

    clock.cycle = null;
    run.get(id);
    clock.cycle = 0.2;

    expect(run.get(id)).toBe(SETTLED);
  });
});

describe('nextBoundary', () => {
  it('rounds up to a multiple of align', () => {
    expect(nextBoundary(10.5, 4)).toBe(12);
    expect(nextBoundary(12, 4)).toBe(12);
    expect(nextBoundary(0.3, 0.5)).toBe(0.5);
  });

  it('starts right away with align 0', () => {
    expect(nextBoundary(10.5, 0)).toBe(10.5);
  });
});

describe('cuePhase', () => {
  const cue = { armedAt: 10, at: 12, ease: 2 };

  it('counts down to the boundary, then through the ramp', () => {
    expect(cuePhase(cue, 11)).toEqual({ kind: 'waiting', progress: 0.5 });
    expect(cuePhase(cue, 12.5)).toEqual({ kind: 'easing', progress: 0.25 });
    expect(cuePhase(cue, 14)).toEqual({ kind: 'settled' });
    expect(cuePhase(SETTLED, 0)).toEqual({ kind: 'settled' });
  });

  it('waits with an empty arc until an unaligned change starts', () => {
    expect(cuePhase({ armedAt: 12, at: 12, ease: 2 }, 11.9)).toEqual({ kind: 'waiting', progress: 0 });
  });
});

describe('cuePattern', () => {
  const cueAt = (cue) => ({ get: () => cue });

  it('plays OLD before the boundary and NEW from it', () => {
    const pat = cuePattern(cueAt({ armedAt: 0, at: 2, ease: 0 }), '#0000', pure(1), pure(2));
    expect(values(pat, 1, 3)).toEqual([1, 2]);
  });

  it('switches by onset, keeping events that started before the boundary whole', () => {
    const pat = cuePattern(cueAt({ armedAt: 0, at: 0.5, ease: 0 }), '#0000', pure('a'), sequence('b', 'c'));
    expect(values(pat, 0, 1)).toEqual(['a', 'c']);
  });

  it('eases numbers and numeric controls, switching everything else at the boundary', () => {
    const cue = { armedAt: 0, at: 1, ease: 2 };
    const numbers = cuePattern(cueAt(cue), '#0000', pure(0), pure(100));
    const controls = cuePattern(cueAt(cue), '#0000', s('bd').lpf(0), s('sd').lpf(100));

    expect(values(numbers, 2, 3)).toEqual([50]);
    expect(values(controls, 2, 3)).toEqual([{ s: 'sd', cutoff: 50 }]);
  });

  it('plays NEW when settled', () => {
    const pat = cuePattern(cueAt(SETTLED), '#0000', pure(1), pure(2));
    expect(values(pat, 0, 1)).toEqual([2]);
  });
});

describe('Pattern.c', () => {
  it('plays NEW when no id was written into the call', () => {
    expect(values(pure(1).c(2), 0, 1)).toEqual([2]);
  });

  it('rejects malformed arguments', () => {
    expect(() => pure(1).c()).toThrow(/needs the pattern/);
    expect(() => pure(1).c(2, -1)).toThrow(/ease/);
    expect(() => pure(1).c(2, 1, -1)).toThrow(/align/);
    expect(() => pure(1).c(2, 1, 0, 'nope')).toThrow(/id/);
    expect(() => pure(1).c(2, 'nope')).toThrow(/id/);
  });
});

describe('cueWithId', () => {
  it('passes ease and align on in that order', () => {
    const id = cueRun.mint(new Set());
    const arm = vi.spyOn(cueRun, 'arm');
    cueWithId(pure(1), id, 2, 3);
    expect(arm).toHaveBeenCalledWith(id, 3, 0);
    arm.mockRestore();
  });

  it('claims the id when called on a pattern, with NEW as any value', () => {
    const id = cueRun.mint(new Set());
    const pat = cueWithId(pure(1), id, 2);

    expect(cueRun.isClaimed(id)).toBe(true);
    expect(values(pat, 0, 1)).toEqual([2]);
  });

  it("leaves other objects' c methods and the id alone", () => {
    const id = cueRun.mint(new Set());
    const other = { c: (...args) => args };

    expect(cueWithId(other, id, 2)).toEqual([2]);
    expect(cueRun.isClaimed(id)).toBe(false);
  });
});
