import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType } from '@codemirror/view';
import { CUE_ID_SOURCE, cuePhase, cueRun, getIsStarted, getTime, logger } from '@strudel/core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const BLINK_CYCLES = 1 / 4;

function waitingOpacity(cycle) {
  return (cycle / BLINK_CYCLES) % 1 < 0.5 ? 0.6 : 0.3;
}

function svgElement(name, attributes) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function renderPhase(arc, check, phase, cycle) {
  const settled = phase.kind === 'settled';
  arc.setAttribute('stroke-dasharray', `${settled ? CIRCUMFERENCE : phase.progress * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
  arc.style.opacity = phase.kind === 'waiting' ? waitingOpacity(cycle) : { easing: 1, settled: 0.3 }[phase.kind];
  // Both arcs start at 12 o'clock, the wait filling clockwise and the ease counterclockwise
  arc.setAttribute('transform', phase.kind === 'easing' ? 'rotate(-90) scale(1 -1)' : 'rotate(-90)');
  check.style.display = settled ? '' : 'none';
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
    // Tailwind preflight makes svg display: block, which would wrap the widget onto its own visual line
    svg.style.display = 'inline-block';
    svg.style.verticalAlign = '-0.1em';
    const arc = svgElement('circle', {
      r: RADIUS,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
    });
    svg.appendChild(svgElement('circle', { r: RADIUS, fill: 'none', stroke: 'currentColor', opacity: 0.15 }));
    const check = svgElement('path', {
      d: 'M -2.5 0 L -0.8 1.8 L 2.6 -1.8',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    svg.appendChild(arc);
    svg.appendChild(check);

    let wasConnected = false;
    const tick = () => {
      wasConnected ||= svg.isConnected;
      const cycle = getIsStarted() ? getTime() : null;
      const phase = cycle === null ? { kind: 'settled' } : cuePhase(cueRun.get(this.id), cycle);
      renderPhase(arc, check, phase, cycle);
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
  const mints = (meta?.cueMints ?? []).filter((mint) => cueRun.isClaimed(mint.id));
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
