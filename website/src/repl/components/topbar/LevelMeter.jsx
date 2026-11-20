import { useEffect, useRef } from 'react';
import { getMasterAnalyser, getMasterAnalyserData } from '@strudel/webaudio';
import { useFrame } from './useFrame.mjs';

function paint(bar, level) {
  bar.style.width = `${level * 100}%`;
  bar.style.backgroundColor = level > 0.9 ? '#ef4444' : level > 0.7 ? '#facc15' : 'currentColor';
}

export function LevelMeter({ started }) {
  const barRef = useRef(null);

  useEffect(() => {
    if (!started) {
      paint(barRef.current, 0);
    }
  }, [started]);

  useFrame(() => {
    try {
      getMasterAnalyser();
      const data = getMasterAnalyserData();
      if (data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        paint(barRef.current, Math.min(Math.pow(rms * 2.5, 0.5), 1));
      }
    } catch (_) {}
  }, started);

  return (
    <div className="flex items-center self-center shrink-0">
      <div className="relative w-16 h-3 rounded-sm overflow-hidden bg-muted">
        <div ref={barRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
