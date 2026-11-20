import { useState } from 'react';
import { getMidiInputNames } from '@strudel/midi';
import { SelectInputDuplicate } from '@src/repl/components/panel/SettingsTab';

const NONE = '';

/**
 * Device picker listing the connected MIDI inputs, loaded on first open.
 * @param {Object} props
 * @param {string} props.value device name, '' for none
 * @param {string} props.noneLabel
 * @param {function(string): void} props.onChange
 */
export function MidiInputSelect({ value, noneLabel, onChange }) {
  const [inputNames, setInputNames] = useState([]);

  const loadInputs = async () => {
    if (!inputNames.length) {
      setInputNames(await getMidiInputNames());
    }
  };

  const options = new Map([[NONE, noneLabel]]);
  if (value) {
    options.set(value, value);
  }
  inputNames.forEach((name) => options.set(name, name));

  return (
    <SelectInputDuplicate
      className="h-6 py-0 pl-1.5 pr-4 min-w-0 grow"
      options={options}
      value={value}
      onClick={loadInputs}
      onChange={onChange}
    />
  );
}
