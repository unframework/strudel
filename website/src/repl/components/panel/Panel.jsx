import { Bars3Icon, PlayIcon, StopIcon, XMarkIcon } from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { useSettings, setIsPanelOpened, setActiveFooter as setTab } from '../../../settings.mjs';
import '../../Repl.css';
import { useLogger } from '../useLogger';
import { ConsoleTab } from './ConsoleTab';
import ExportTab from './ExportTab';
import { FilesTab } from './FilesTab';
import { PatternsTab } from './PatternsTab';
import { Reference } from './Reference';
import { SnippetsTab } from './SnippetsTab';
import { SettingsTab } from './SettingsTab';
import { SoundsTab } from './SoundsTab';
import { WelcomeTab } from './WelcomeTab';

const TAURI = typeof window !== 'undefined' && window.__TAURI__;

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export function Footer({ context, isEmbedded = false }) {
  return (
    <div className="border-t border-muted bg-lineHighlight block lg:hidden">
      <MainMenu context={context} isEmbedded={isEmbedded} />
    </div>
  );
}

export function MainMenu({ context, isEmbedded = false, className }) {
  const { started, pending, isDirty, activeCode, handleTogglePlay, handleEvaluate, handleShare } = context;
  const { isCSSAnimationDisabled } = useSettings();
  return (
    <div className={cx('flex text-sm max-w-full shrink-0 overflow-hidden text-foreground px-2 h-10', className)}>
      <button
        onClick={handleTogglePlay}
        title={started ? 'stop' : 'play'}
        className={cx('px-2 hover:opacity-50', !started && !isCSSAnimationDisabled && 'animate-pulse')}
      >
        <span className={cx('flex items-center space-x-2')}>
          {started ? <StopIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
          {!isEmbedded && <span>{pending ? '...' : started ? 'stop' : 'play'}</span>}
        </span>
      </button>
      <button
        onClick={handleEvaluate}
        title="update"
        className={cx('flex items-center space-x-1 px-2', !isDirty || !activeCode ? 'opacity-50' : 'hover:opacity-50')}
      >
        {!isEmbedded && <span>update</span>}
      </button>
      {!isEmbedded && (
        <button
          title="share"
          className={cx('cursor-pointer hover:opacity-50 flex items-center space-x-1 px-2')}
          onClick={handleShare}
        >
          <span>share</span>
        </button>
      )}
      {!isEmbedded && (
        <a
          title="learn"
          href={`${baseNoTrailing}/workshop/getting-started/`}
          className={cx('hover:opacity-50 flex items-center space-x-1', !isEmbedded ? 'p-2' : 'px-2')}
        >
          <span>learn</span>
        </a>
      )}
    </div>
  );
}

function PanelCloseButton() {
  const { isPanelOpen } = useSettings();
  return (
    isPanelOpen && (
      <button
        onClick={() => setIsPanelOpened(false)}
        className={cx('px-2 py-0 text-foreground hover:opacity-50')}
        aria-label="Close Menu"
      >
        <XMarkIcon className="w-6 h-6" />
      </button>
    )
  );
}

export function BottomPanel({ context }) {
  const { isPanelOpen, activeFooter: tab } = useSettings();
  return (
    <PanelNav
      className={cx(
        isPanelOpen ? `min-h-[360px] max-h-[360px]` : 'min-h-10 max-h-10',
        'overflow-hidden flex flex-col relative',
      )}
    >
      <div className="flex justify-between min-h-10 max-h-10 grid-cols-2 items-center border-t border-muted">
        <PanelCloseButton />
        <Tabs setTab={setTab} tab={tab} className={cx(isPanelOpen && 'border-l border-muted')} />
      </div>
      {isPanelOpen && (
        <div className="w-full h-full overflow-auto border-t border-muted">
          <PanelContent context={context} tab={tab} />
        </div>
      )}
    </PanelNav>
  );
}

export function RightPanel({ context }) {
  const settings = useSettings();
  const { activeFooter: tab, isPanelOpen } = settings;
  if (!isPanelOpen) {
    return;
  }
  return (
    <PanelNav
      settings={settings}
      className={cx(
        'border-l border-muted shrink-0 h-full overflow-hidden',
        isPanelOpen ? `min-w-[min(600px,100vw)] max-w-[min(600px,80vw)]` : 'min-w-12 max-w-12',
      )}
    >
      <div className={cx('flex flex-col h-full')}>
        <div className="flex justify-between w-full overflow-hidden border-b border-muted min-h-10 max-h-10">
          <PanelCloseButton />
          <Tabs setTab={setTab} tab={tab} className="border-l border-muted" />
        </div>
        <div className="overflow-auto h-full">
          <PanelContent context={context} tab={tab} />
        </div>
      </div>
    </PanelNav>
  );
}

const tabNames = {
  patterns: 'patterns',
  snippets: 'snippets',
  sounds: 'sounds',
  reference: 'reference',
  export: 'export',
  console: 'console',
  settings: 'settings',
};
if (TAURI) {
  tabNames.files = 'files';
}

function PanelNav({ children, className, ...props }) {
  const settings = useSettings();
  return (
    <nav
      onClick={() => {
        if (!settings.isPanelOpen) {
          setIsPanelOpened(true);
        }
      }}
      aria-label="Menu Panel"
      className={cx('h-full bg-lineHighlight group overflow-x-auto', className)}
      {...props}
    >
      {children}
    </nav>
  );
}

function PanelContent({ context, tab }) {
  useLogger();
  switch (tab) {
    case tabNames.patterns:
      return <PatternsTab context={context} />;
    case tabNames.snippets:
      return <SnippetsTab context={context} />;
    case tabNames.console:
      return <ConsoleTab />;
    case tabNames.sounds:
      return <SoundsTab />;
    case tabNames.reference:
      return <Reference />;
    case tabNames.export:
      return <ExportTab handleExport={context.handleExport} />;
    case tabNames.settings:
      return <SettingsTab started={context.started} />;
    case tabNames.files:
      return <FilesTab />;
    default:
      return <WelcomeTab context={context} />;
  }
}

function PanelTab({ label, isSelected, onClick }) {
  return (
    <>
      <button
        onClick={onClick}
        className={cx(
          'h-10 px-2 text-sm border-t-2 border-t-transparent text-foreground cursor-pointer hover:opacity-50 flex items-center space-x-1 border-b-2',
          isSelected ? 'border-foreground' : 'border-transparent',
        )}
      >
        {label}
      </button>
    </>
  );
}
function Tabs({ className }) {
  const { isPanelOpen, activeFooter: tab } = useSettings();
  return (
    <div
      className={cx(
        'px-2 w-full flex select-none max-w-full h-10 max-h-10 min-h-10 overflow-auto items-center',
        className,
      )}
    >
      {Object.keys(tabNames).map((key) => {
        const val = tabNames[key];
        return <PanelTab key={key} isSelected={tab === val && isPanelOpen} label={key} onClick={() => setTab(val)} />;
      })}
    </div>
  );
}

export function PanelToggle({ isEmbedded, isZen }) {
  const { panelPosition, isPanelOpen } = useSettings();
  return (
    !isEmbedded &&
    !isZen &&
    panelPosition === 'right' && (
      <button
        title="menu"
        className={cx('border-l border-muted px-2 py-0 text-foreground hover:opacity-50')}
        onClick={() => setIsPanelOpened(!isPanelOpen)}
      >
        <Bars3Icon className="w-6 h-6" />
      </button>
    )
  );
}
