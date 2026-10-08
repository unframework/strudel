import { useEffect, useRef } from 'react';
import { getAudioContext } from '@strudel/webaudio';
import { useSettings } from '../../settings.mjs';

const ACCENT = '#3b82f6';
const FLASH_WINDOW = 0.15;

function readFollower(editorRef) {
  const follower = editorRef?.current?.repl?.scheduler?.clockSource;
  if (!follower) {
    return null;
  }
  const now = getAudioContext().currentTime;
  return {
    deviceName: follower.deviceName ?? null,
    bpm: follower.bpm ?? 0,
    cycle: follower.cycleAt(now),
    running: follower.isRunning(now),
  };
}

export function ClockFollowerStatus({ context }) {
  const { editorRef } = context;
  const { isCSSAnimationDisabled } = useSettings();
  const rootRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    let lastLabel;
    let lastOpacity;
    let lastCursor;
    let raf = 0;

    const paintBlink = () => {
      const root = rootRef.current;
      if (!root) return;
      const s = readFollower(editorRef);
      let color = '';
      if (s?.running) {
        const phase = s.cycle - Math.floor(s.cycle);
        const flash = phase < FLASH_WINDOW ? 1 - phase / FLASH_WINDOW : 0;
        if (flash > 0) {
          color = `color-mix(in srgb, currentColor, ${ACCENT} ${Math.round(flash * 70)}%)`;
        }
      }
      root.style.color = color;
      raf = requestAnimationFrame(paintBlink);
    };

    const poll = setInterval(() => {
      const root = rootRef.current;
      const labelEl = labelRef.current;
      if (!root || !labelEl) return;
      const s = readFollower(editorRef);
      const connected = !!s;
      const label = connected
        ? `⧗ ${s.deviceName ?? 'waiting…'} · ${s.bpm ? `${Math.round(s.bpm)} BPM` : '—'}`
        : '⧗ no clock';
      if (label !== lastLabel) {
        labelEl.textContent = label;
        lastLabel = label;
      }
      const opacity = connected ? (s.running ? 1 : 0.6) : 0.4;
      if (opacity !== lastOpacity) {
        root.style.opacity = opacity;
        lastOpacity = opacity;
      }
      const cursor = s?.running ? 'pointer' : '';
      if (cursor !== lastCursor) {
        root.style.cursor = cursor;
        lastCursor = cursor;
      }
      const shouldBlink = connected && s.running && !isCSSAnimationDisabled;
      if (shouldBlink && !raf) {
        raf = requestAnimationFrame(paintBlink);
      } else if (!shouldBlink && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        root.style.color = '';
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
      style={{ opacity: 0.4 }}
      title="MIDI clock follower — click to re-cue the downbeat to now"
    >
      <span ref={labelRef}>⧗ no clock</span>
    </span>
  );
}
