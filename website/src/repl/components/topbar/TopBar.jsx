import { useEffect } from 'react';
import cx from '@src/cx.mjs';
import { StrudelIcon } from '@src/repl/components/icons/StrudelIcon';
import { followMidiClock, stopMidiClock } from '@strudel/midi/midiclock.mjs';
import { controller } from '@strudel/linectrl/controls/rig.mjs';
import { useSettings, setIsZen } from '../../../settings.mjs';
import { MainMenu, PanelToggle } from '../panel/Panel';
import { BeatDisplay } from './BeatDisplay.jsx';
import { ClockWidget } from './ClockWidget.jsx';
import { ControllerWidget } from './ControllerWidget.jsx';
import { LevelMeter } from './LevelMeter.jsx';

function LogoButton({ context, isEmbedded }) {
  const { started } = context;
  const { isZen, isCSSAnimationDisabled } = useSettings();
  return (
    <div
      className={cx(
        'mt-[1px]',
        started && !isCSSAnimationDisabled && 'animate-spin',
        'cursor-pointer text-blue-500',
        isZen && 'fixed top-2 right-4',
      )}
      onClick={() => {
        if (!isEmbedded) {
          setIsZen(!isZen);
        }
      }}
    >
      <span className="block text-foreground rotate-90">
        <StrudelIcon className="w-5 h-5 fill-foreground" />
      </span>
    </div>
  );
}

function getVersion() {
  const loc = window.location;
  const b = loc.hostname.match(/^(.+)\.(strudel)/);
  if (/(strudel.cc$)/.test(loc.hostname)) {
    // if there's no text before 'strudel', it's warm, otherwise use the text before strudel
    const ver = b ? b[1] : 'warm';
    const pr = ver.match(/pr-([0-9]+)/)?.[1];
    return pr ? { ver: `hot: ${pr}`, prUrl: `https://codeberg.org/uzu/strudel/pulls/${pr}` } : { ver, prUrl: null };
  }
  // match both versions of localhost
  return { ver: /(localhost)|(127.0.0.1)/.test(loc.hostname) ? 'dev' : 'linectrl', prUrl: null };
}

function Brand({ context, isEmbedded, isZen }) {
  const { ver, prUrl } = getVersion();
  const verLabel = <span className="text-sm font-medium hidden sm:block">({ver})</span>;
  return (
    <h1
      onClick={() => {
        if (isEmbedded) window.open(window.location.href.replace('embed', ''));
      }}
      className={cx(
        isEmbedded ? 'text-l cursor-pointer' : 'text-xl',
        'text-foreground font-bold flex space-x-2 items-center',
      )}
    >
      <LogoButton context={context} isEmbedded={isEmbedded} />
      {!isZen && (
        <div className="space-x-2 flex items-baseline">
          <span className="hidden sm:block">strudel</span>
          <span className="text-sm font-medium hidden sm:block">REPL</span>
          {prUrl ? (
            <a className="hover:opacity-50" href={prUrl} target="_blank">
              {verLabel}
            </a>
          ) : (
            verLabel
          )}
        </div>
      )}
    </h1>
  );
}

function MidiInputSettings() {
  const { midiClockInput, controllerInput } = useSettings();

  useEffect(() => {
    midiClockInput ? followMidiClock(midiClockInput) : stopMidiClock();
  }, [midiClockInput]);

  useEffect(() => {
    controller.setDevice(controllerInput);
  }, [controllerInput]);

  return null;
}

export function TopBar({ context, isEmbedded }) {
  const { isZen, isButtonRowHidden, fontFamily } = useSettings();

  const hasMeters = !isEmbedded;
  const hasWidgets = !isEmbedded && !isZen;
  const hasMenu = !isZen && !isButtonRowHidden;

  return (
    <nav
      id="header"
      className={cx(
        'flex-none text-black z-[100] text-sm select-none min-h-10 max-h-10',
        !isZen && !isEmbedded && 'border-b border-muted bg-lineHighlight',
        isZen ? 'h-12 w-8 fixed top-0 left-0' : '',
        'flex items-center',
      )}
      style={{ fontFamily }}
    >
      {!isEmbedded && <MidiInputSettings />}
      <div className="flex w-full justify-between">
        <div className="px-3 py-1 flex items-center space-x-2 select-none">
          <Brand context={context} isEmbedded={isEmbedded} isZen={isZen} />
          {hasMeters && (
            <div className="pl-4 flex items-center gap-3">
              <LevelMeter started={context.started} />
              <BeatDisplay started={context.started} />
            </div>
          )}
        </div>
        {!isZen && (
          <div className="flex grow justify-end items-center">
            {hasWidgets && (
              <div className="flex items-center gap-1">
                <ClockWidget context={context} />
                <ControllerWidget />
              </div>
            )}
            {hasMenu && <MainMenu isEmbedded={isEmbedded} context={context} />}
            <PanelToggle isEmbedded={isEmbedded} isZen={isZen} />
          </div>
        )}
      </div>
    </nav>
  );
}
