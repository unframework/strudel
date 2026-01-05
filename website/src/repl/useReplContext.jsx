/*
Repl.jsx - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/repl/src/App.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { code2hash, getPerformanceTimeSeconds, logger, silence, repl } from '@strudel/core';
import { getDrawContext } from '@strudel/draw';
import { evaluate, transpiler } from '@strudel/transpiler';
import {
  getAudioContextCurrentTime,
  renderPatternAudio,
  webaudioOutput,
  resetGlobalEffects,
  resetLoadedSounds,
  initAudioOnFirstClick,
  resetDefaults,
  initAudio,
} from '@strudel/webaudio';
import { setVersionDefaultsFrom } from './util.mjs';
import { StrudelMirror, defaultSettings } from '@strudel/codemirror';
import { clearHydra } from '@strudel/hydra';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { parseBoolean, settingsMap, useSettings } from '../settings.mjs';
import {
  setLatestCode,
  createPatternID,
  userPattern,
  getViewingPatternData,
  setViewingPatternData,
  savePatternCode,
  initializeViewingPattern,
} from '../user_pattern_utils.mjs';
import { superdirtOutput } from '@strudel/osc/superdirtoutput';
import { audioEngineTargets } from '../settings.mjs';
import { useStore } from '@nanostores/react';
import { prebake } from './prebake.mjs';
import { getRandomTune, getCodeFromURL, loadModules, shareCode } from './util.mjs';
import './Repl.css';
import { setInterval, clearInterval } from 'worker-timers';
import { getMetadata } from '../metadata_parser';
import { debugAudiograph } from './audiograph';

const { latestCode, maxPolyphony, audioDeviceName, multiChannelOrbits } = settingsMap.get();
let modulesLoading, presets, drawContext, clearCanvas, audioReady;

if (typeof window !== 'undefined') {
  audioReady = initAudioOnFirstClick({
    maxPolyphony,
    audioDeviceName,
    multiChannelOrbits: parseBoolean(multiChannelOrbits),
  });
  modulesLoading = loadModules();
  presets = prebake();
  drawContext = getDrawContext();
  clearCanvas = () => drawContext.clearRect(0, 0, drawContext.canvas.height, drawContext.canvas.width);
}

async function getModule(name) {
  if (!modulesLoading) {
    return;
  }
  const modules = await modulesLoading;
  return modules.find((m) => m.packageName === name);
}

const initialCode = `// LOADING`;

// helper function to generate repl ids
function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

function useReplInstance() {
  const { isSyncEnabled, audioEngineTarget, prebakeScript, includePrebakeScriptInShare } = useSettings();
  const shouldUseWebaudio = audioEngineTarget !== audioEngineTargets.osc;
  const defaultOutput = shouldUseWebaudio ? webaudioOutput : superdirtOutput;
  const getTime = shouldUseWebaudio ? getAudioContextCurrentTime : getPerformanceTimeSeconds;
  const [activePattern, setActivePattern] = useState(null);

  const init = useCallback(() => {
    const drawTime = [-2, 2];
    const drawContext = getDrawContext();

    const id = s4();

    /**
     * @type {StrudelMirror}
     */
    let editor;

    const replInstance = repl({
      id,
      sync: isSyncEnabled,
      defaultOutput,
      getTime,
      setInterval,
      clearInterval,
      transpiler,

      onUpdateState: (state) => {
        // orig useReplContext onUpdateState
        setReplState({ ...state });
      },

      onToggle: (started) => {
        // orig useReplContext onToggle
        if (!started) {
          clearHydra();
        }

        // StrudelMirror onToggle
        if (started) {
          editor.onReplStart();
        } else {
          editor.onReplStop();
        }
      },
      beforeEval: async () => {
        // StrudelMirror beforeEval
        await editor.beforeEval();

        // orig useReplContext beforeEval
        await audioReady;
      },
      afterEval: ({ meta, pattern }) => {
        // StrudelMirror afterEval
        editor.afterEval(pattern, meta);

        // orig useReplContext afterEval
        {
          const { code } = all;
          //post to iframe parent (like Udels) if it exists...
          window.parent?.postMessage(code);

          setLatestCode(code);
          window.location.hash = '#' + code2hash(code);
          setDocumentTitle(code);
          setVersionDefaultsFrom(code);

          const patternId = savePatternCode(code);
          setActivePattern(patternId);
        }
      },
    });

    editor = new StrudelMirror({
      replInstance,
      autodraw: false,
      root: containerRef.current,
      initialCode,
      pattern: silence,
      drawTime,
      drawContext,
      prebake: async () =>
        Promise.all([modulesLoading, presets]).then(() => {
          if (prebakeScript?.length) {
            return evaluate(prebakeScript ?? '');
          }
        }),

      bgFill: false,
    });
    window.strudelMirror = editor;
    window.debugAudiograph = debugAudiograph;

    editorRef.current = editor;

    // init settings
    (async () => {
      const codeFromURL = await getCodeFromURL();
      let code, msg;
      if (codeFromURL) {
        code = codeFromURL;
        msg = `I have loaded the code from the URL.`;
      } else if (latestCode) {
        code = latestCode;
        msg = `Your last session has been loaded!`;
      } else {
        /* const { code: randomTune, name } = await getRandomTune();
        code = randomTune; */
        code = '$: s("[bd <hh oh>]*2").bank("tr909").dec(.4)';
        msg = `Default code has been loaded`;
      }
      editor.setCode(code);
      setDocumentTitle(code);
      initializeViewingPattern(code);
      logger(`Welcome to Strudel! ${msg} Press play or hit ctrl+enter to run it!`, 'highlight');
    })();
  }, []);

  const [replState, setReplState] = useState({});
  const { started, isDirty, error, activeCode, pending } = replState;
  const editorRef = useRef();
  const containerRef = useRef();

  // this can be simplified once SettingsTab has been refactored to change codemirrorSettings directly!
  // this will be the case when the main repl is being replaced
  const _settings = useStore(settingsMap, { keys: Object.keys(defaultSettings) });
  useEffect(() => {
    let editorSettings = {};
    Object.keys(defaultSettings).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(_settings, key)) {
        editorSettings[key] = _settings[key];
      }
    });
    editorRef.current?.updateSettings(editorSettings);
  }, [_settings]);

  //
  // UI Actions
  //

  const setDocumentTitle = (code) => {
    const meta = getMetadata(code);
    document.title = (meta.title ? `${meta.title} - ` : '') + 'Strudel REPL';
  };

  const handleTogglePlay = async () => {
    editorRef.current?.toggle();
  };

  const resetEditor = async () => {
    (await getModule('@strudel/tonal'))?.resetVoicings();
    resetDefaults();
    resetGlobalEffects();
    clearCanvas();
    clearHydra();
    resetLoadedSounds();
    editorRef.current.repl.setCps(0.5);
    await prebake(); // declare default samples
  };

  const handleUpdate = async (patternData, reset = false) => {
    setViewingPatternData(patternData);
    editorRef.current.setCode(patternData.code);
    if (reset) {
      await resetEditor();
      handleEvaluate();
    }
  };

  const handleEvaluate = () => {
    editorRef.current.evaluate();
  };

  const handleExport = async (begin, end, sampleRate, maxPolyphony, multiChannelOrbits, downloadName = undefined) => {
    await editorRef.current.evaluate(false);
    editorRef.current.repl.scheduler.stop();
    await renderPatternAudio(
      editorRef.current.repl.state.pattern,
      editorRef.current.repl.scheduler.cps,
      begin,
      end,
      sampleRate,
      maxPolyphony,
      multiChannelOrbits,
      downloadName,
    ).finally(async () => {
      const { latestCode, maxPolyphony, audioDeviceName, multiChannelOrbits } = settingsMap.get();
      await initAudio({
        latestCode,
        maxPolyphony,
        audioDeviceName,
        multiChannelOrbits,
      });
      editorRef.current.repl.scheduler.stop();
    });
  };
  const handleShuffle = async () => {
    const patternData = await getRandomTune();
    const code = patternData.code;
    logger(`[repl] ✨ loading random tune "${patternData.id}"`);
    setViewingPatternData(patternData);
    await resetEditor();
    editorRef.current.setCode(code);
    editorRef.current.repl.evaluate(code);
  };

  const handleShare = async () => {
    let code = replState.code;
    if (includePrebakeScriptInShare) {
      code = prebakeScript + '\n' + code;
    }
    shareCode(code);
  };
  const context = {
    started,
    pending,
    isDirty,
    activeCode,
    activePattern,
    handleTogglePlay,
    handleUpdate,
    handleShuffle,
    handleShare,
    handleEvaluate,
    handleExport,
    init,
    error,
    editorRef,
    containerRef,
  };
  return context;
}

const ReplContext = createContext(null);

export function ReplProvider({ children }) {
  const context = useReplInstance();
  return <ReplContext.Provider value={context}>{children}</ReplContext.Provider>;
}

export function useReplState() {
  const context = useContext(ReplContext);
  if (!context) {
    throw new Error('useReplState must be used within a ReplProvider');
  }
  return context;
}
