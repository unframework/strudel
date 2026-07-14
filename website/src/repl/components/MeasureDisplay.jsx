import { useEffect, useRef, useState } from 'react';
import { getTime } from '@strudel/core';

export function MeasureDisplay({ started }) {
  const [activeBeat, setActiveBeat] = useState(-1);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!started) {
      setActiveBeat(-1);
      return;
    }
    let running = true;
    function tick() {
      if (!running) return;
      try {
        const cycle = getTime();
        setActiveBeat(Math.floor(cycle) % 4);
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
    <div className="flex items-center self-center shrink-0 gap-1">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="w-2.5 h-3 rounded-sm"
          style={{
            backgroundColor: i === activeBeat ? 'currentColor' : undefined,
            opacity: i === activeBeat ? 1 : 0.25,
            border: i !== activeBeat ? '1px solid currentColor' : undefined,
          }}
        />
      ))}
    </div>
  );
}
