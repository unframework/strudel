import { useEffect } from 'react';

export default function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) {
      return;
    }

    let sentinel;
    let disposed = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) {
        return;
      }
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed) {
          next.release();
        } else {
          sentinel = next;
        }
      } catch (e) {
        console.warn('[wakelock] Failed to acquire screen wake lock:', e.message);
      }
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      sentinel?.release();
    };
  }, [active]);
}
