// Level runners: one per world type. A runner owns the game area DOM,
// routes keystrokes to its engine, evaluates objectives, and reports wins.

import { Vim } from './engine/vim.js';
import { VFS } from './engine/vfs.js';
import { Kernel, Shell } from './engine/shell.js';
import { TermUI } from './engine/terminal.js';
import { Tmux } from './engine/tmux.js';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- VIM ---------------------------------------------------------------------

export class VimRunner {
  constructor(el, level, hooks) {
    this.el = el;
    this.level = level;
    this.hooks = hooks;
    this.keystrokes = 0;
    this.won = false;
    this.flash = '';
    this.vim = new Vim({
      lines: level.lines,
      cursor: level.cursor || [0, 0],
      undoHistory: level.history || null,
    });
    this.allowed = new Set(level.keys || []);
    this.gems = (level.gems || []).map(([r, c]) => ({ r, c, got: false }));
    this.flags = new Set(); // engine events seen (mark-set, mark-jump, ...)
    this.collectAt();
    this.render();
  }

  collectAt() {
    for (const g of this.gems) {
      if (!g.got && g.r === this.vim.r && g.c === this.vim.c) g.got = true;
    }
  }

  handleKey(e) {
    if (this.won) return false;
    const k = e.key;
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return false;

    if (k.startsWith('Arrow')) {
      this.flash = 'Real vim hands don’t leave home row — use h j k l 😤';
      this.render();
      return true;
    }

    const vm = this.vim;
    const gated = (vm.mode === 'normal' || vm.mode === 'visual' || vm.mode === 'vline') && !vm.pending;
    if (gated && !e.ctrlKey && k.length === 1 && k !== ' ' && !this.allowed.has(k) && k !== 'Escape') {
      this.flash = `“${k}” isn’t unlocked in this level yet`;
      this.render();
      return true;
    }

    this.flash = '';
    const handled = vm.key(k, { ctrl: e.ctrlKey });
    if (!handled) return false;
    this.keystrokes++;
    if (vm.lastEvent) this.flags.add(vm.lastEvent);
    this.collectAt();
    this.render();
    this.checkWin();
    if (this.hooks.onChange) this.hooks.onChange();
    return true;
  }

  baseDone() {
    if (this.level.type === 'collect') return this.gems.every((g) => g.got);
    const t = this.level.target;
    return this.vim.lines.length === t.length && this.vim.lines.every((l, i) => l === t[i]);
  }

  done() {
    return this.baseDone() && (this.level.require || []).every((r) => r.check(this.vim, this));
  }

  checkWin() {
    if (!this.won && this.done()) {
      this.won = true;
      this.hooks.onWin({ keystrokes: this.keystrokes, par: this.level.par });
    }
  }

  getObjectives() {
    let base;
    if (this.level.type === 'collect') {
      const got = this.gems.filter((g) => g.got).length;
      base = [{ text: `Collect the gems — ${got}/${this.gems.length}`, done: got === this.gems.length }];
    } else {
      base = [{ text: 'Make the buffer match the target', done: this.baseDone() }];
    }
    const extra = (this.level.require || []).map((r) => ({ text: r.text, done: !!r.check(this.vim, this) }));
    return [...base, ...extra];
  }

  render() {
    const vm = this.vim;
    const sel = vm.selection();
    const gemMap = new Map();
    for (const g of this.gems) gemMap.set(`${g.r}:${g.c}`, g);

    const rows = vm.lines.map((line, r) => {
      const cells = [];
      for (let c = 0; c <= line.length; c++) {
        const ch = line[c];
        const key = `${r}:${c}`;
        let cls = 'vch';
        const gem = gemMap.get(key);
        if (gem) cls += gem.got ? ' gem-got' : ' gem';
        if (sel && sel.has(key)) cls += ' sel';
        if (r === vm.r && c === vm.c) cls += vm.mode === 'insert' ? ' cur ins' : ' cur';
        if (ch === undefined) {
          // virtual end-of-line cell (cursor can sit here in insert mode)
          cells.push(`<span class="${cls} eol">&nbsp;</span>`);
        } else {
          cells.push(`<span class="${cls}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`);
        }
      }
      return `<div class="vim-line"><span class="vgut">${String(r + 1).padStart(3)}</span>${cells.join('')}</div>`;
    });

    const st = vm.statusline();
    let statusHtml;
    if (typeof st === 'string') {
      statusHtml = `<span class="vst-mini">${esc(st)}</span><span class="tcursor">&nbsp;</span>`;
    } else {
      statusHtml =
        `<span class="vst-mode">${esc(st.mode)}</span>` +
        `<span class="vst-msg">${esc(this.flash || st.message || '')}</span>` +
        `<span class="vst-right">${esc(st.pending)} · ${esc(st.pos)}</span>`;
    }

    let targetHtml = '';
    if (this.level.type === 'transform') {
      const t = this.level.target;
      const rowsT = t.map((line, i) => {
        const ok = vm.lines[i] === line && (i < t.length - 1 || vm.lines.length === t.length);
        return `<div class="vt-line ${ok ? 'ok' : 'no'}"><span class="vgut">${String(i + 1).padStart(3)}</span>${esc(line) || '&nbsp;'}</div>`;
      });
      const extra = vm.lines.length > t.length
        ? `<div class="vt-extra">buffer has ${vm.lines.length - t.length} extra line(s)</div>`
        : '';
      targetHtml = `<div class="vim-target"><div class="vt-title">TARGET</div>${rowsT.join('')}${extra}</div>`;
    }

    this.el.innerHTML =
      `<div class="vim-wrap">` +
      `<div class="vim-panel"><div class="vim-lines">${rows.join('')}</div>` +
      `<div class="vim-status">${statusHtml}</div></div>` +
      targetHtml +
      `</div>`;
  }

  tick() {}
  destroy() {}
}

// --- SHELL -------------------------------------------------------------------

class ObjectiveTracker {
  constructor(level, ctx) {
    this.level = level;
    this.ctx = ctx;
    this.done = level.objectives.map(() => false);
  }

  update() {
    let changed = false;
    this.level.objectives.forEach((o, i) => {
      if (this.done[i]) return;
      let ok = false;
      try {
        ok = !!o.check(this.ctx);
      } catch { /* level check crashed — treat as not done */ }
      if (ok) { this.done[i] = true; changed = true; }
    });
    return changed;
  }

  all() { return this.done.every(Boolean); }

  list() {
    return this.level.objectives.map((o, i) => ({ text: o.text, done: this.done[i] }));
  }
}

export class ShellRunner {
  constructor(el, level, hooks) {
    this.el = el;
    this.level = level;
    this.hooks = hooks;
    this.keystrokes = 0;
    this.won = false;

    this.vfs = new VFS();
    this.k = new Kernel(this.vfs);
    this.sh = new Shell(this.k);
    level.setup.call(level, this.k, this.sh);
    this.sh.cwd = this.k.env.HOME;

    this.ctx = {
      k: this.k,
      sh: this.sh,
      vfs: this.vfs,
      events: this.k.events,
      level,
      tmux: null,
      has: (type, pred) => this.k.events.some((e) => e.type === type && (!pred || pred(e))),
      tmuxAttachedAt: () => false,
    };
    this.tracker = new ObjectiveTracker(level, this.ctx);

    el.innerHTML = '';
    const termEl = document.createElement('div');
    termEl.className = 'shell-term';
    el.appendChild(termEl);
    this.term = new TermUI(termEl, this.sh, this.k, {
      banner: ['Fleet Ops terminal — type `help` for the toolbox, `man <cmd>` for details.', ''],
      onCommand: () => this.refresh(),
    });
    this.refresh();
  }

  handleKey(e) {
    if (this.won && e.key === 'Enter') return false;
    const handled = this.term.key(e);
    if (handled) {
      this.keystrokes++;
      this.refresh();
    }
    return handled;
  }

  refresh() {
    const changed = this.tracker.update();
    if (changed && this.hooks.onChange) this.hooks.onChange();
    if (!this.won && this.tracker.all()) {
      this.won = true;
      this.hooks.onWin({ keystrokes: this.keystrokes });
    }
  }

  getObjectives() { return this.tracker.list(); }

  tick() {
    this.k.tick();
    this.term.pump();
    this.refresh();
  }

  destroy() {}
}

// --- TMUX --------------------------------------------------------------------

export class TmuxRunner {
  constructor(el, level, hooks) {
    this.el = el;
    this.level = level;
    this.hooks = hooks;
    this.keystrokes = 0;
    this.won = false;

    this.vfs = new VFS();
    this.k = new Kernel(this.vfs);
    this.sh = new Shell(this.k);

    el.innerHTML = '';
    this.baseEl = document.createElement('div');
    this.baseEl.className = 'shell-term';
    this.tmuxEl = document.createElement('div');
    this.tmuxEl.className = 'tmux-host';
    el.appendChild(this.baseEl);
    el.appendChild(this.tmuxEl);

    this.tmux = new Tmux(this.k, {
      onDetach: (name) => {
        this.showBase();
        this.term.print(`[detached (from session ${name})]`);
        this.term.render();
      },
    });

    this.sh.onEvent = (ev) => {
      if (ev.type !== 'tmux') return null;
      const res = this.tmux.command(ev.args);
      if (res.tmuxAttached) this.showTmux();
      return { out: res.out, code: res.code };
    };

    level.setup.call(level, this.k, this.sh, this.tmux);
    this.sh.cwd = this.k.env.HOME;

    this.ctx = {
      k: this.k,
      sh: this.sh,
      vfs: this.vfs,
      events: this.k.events,
      level,
      tmux: this.tmux,
      has: (type, pred) => this.k.events.some((e) => e.type === type && (!pred || pred(e))),
      tmuxAttachedAt: (e) => e.shell !== this.sh,
    };
    this.tracker = new ObjectiveTracker(level, this.ctx);

    this.term = new TermUI(this.baseEl, this.sh, this.k, {
      banner: [
        'Multiplexer training grounds. `tmux` starts a session; the prefix is Ctrl-b.',
        'Press C-b ? inside tmux for a cheat sheet.',
        '',
      ],
      onCommand: () => this.refresh(),
    });

    if (this.tmux.attached) this.showTmux();
    else this.showBase();

    if (level.postMount) level.postMount.call(level, this.ctx);
    this.refresh();
  }

  showTmux() {
    this.baseEl.style.display = 'none';
    this.tmuxEl.style.display = 'flex';
    this.tmux.render(this.tmuxEl);
  }

  showBase() {
    this.tmuxEl.style.display = 'none';
    this.baseEl.style.display = 'block';
  }

  handleKey(e) {
    let handled;
    if (this.tmux.attached) {
      handled = this.tmux.key(e);
      if (this.tmux.attached) this.tmux.render(this.tmuxEl);
    } else {
      handled = this.term.key(e);
    }
    if (handled) {
      this.keystrokes++;
      this.refresh();
    }
    return handled;
  }

  refresh() {
    const changed = this.tracker.update();
    if (changed && this.hooks.onChange) this.hooks.onChange();
    if (!this.won && this.tracker.all()) {
      this.won = true;
      this.hooks.onWin({ keystrokes: this.keystrokes });
    }
  }

  getObjectives() { return this.tracker.list(); }

  tick() {
    this.k.tick();
    if (this.tmux.attached) {
      if (this.tmux.pump()) { /* pane terminals re-render themselves */ }
    } else {
      this.term.pump();
    }
    this.refresh();
  }

  destroy() {}
}
