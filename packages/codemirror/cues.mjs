import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType } from '@codemirror/view';
import { CUE_ID_SOURCE, cuePhase, cueRun, getIsStarted, getTime, logger } from '@strudel/core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function currentPhase(id) {
  const cue = cueRun.get(id);
  return getIsStarted() ? cuePhase(cue, getTime()) : { kind: 'settled' };
}

function svgElement(name, attributes) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function renderArc(arc, phase) {
  const filled = phase.kind === 'settled' ? 1 : phase.progress;
  arc.setAttribute('stroke-dasharray', `${filled * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
  arc.style.opacity = { waiting: 1, easing: 0.7, settled: 0.3 }[phase.kind];
}

class CueWidget extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }

  eq(other) {
    return other.id === this.id;
  }

  toDOM() {
    const size = 2 * RADIUS + 2;
    const svg = svgElement('svg', {
      class: 'cm-cue',
      width: '0.9em',
      height: '0.9em',
      viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`,
      'aria-label': `cue ${this.id}`,
    });
    svg.style.verticalAlign = '-0.1em';
    const arc = svgElement('circle', {
      r: RADIUS,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      transform: 'rotate(-90)',
    });
    svg.appendChild(svgElement('circle', { r: RADIUS, fill: 'none', stroke: 'currentColor', opacity: 0.15 }));
    svg.appendChild(arc);

    let wasConnected = false;
    const tick = () => {
      wasConnected ||= svg.isConnected;
      const phase = currentPhase(this.id);
      renderArc(arc, phase);
      if (phase.kind !== 'settled' && !(wasConnected && !svg.isConnected)) {
        requestAnimationFrame(tick);
      }
    };
    tick();
    return svg;
  }
}

const idMatcher = new MatchDecorator({
  regexp: new RegExp(`'(${CUE_ID_SOURCE})'`, 'g'),
  decoration: (match) => Decoration.replace({ widget: new CueWidget(match[1]) }),
});

export const cuePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = idMatcher.createDeco(view);
    }

    update(update) {
      this.decorations = idMatcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

export function insertCueIds(view, { code, meta, range }) {
  const mints = meta?.cueMints ?? [];
  if (!mints.length) {
    return;
  }
  const doc = view.state.doc;
  const evaluated = range ? doc.sliceString(range[0], range[1]) : doc.toString();
  if (evaluated !== code) {
    logger('[cue] code changed during evaluation, cues will be minted again on the next one', 'warning');
    return;
  }
  view.dispatch({ changes: mints.map(({ at, insert }) => ({ from: at, insert })) });
}
