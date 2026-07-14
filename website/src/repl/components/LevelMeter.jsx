import { useEffect, useRef } from 'react';
import { getMasterAnalyser, getMasterAnalyserData } from '@strudel/webaudio';

export function LevelMeter({ started }) {
  const barRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!started) {
      bar.style.width = '0%';
      bar.style.backgroundColor = 'currentColor';
      return;
    }
    let running = true;
    function tick() {
      if (!running) return;
      try {
        getMasterAnalyser();
        const data = getMasterAnalyserData();
        if (data) {
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length);
          const level = Math.min(Math.pow(rms * 2.5, 0.5), 1);
          bar.style.width = `${level * 100}%`;
          bar.style.backgroundColor = level > 0.9 ? '#ef4444' : level > 0.7 ? '#facc15' : 'currentColor';
        }
      } catch (_) {}
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [started]);

  return (
    <div className="flex items-center self-center shrink-0">
      <div className="relative w-16 h-3 rounded-sm overflow-hidden bg-muted">
        <div ref={barRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
