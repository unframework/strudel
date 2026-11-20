import { useEffect, useRef } from 'react';

const callbacks = new Set();
let frame = 0;

function tick() {
  callbacks.forEach((callback) => callback());
  frame = callbacks.size ? requestAnimationFrame(tick) : 0;
}

/**
 * Call `callback` on every animation frame while `isActive`, sharing one loop across the page.
 * @param {function(): void} callback
 * @param {boolean} isActive
 */
export function useFrame(callback, isActive) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const run = () => callbackRef.current();
    callbacks.add(run);
    frame ||= requestAnimationFrame(tick);
    return () => callbacks.delete(run);
  }, [isActive]);
}
