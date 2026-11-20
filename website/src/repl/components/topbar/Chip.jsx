import cx from '@src/cx.mjs';

const dotClasses = {
  off: 'bg-muted',
  waiting: 'bg-yellow-400',
  ok: 'bg-green-500',
  error: 'bg-red-500',
};

/**
 * @param {Object} props
 * @param {'off' | 'waiting' | 'ok' | 'error'} props.tone
 * @param {string} props.label
 */
export function Chip({ tone, label, dotRef, className, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'flex items-center gap-1.5 shrink-0 whitespace-nowrap px-2 h-6 rounded-sm text-sm font-medium text-foreground hover:bg-background focus:outline-none',
        className,
      )}
      {...props}
    >
      <span ref={dotRef} className={cx('w-2 h-2 rounded-full', dotClasses[tone])} />
      <span>{label}</span>
    </button>
  );
}
