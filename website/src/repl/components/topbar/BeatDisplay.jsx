import { useEffect, useRef } from 'react';
import { getTime } from '@strudel/core';
import { useFrame } from './useFrame.mjs';

const BEATS = [0, 1, 2, 3];

function paint(cells, activeBeat) {
  cells.forEach((cell, i) => {
    const isActive = i === activeBeat;
    cell.style.backgroundColor = isActive ? 'currentColor' : '';
    cell.style.opacity = isActive ? 1 : 0.25;
    cell.style.border = isActive ? '' : '1px solid currentColor';
  });
}

export function BeatDisplay({ started }) {
  const cellsRef = useRef([]);
  const activeBeatRef = useRef(null);

  const show = (beat) => {
    if (beat !== activeBeatRef.current) {
      paint(cellsRef.current, beat);
      activeBeatRef.current = beat;
    }
  };

  useEffect(() => {
    if (!started) {
      show(-1);
    }
  }, [started]);

  useFrame(() => {
    try {
      show(Math.floor(getTime()) % 4);
    } catch (_) {}
  }, started);

  return (
    <div className="flex items-center self-center shrink-0 gap-1">
      {BEATS.map((i) => (
        <div key={i} ref={(cell) => (cellsRef.current[i] = cell)} className="w-2.5 h-3 rounded-sm" />
      ))}
    </div>
  );
}
