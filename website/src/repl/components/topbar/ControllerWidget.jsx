import { useSyncExternalStore } from 'react';
import { controller } from '@strudel/linectrl/controls/rig.mjs';
import { settingsMap, useSettings } from '../../../settings.mjs';
import { ChipPopover, PopoverAction, PopoverRow } from './ChipPopover.jsx';
import { MidiInputSelect } from './MidiInputSelect.jsx';

const subscribe = (listener) => controller.subscribe(listener);
const getStatus = () => controller.getStatus();

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
    </ChipPopover>
  );
}
