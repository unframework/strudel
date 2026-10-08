import { useEffect, useRef } from 'react';
import { getAudioContext } from '@strudel/webaudio';
import { useSettings } from '../../settings.mjs';

const PPQN = 24;
const BEAT_OPACITY = 1;
const BEAT_FADE_OPACITY = 0.7;
const HELD_OPACITY = 0.5;
const IDLE_OPACITY = 0.35;
const NBSP = '\u00A0';

function formatBpm(bpm) {
  if (!bpm) {
    return `---${NBSP}${NBSP}`;
  }
  const [intPart, dec] = bpm.toFixed(1).split('.');
  const frac = dec === '0' ? `${NBSP}${NBSP}` : `.${dec}`;
  return `${intPart.padStart(3, NBSP)}${frac}`;
}

function buildLabel(s) {
  const name = s ? (s.deviceName ?? 'waiting…') : 'no clock';
  return `${name} ♩ ${formatBpm(s ? s.bpm : 0)}`;
}

function readFollower(editorRef) {
  const follower = editorRef?.current?.repl?.scheduler?.clockSource;
  if (!follower) {
    return null;
  }
  const now = getAudioContext().currentTime;
  const cycle = follower.cycleAt(now);
  const beatsPerCycle = follower.ticksPerCycle / PPQN;
  return {
    deviceName: follower.deviceName ?? null,
    bpm: follower.bpm ?? 0,
    running: follower.isRunning(now),
    beat: Math.floor((cycle - Math.floor(cycle)) * beatsPerCycle),
  };
}

function staticOpacity(s) {
  if (!s) return IDLE_OPACITY;
  return s.running ? BEAT_OPACITY : HELD_OPACITY;
}

export function ClockFollowerStatus({ context }) {
  const { editorRef } = context;
  const { isCSSAnimationDisabled } = useSettings();
  const rootRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    let lastLabel;
    let lastCursor;
    let lastFaded;
    let lastStatic;
    let raf = 0;

    const paintBeat = () => {
      const root = rootRef.current;
      if (!root) return;
      const s = readFollower(editorRef);
      if (s?.running) {
        const faded = s.beat % 2 === 1;
        if (faded !== lastFaded) {
          root.style.opacity = faded ? BEAT_FADE_OPACITY : BEAT_OPACITY;
          lastFaded = faded;
        }
      }
      raf = requestAnimationFrame(paintBeat);
    };

    const poll = setInterval(() => {
      const root = rootRef.current;
      const labelEl = labelRef.current;
      if (!root || !labelEl) return;
      const s = readFollower(editorRef);
      const connected = !!s;

      const label = buildLabel(s);
      if (label !== lastLabel) {
        labelEl.textContent = label;
        lastLabel = label;
      }

      const cursor = s?.running ? 'pointer' : '';
      if (cursor !== lastCursor) {
        root.style.cursor = cursor;
        lastCursor = cursor;
      }

      const shouldBlink = connected && s.running && !isCSSAnimationDisabled;
      if (shouldBlink && !raf) {
        lastFaded = undefined;
        lastStatic = undefined;
        raf = requestAnimationFrame(paintBeat);
      } else if (!shouldBlink && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        lastStatic = undefined;
      }

      if (!raf) {
        const opacity = staticOpacity(s);
        if (opacity !== lastStatic) {
          root.style.opacity = opacity;
          lastStatic = opacity;
        }
      }
    }, 200);

    return () => {
      clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editorRef, isCSSAnimationDisabled]);

  const handleRecue = () => {
    const scheduler = editorRef?.current?.repl?.scheduler;
    const follower = scheduler?.clockSource;
    if (!follower?.recue) return;
    follower.recue(getAudioContext().currentTime);
    scheduler.wake?.();
  };

  return (
    <span
      ref={rootRef}
      onClick={handleRecue}
      className="shrink-0 whitespace-nowrap px-2 text-sm font-medium text-foreground"
      style={{ opacity: IDLE_OPACITY }}
      title="MIDI clock follower — click to re-cue the downbeat to now"
    >
      <span ref={labelRef}>{buildLabel(null)}</span>
    </span>
  );
}
