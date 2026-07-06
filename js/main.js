// Terminal Quest — app shell: routing, home/world screens, HUD, win modal.

import { loadSave, markComplete, setLastLevel, resetSave } from './state.js';
import { VIM_LEVELS } from './levels/vim-levels.js';
import { SHELL_LEVELS } from './levels/shell-levels.js';
import { TMUX_LEVELS } from './levels/tmux-levels.js';
import { VimRunner, ShellRunner, TmuxRunner } from './runners.js';

const WORLDS = [
  {
    id: 'vim',
    name: 'The Vim Dojo',
    icon: '⌨️',
    tagline: 'Modal editing from hjkl to :%s — earn your motions.',
    levels: VIM_LEVELS,
    Runner: VimRunner,
  },
  {
    id: 'shell',
    name: 'Fleet Ops',
    icon: '🛰️',
    tagline: 'The terminal commands that keep a fleet of agents alive.',
    levels: SHELL_LEVELS,
    Runner: ShellRunner,
  },
  {
    id: 'tmux',
    name: 'The Multiplexer',
    icon: '🪟',
    tagline: 'tmux: panes, windows, sessions — one terminal, infinite terminals.',
    levels: TMUX_LEVELS,
    Runner: TmuxRunner,
  },
];

const app = document.getElementById('app');
const save = loadSave();
let runner = null;
let modal = null;
let hintIdx = -1;
let current = null; // {world, idx, level}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function worldById(id) {
  return WORLDS.find((w) => w.id === id);
}

function worldProgress(world) {
  return world.levels.filter((l) => save.completed[l.id]).length;
}

// --- routing -----------------------------------------------------------------

function route() {
  const hash = location.hash.slice(1);
  runner = null;
  modal = null;
  hintIdx = -1;
  current = null;
  if (hash.startsWith('world/')) return renderWorld(hash.split('/')[1]);
  if (hash.startsWith('play/')) {
    const [, wid, idxStr] = hash.split('/');
    return renderPlay(wid, parseInt(idxStr, 10));
  }
  renderHome();
}

window.addEventListener('hashchange', route);

// --- screens -----------------------------------------------------------------

function renderHome() {
  const total = WORLDS.reduce((n, w) => n + w.levels.length, 0);
  const done = WORLDS.reduce((n, w) => n + worldProgress(w), 0);
  const continueBtn = save.lastLevel
    ? `<button class="btn primary" id="btn-continue">▶ Continue where you left off</button>`
    : '';

  app.innerHTML = `
    <div class="home">
      <div class="hero">
        <div class="hero-title">TERMINAL&nbsp;QUEST</div>
        <div class="hero-sub">vim · tmux · shell — learn the terminal by playing it.</div>
        <div class="hero-progress">${done}/${total} levels cleared</div>
        ${continueBtn}
      </div>
      <div class="worlds">
        ${WORLDS.map((w) => {
          const p = worldProgress(w);
          const pct = Math.round((p / w.levels.length) * 100);
          return `
          <div class="world-card" data-world="${w.id}">
            <div class="world-icon">${w.icon}</div>
            <div class="world-name">${esc(w.name)}</div>
            <div class="world-tag">${esc(w.tagline)}</div>
            <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
            <div class="world-count">${p}/${w.levels.length}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="home-foot">
        progress saves automatically in your browser ·
        <a href="#" id="reset-save">reset all progress</a>
      </div>
    </div>`;

  for (const card of app.querySelectorAll('.world-card')) {
    card.addEventListener('click', () => (location.hash = `world/${card.dataset.world}`));
  }
  const cont = document.getElementById('btn-continue');
  if (cont) {
    cont.addEventListener('click', () => {
      const [wid, lid] = save.lastLevel.split('/');
      const world = worldById(wid);
      const idx = world ? world.levels.findIndex((l) => l.id === save.lastLevel) : -1;
      location.hash = idx >= 0 ? `play/${wid}/${idx}` : '';
    });
  }
  document.getElementById('reset-save').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('Wipe all Terminal Quest progress?')) {
      resetSave();
      location.reload();
    }
  });
}

function renderWorld(wid) {
  const world = worldById(wid);
  if (!world) { location.hash = ''; return; }
  app.innerHTML = `
    <div class="world-screen">
      <div class="topbar">
        <button class="btn" id="btn-home">← Home</button>
        <div class="topbar-title">${world.icon} ${esc(world.name)}</div>
        <div class="topbar-right">${worldProgress(world)}/${world.levels.length}</div>
      </div>
      <div class="level-grid">
        ${world.levels.map((l, i) => {
          const done = save.completed[l.id];
          const teach = Array.isArray(l.teach) ? l.teach.join(' · ') : '';
          return `
          <div class="level-card ${done ? 'done' : ''}" data-idx="${i}">
            <div class="level-num">${done ? '✔' : i + 1}</div>
            <div class="level-name">${esc(l.title)}</div>
            <div class="level-teach">${esc(teach)}</div>
            ${done && l.par ? `<div class="level-best">best: ${done.best} keys (par ${l.par})</div>` : ''}
            ${done && !l.par ? `<div class="level-best">cleared</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  document.getElementById('btn-home').addEventListener('click', () => (location.hash = ''));
  for (const card of app.querySelectorAll('.level-card')) {
    card.addEventListener('click', () => (location.hash = `play/${wid}/${card.dataset.idx}`));
  }
}

function renderPlay(wid, idx) {
  const world = worldById(wid);
  if (!world || !world.levels[idx]) { location.hash = ''; return; }
  const level = world.levels[idx];
  current = { world, idx, level };
  setLastLevel(save, level.id);

  const teach = Array.isArray(level.teach) ? level.teach : [];
  app.innerHTML = `
    <div class="play">
      <div class="hud">
        <div class="hud-top">
          <button class="btn" id="btn-back">← ${esc(world.name)}</button>
        </div>
        <div class="hud-level">Level ${idx + 1}/${world.levels.length}</div>
        <h1 class="hud-title">${esc(level.title)}</h1>
        <div class="hud-keys">${teach.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</div>
        <p class="hud-brief">${esc(level.brief)}</p>
        <div class="hud-objectives" id="objectives"></div>
        <div class="hud-stats" id="stats"></div>
        <div class="hud-hint">
          <button class="btn" id="btn-hint">💡 Hint</button>
          <div class="hint-text" id="hint-text"></div>
        </div>
        <div class="hud-actions">
          <button class="btn" id="btn-reset">↻ Restart level</button>
        </div>
      </div>
      <div class="game" id="game" tabindex="0"></div>
    </div>`;

  document.getElementById('btn-back').addEventListener('click', () => (location.hash = `world/${wid}`));
  document.getElementById('btn-reset').addEventListener('click', () => {
    route();
  });
  document.getElementById('btn-hint').addEventListener('click', () => {
    const hints = level.hints || [];
    if (!hints.length) return;
    hintIdx = (hintIdx + 1) % hints.length;
    document.getElementById('hint-text').textContent = `(${hintIdx + 1}/${hints.length}) ${hints[hintIdx]}`;
  });

  const gameEl = document.getElementById('game');
  runner = new world.Runner(gameEl, level, {
    onChange: renderHud,
    onWin: (stats) => onWin(stats),
  });
  renderHud();
  gameEl.focus();
}

function renderHud() {
  if (!runner || !current) return;
  const objEl = document.getElementById('objectives');
  if (objEl) {
    objEl.innerHTML = runner
      .getObjectives()
      .map((o) => `<div class="obj ${o.done ? 'done' : ''}"><span class="obj-mark">${o.done ? '●' : '○'}</span> ${esc(o.text)}</div>`)
      .join('');
  }
  const statsEl = document.getElementById('stats');
  if (statsEl) {
    if (current.level.par) {
      statsEl.innerHTML = `keystrokes: <b>${runner.keystrokes}</b> · par: <b>${current.level.par}</b>`;
    } else {
      statsEl.innerHTML = `keystrokes: <b>${runner.keystrokes}</b>`;
    }
  }
}

function onWin(stats) {
  const { world, idx, level } = current;
  markComplete(save, level.id, stats.keystrokes);
  const isLast = idx === world.levels.length - 1;
  const nextHash = isLast ? `world/${world.id}` : `play/${world.id}/${idx + 1}`;
  const parLine = level.par
    ? stats.keystrokes <= level.par
      ? `<div class="modal-par star">⭐ ${stats.keystrokes} keystrokes — under par (${level.par})!</div>`
      : `<div class="modal-par">${stats.keystrokes} keystrokes · par ${level.par} — replay to beat it</div>`
    : `<div class="modal-par">${stats.keystrokes} keystrokes</div>`;

  const el = document.createElement('div');
  el.className = 'modal-overlay';
  el.innerHTML = `
    <div class="modal">
      <div class="modal-title">LEVEL COMPLETE</div>
      <div class="modal-level">${esc(level.title)}</div>
      ${parLine}
      <div class="modal-actions">
        <button class="btn primary" id="m-next">${isLast ? 'Back to world ⏎' : 'Next level ⏎'}</button>
        <button class="btn" id="m-replay">Replay</button>
        <button class="btn" id="m-home">Home</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  modal = { el, nextHash };
  el.querySelector('#m-next').addEventListener('click', () => closeModal(nextHash));
  el.querySelector('#m-replay').addEventListener('click', () => closeModal(`play/${world.id}/${idx}`));
  el.querySelector('#m-home').addEventListener('click', () => closeModal(''));
  renderHud();
}

function closeModal(hash) {
  if (modal) { modal.el.remove(); modal = null; }
  if (location.hash.slice(1) === hash) route(); // same route (e.g. replay): re-run manually
  else location.hash = hash;
}

// --- global input ------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (modal) {
    if (e.key === 'Enter') {
      e.preventDefault();
      closeModal(modal.nextHash);
    }
    return;
  }
  if (!runner) return;
  // never intercept browser-level shortcuts (Cmd on mac, e.g. Cmd-R reload)
  if (e.metaKey) return;
  const handled = runner.handleKey(e);
  if (handled) e.preventDefault();
});

setInterval(() => {
  if (runner && runner.tick) runner.tick();
}, 250);

route();
