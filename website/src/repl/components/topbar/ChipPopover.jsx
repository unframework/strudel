import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Chip } from './Chip.jsx';

export function ChipPopover({ children, ...chipProps }) {
  return (
    <Popover>
      <PopoverButton as={Chip} {...chipProps} />
      <PopoverPanel
        anchor={{ to: 'bottom end', gap: 6 }}
        className="z-[200] flex flex-col gap-2 w-64 p-3 text-sm text-foreground bg-background border border-muted rounded-md shadow-lg"
      >
        {children}
      </PopoverPanel>
    </Popover>
  );
}

export function PopoverRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="opacity-60">{label}</span>
      {children}
    </div>
  );
}

export function PopoverAction({ children, ...props }) {
  return (
    <button
      type="button"
      className="px-2 py-1 border border-muted rounded-sm hover:bg-lineHighlight disabled:opacity-40 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  );
}
