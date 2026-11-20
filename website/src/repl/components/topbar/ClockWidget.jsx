import { useRef, useState } from 'react';
import { getAudioContext } from '@strudel/webaudio';
import { settingsMap, useSettings } from '../../../settings.mjs';
import { ChipPopover, PopoverAction, PopoverRow } from './ChipPopover.jsx';
import { MidiInputSelect } from './MidiInputSelect.jsx';
import { useFrame } from './useFrame.mjs';

const PPQN = 24;
const NBSP = ' ';
const OFF = { deviceName: null, bpm: 0, isRunning: false, beat: 0 };

function formatBpm(bpm) {
  if (!bpm) {
    return `---${NBSP}${NBSP}`;
  }
  const [intPart, dec] = bpm.toFixed(1).split('.');
  const frac = dec === '0' ? `${NBSP}${NBSP}` : `.${dec}`;
  return `${intPart.padStart(3, NBSP)}${frac}`;
}

function readFollower(scheduler) {
  const follower = scheduler?.clockSource;
  if (!follower) {
    return OFF;
  }
  const now = getAudioContext().currentTime;
  const cycle = follower.cycleAt(now);
  const beatsPerCycle = follower.ticksPerCycle / PPQN;
  return {
    deviceName: follower.deviceName ?? null,
    bpm: follower.bpm ?? 0,
    isRunning: follower.isRunning(now),
    beat: Math.floor((cycle - Math.floor(cycle)) * beatsPerCycle),
  };
}

function chipFor(midiClockInput, { deviceName, bpm, isRunning }) {
  if (!midiClockInput) {
    return { tone: 'off', label: 'no clock' };
  }
  if (!deviceName) {
    return { tone: 'waiting', label: 'waiting…' };
  }
  return { tone: isRunning ? 'ok' : 'waiting', label: `♩ ${formatBpm(bpm)}` };
}

export function ClockWidget({ context }) {
  const { midiClockInput, isCSSAnimationDisabled } = useSettings();
  const scheduler = () => context.editorRef?.current?.repl?.scheduler;
  const [deviceName, setDeviceName] = useState(null);
  const [bpm, setBpm] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const dotRef = useRef(null);

  useFrame(() => {
    const s = readFollower(scheduler());
    setDeviceName(s.deviceName);
    setBpm(Math.round(s.bpm * 10) / 10);
    setIsRunning(s.isRunning);
    if (dotRef.current) {
      dotRef.current.style.opacity = s.isRunning && !isCSSAnimationDisabled && s.beat % 2 === 1 ? 0.4 : 1;
    }
  }, !!midiClockInput);

  const onChange = (value) => {
    settingsMap.setKey('midiClockInput', value);
    if (value) {
      context.editorRef?.current?.evaluate(false);
    }
  };

  const recue = () => {
    const follower = scheduler().clockSource;
    follower.recue(getAudioContext().currentTime);
    scheduler().wake?.();
  };

  const status = !midiClockInput ? 'off' : !deviceName ? 'waiting for device' : isRunning ? 'running' : 'stopped';

  return (
    <ChipPopover {...chipFor(midiClockInput, { deviceName, bpm, isRunning })} dotRef={dotRef} title="MIDI clock">
      <PopoverRow label="clock input">
        <MidiInputSelect value={midiClockInput} noneLabel="no clock" onChange={onChange} />
      </PopoverRow>
      <PopoverRow label="status">
        <span>{status}</span>
      </PopoverRow>
      <PopoverAction disabled={!isRunning} onClick={recue} title="Re-cue the downbeat to now">
        re-cue downbeat
      </PopoverAction>
    </ChipPopover>
  );
}
