import { useEffect, useRef, useState } from 'react';
import { getTime } from '@strudel/core';
import { useSettings } from '../../settings.mjs';

const ACCENT = '#3b82f6';
const FLASH_WINDOW = 0.15;

function readFollower(editorRef) {
  const follower = editorRef?.current?.repl?.scheduler?.clockSource;
  if (!follower) {
    return null;
  }
  let cycle = 0;
  let running = false;
  try {
    const now = getTime();
    cycle = follower.cycleAt(now);
    running = follower.isRunning(now);
  } catch (_) {}
  return { deviceName: follower.deviceName ?? null, bpm: follower.bpm ?? 0, cycle, running };
}

export function ClockFollowerStatus({ context }) {
  const { editorRef } = context;
  const { isCSSAnimationDisabled } = useSettings();
  const [status, setStatus] = useState(null);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const s = readFollower(editorRef);
      setStatus(s && { deviceName: s.deviceName, bpm: s.bpm, running: s.running });
    }, 500);
    return () => clearInterval(id);
  }, [editorRef]);

  useEffect(() => {
    if (!status?.running || isCSSAnimationDisabled) {
      setFlash(0);
      return;
    }
    let raf;
    let running = true;
    function tick() {
      if (!running) return;
      const s = readFollower(editorRef);
      if (s) {
        const phase = s.cycle - Math.floor(s.cycle);
        setFlash(phase < FLASH_WINDOW ? 1 - phase / FLASH_WINDOW : 0);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [status?.running, isCSSAnimationDisabled, editorRef]);

  if (!status) {
    return (
      <span className="shrink-0 whitespace-nowrap text-sm font-medium opacity-40" title="no MIDI clock connected">
        ⧗ no clock
      </span>
    );
  }

  const tempo = status.bpm ? `${status.bpm.toFixed(1)} BPM` : '—';
  return (
    <span
      className="shrink-0 whitespace-nowrap text-sm font-medium"
      style={{
        color: flash > 0 ? `color-mix(in srgb, currentColor, ${ACCENT} ${Math.round(flash * 70)}%)` : undefined,
        opacity: status.running ? 1 : 0.6,
      }}
    >
      ⧗ {status.deviceName ?? 'waiting…'} · {tempo}
    </span>
  );
}
