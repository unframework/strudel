import { useSyncExternalStore } from 'react';
import { controller } from '@strudel/linectrl/controls/rig.mjs';
import { settingsMap, useSettings } from '../../../settings.mjs';
import { ChipPopover, PopoverAction, PopoverRow } from './ChipPopover.jsx';
import { MidiInputSelect } from './MidiInputSelect.jsx';

const subscribe = (listener) => controller.subscribe(listener);
const getStatus = () => controller.getStatus();
const subscribeMessages = (listener) => controller.subscribeMessages(listener);
const getRecentMessages = () => controller.getRecentMessages();

const messageLabels = { cc: 'cc', noteon: 'note on', noteoff: 'note off' };
const messageTones = { cc: '', noteon: 'text-green-400', noteoff: 'text-green-700' };

const chips = {
  idle: () => ({ tone: 'off', label: 'no controller' }),
  waiting: ({ device }) => ({ tone: 'waiting', label: device }),
  connected: ({ device }) => ({ tone: 'ok', label: device }),
  unavailable: ({ device }) => ({ tone: 'error', label: device }),
};

const descriptions = {
  idle: () => 'off',
  waiting: () => 'waiting for device',
  connected: () => 'connected',
  unavailable: ({ error }) => `unavailable: ${error}`,
};

export function ControllerWidget() {
  const { controllerInput } = useSettings();
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);

  return (
    <ChipPopover {...chips[status.phase](status)} title="MIDI controller">
      <PopoverRow label="controller">
        <MidiInputSelect
          value={controllerInput}
          noneLabel="no controller"
          onChange={(value) => settingsMap.setKey('controllerInput', value)}
        />
      </PopoverRow>
      <PopoverRow label="status">
        <span className="text-right">{descriptions[status.phase](status)}</span>
      </PopoverRow>
      <PopoverAction
        disabled={status.phase !== 'connected'}
        onClick={() => controller.resync()}
        title="Send stored knob and fader positions and lights to the device"
      >
        resync device
      </PopoverAction>
      <MessageLog />
    </ChipPopover>
  );
}

function MessageLog() {
  const messages = useSyncExternalStore(subscribeMessages, getRecentMessages, getRecentMessages);

  return (
    <div className="h-48 overflow-y-auto px-1.5 py-1 font-mono text-[10px] leading-tight border border-muted rounded-sm">
      {messages.length === 0 && <div className="opacity-60">no messages yet</div>}
      {messages.map(({ seq, type, channel, num, value }) => (
        <div key={seq} className={`grid grid-cols-[2.5rem_3.5rem_1.75rem_1.75rem] tabular-nums ${messageTones[type]}`}>
          <span className="opacity-60">ch {channel}</span>
          <span>{messageLabels[type]}</span>
          <span className="text-right">{num}</span>
          <span className="text-right opacity-60">{value}</span>
        </div>
      ))}
    </div>
  );
}
