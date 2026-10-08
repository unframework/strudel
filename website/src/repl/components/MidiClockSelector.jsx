import React, { useEffect, useState } from 'react';
import { getMidiInputNames } from '@strudel/midi';
import { followMidiClock, stopMidiClock } from '@strudel/midi/midiclock.mjs';
import { SelectInputDuplicate } from '@src/repl/components/panel/SettingsTab';
import { settingsMap, useSettings } from '../../settings.mjs';
import { ClockFollowerStatus } from './ClockFollowerStatus.jsx';

const NO_CLOCK = '';

export function MidiClockSelector({ context }) {
  const { midiClockInput } = useSettings();
  const [inputNames, setInputNames] = useState([]);

  useEffect(() => {
    if (midiClockInput) {
      followMidiClock(midiClockInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInputs = () => {
    if (inputNames.length) {
      return;
    }
    getMidiInputNames().then(setInputNames);
  };

  const onChange = (value) => {
    if (value === NO_CLOCK) {
      stopMidiClock();
    } else {
      followMidiClock(value);
      context?.editorRef?.current?.evaluate(false);
    }
    settingsMap.setKey('midiClockInput', value);
  };

  const options = new Map([[NO_CLOCK, 'no clock']]);
  if (midiClockInput) {
    options.set(midiClockInput, midiClockInput);
  }
  inputNames.forEach((name) => options.set(name, name));

  return (
    <span className="flex items-center gap-1">
      <SelectInputDuplicate
        className="h-6 py-0 pl-1.5 pr-4"
        options={options}
        value={midiClockInput}
        onClick={loadInputs}
        onChange={onChange}
      />
      {!!midiClockInput && <ClockFollowerStatus context={context} />}
    </span>
  );
}
