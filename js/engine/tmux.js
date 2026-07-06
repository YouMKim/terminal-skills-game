// Tmux simulator: sessions -> windows -> a binary split tree of panes.
// Each pane hosts its own Shell + TermUI sharing one Kernel.

import { Shell } from './shell.js';
import { TermUI } from './terminal.js';

let paneSeq = 1;

export class Tmux {
  constructor(kernel, { onDetach, onEvent } = {}) {
    this.k = kernel;
    this.sessions = []; // {name, windows:[{name, root, activePane, zoomed}], activeWin}
    this.attached = null; // session object
    this.prefix = false;
    this.overlay = null; // {kind:'rename', buf} | {kind:'winlist', idx}
    this.copyPane = null; // pane in copy-mode
    this.onDetach = onDetach || (() => {});
    this.onEvent = onEvent || (() => {});
    this.el = null;
  }

  // --- shell-facing API (`tmux ...` typed in a terminal) ---------------------

  command(args) {
    const sub = args[0];
    if (!sub || sub === 'new' || sub === 'new-session') {
      let name = String(this.sessions.length);
      const i = args.indexOf('-s');
      if (i !== -1 && args[i + 1]) name = args[i + 1];
      if (this.findSession(name)) return { out: `duplicate session: ${name}`, code: 1 };
      const session = this.createSession(name);
      this.attach(session);
      return { out: '', code: 0, tmuxAttached: true };
    }
    if (sub === 'ls' || sub === 'list-sessions') {
      this.k.emit({ type: 'tmux-ls' });
      if (!this.sessions.length) return { out: 'no server running on /tmp/tmux-501/default', code: 1 };
      const rows = this.sessions.map(
        (s) => `${s.name}: ${s.windows.length} windows (created recently)${s === this.attached ? ' (attached)' : ''}`
      );
      return { out: rows.join('\n'), code: 0 };
    }
    if (sub === 'attach' || sub === 'attach-session' || sub === 'a') {
      let target = this.sessions[this.sessions.length - 1];
      const i = args.indexOf('-t');
      if (i !== -1 && args[i + 1]) target = this.findSession(args[i + 1]);
      if (!target) return { out: `can't find session`, code: 1 };
      this.attach(target);
      return { out: '', code: 0, tmuxAttached: true };
    }
    if (sub === 'kill-session') {
      const i = args.indexOf('-t');
      const target = i !== -1 ? this.findSession(args[i + 1]) : this.sessions[this.sessions.length - 1];
      if (!target) return { out: `can't find session`, code: 1 };
      this.sessions = this.sessions.filter((s) => s !== target);
      this.k.emit({ type: 'tmux-kill-session', name: target.name });
      return { out: '', code: 0 };
    }
    return { out: `unknown command: ${sub} (try: tmux [new -s name | ls | attach -t name])`, code: 1 };
  }

  findSession(name) {
    return this.sessions.find((s) => s.name === name) || null;
  }

  createSession(name) {
    const pane = this.makePane();
    const session = {
      name,
      windows: [{ name: 'zsh', root: { type: 'leaf', pane }, activePane: pane, zoomed: false }],
      activeWin: 0,
    };
    this.sessions.push(session);
    this.k.emit({ type: 'tmux-new-session', name });
    return session;
  }

  makePane(cwd) {
    const shell = new Shell(this.k, { cwd });
    shell.onEvent = (ev) => (ev.type === 'tmux' ? { out: 'sessions should be nested with care, unset $TMUX to force', code: 1 } : null);
    return { id: paneSeq++, shell, term: null, el: null };
  }

  attach(session) {
    this.attached = session;
    this.k.emit({ type: 'tmux-attach', name: session.name });
  }

  detach() {
    const name = this.attached ? this.attached.name : '?';
    this.attached = null;
    this.prefix = false;
    this.overlay = null;
    this.k.emit({ type: 'tmux-detach', name });
    this.onDetach(name);
  }

  // --- structure helpers ------------------------------------------------------

  win() {
    return this.attached ? this.attached.windows[this.attached.activeWin] : null;
  }

  panes(win = this.win()) {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      if (node.type === 'leaf') out.push(node.pane);
      else { visit(node.a); visit(node.b); }
    };
    if (win) visit(win.root);
    return out;
  }

  allPanes() {
    const out = [];
    for (const s of this.sessions) for (const w of s.windows) out.push(...this.panes(w));
    return out;
  }

  splitActive(dir) {
    const win = this.win();
    if (!win) return;
    const active = win.activePane;
    const replace = (node) => {
      if (node.type === 'leaf') {
        if (node.pane === active) {
          const fresh = this.makePane(active.shell.cwd);
          win.activePane = fresh;
          return { type: 'split', dir, a: { type: 'leaf', pane: active }, b: { type: 'leaf', pane: fresh } };
        }
        return node;
      }
      return { ...node, a: replace(node.a), b: replace(node.b) };
    };
    win.root = replace(win.root);
    win.zoomed = false;
    this.k.emit({ type: 'tmux-split', dir, panes: this.panes(win).length });
  }

  killActive() {
    const win = this.win();
    if (!win) return;
    const active = win.activePane;
    // kill any procs whose shell is this pane's
    for (const p of this.k.procs) {
      if (p.shell === active.shell && (p.status === 'running' || p.status === 'stopped')) {
        p.status = 'killed';
        if (p.prog && p.prog.onKill) p.prog.onKill(p, this.k);
      }
    }
    const remaining = this.panes(win).filter((p) => p !== active);
    this.k.emit({ type: 'tmux-kill-pane', panes: remaining.length });
    if (!remaining.length) {
      // last pane: close the window (and maybe the session)
      this.attached.windows.splice(this.attached.activeWin, 1);
      if (!this.attached.windows.length) {
        this.sessions = this.sessions.filter((s) => s !== this.attached);
        this.detach();
        return;
      }
      this.attached.activeWin = Math.max(0, this.attached.activeWin - 1);
      return;
    }
    const prune = (node) => {
      if (node.type === 'leaf') return node.pane === active ? null : node;
      const a = prune(node.a);
      const b = prune(node.b);
      if (!a) return b;
      if (!b) return a;
      return { ...node, a, b };
    };
    win.root = prune(win.root);
    win.activePane = remaining[remaining.length - 1];
    win.zoomed = false;
  }

  focusDir(dirKey) {
    const win = this.win();
    if (!win || !this.el) return;
    const rects = new Map();
    for (const pane of this.panes(win)) {
      if (pane.el) rects.set(pane, pane.el.getBoundingClientRect());
    }
    const cur = rects.get(win.activePane);
    if (!cur) return;
    let best = null;
    let bestDist = Infinity;
    for (const [pane, r] of rects) {
      if (pane === win.activePane) continue;
      const dx = (r.left + r.right) / 2 - (cur.left + cur.right) / 2;
      const dy = (r.top + r.bottom) / 2 - (cur.top + cur.bottom) / 2;
      const ok =
        (dirKey === 'ArrowLeft' && dx < -1) ||
        (dirKey === 'ArrowRight' && dx > 1) ||
        (dirKey === 'ArrowUp' && dy < -1) ||
        (dirKey === 'ArrowDown' && dy > 1);
      if (!ok) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = pane; }
    }
    if (best) {
      win.activePane = best;
      this.k.emit({ type: 'tmux-focus', paneId: best.id });
    }
  }

  newWindow() {
    const pane = this.makePane();
    this.attached.windows.push({ name: 'zsh', root: { type: 'leaf', pane }, activePane: pane, zoomed: false });
    this.attached.activeWin = this.attached.windows.length - 1;
    this.k.emit({ type: 'tmux-new-window', count: this.attached.windows.length });
  }

  // --- key handling -----------------------------------------------------------

  key(e) {
    if (!this.attached) return false;
    const k = e.key;

    if (this.overlay) return this.overlayKey(e);

    if (this.copyPane) {
      const el = this.copyPane.term.el;
      if (k === 'ArrowUp') { el.scrollTop -= 22; return true; }
      if (k === 'ArrowDown') { el.scrollTop += 22; return true; }
      if (k === 'PageUp') { el.scrollTop -= el.clientHeight; return true; }
      if (k === 'PageDown') { el.scrollTop += el.clientHeight; return true; }
      if (k === 'q' || k === 'Escape' || k === 'Enter') {
        this.copyPane.term.copyMode = false;
        this.copyPane = null;
        this.k.emit({ type: 'tmux-copy-exit' });
        return true;
      }
      return true;
    }

    if (!this.prefix) {
      if (e.ctrlKey && k === 'b') {
        this.prefix = true;
        this.k.emit({ type: 'tmux-prefix' });
        return true;
      }
      // pass to the active pane's terminal
      const win = this.win();
      if (win && win.activePane.term) return win.activePane.term.key(e);
      return false;
    }

    // prefix was armed
    this.prefix = false;
    const win = this.win();
    switch (k) {
      case '%': this.splitActive('h'); return true;
      case '"': this.splitActive('v'); return true;
      case 'o': {
        const list = this.panes(win);
        const idx = list.indexOf(win.activePane);
        win.activePane = list[(idx + 1) % list.length];
        this.k.emit({ type: 'tmux-focus', paneId: win.activePane.id });
        return true;
      }
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
        this.focusDir(k);
        return true;
      case 'x': this.killActive(); return true;
      case 'z':
        win.zoomed = !win.zoomed;
        this.k.emit({ type: 'tmux-zoom', zoomed: win.zoomed });
        return true;
      case 'c': this.newWindow(); return true;
      case 'n':
        this.attached.activeWin = (this.attached.activeWin + 1) % this.attached.windows.length;
        this.k.emit({ type: 'tmux-select-window', idx: this.attached.activeWin });
        return true;
      case 'p':
        this.attached.activeWin = (this.attached.activeWin - 1 + this.attached.windows.length) % this.attached.windows.length;
        this.k.emit({ type: 'tmux-select-window', idx: this.attached.activeWin });
        return true;
      case 'd': this.detach(); return true;
      case ',':
        this.overlay = { kind: 'rename', buf: win.name };
        return true;
      case 'w':
        this.overlay = { kind: 'winlist', idx: this.attached.activeWin };
        return true;
      case '[':
        this.copyPane = win.activePane;
        this.copyPane.term.copyMode = true;
        this.k.emit({ type: 'tmux-copy-enter' });
        return true;
      case '?':
        this.overlay = { kind: 'help' };
        return true;
      default:
        if (/^[0-9]$/.test(k)) {
          const idx = parseInt(k, 10);
          if (idx < this.attached.windows.length) {
            this.attached.activeWin = idx;
            this.k.emit({ type: 'tmux-select-window', idx });
          }
          return true;
        }
        return true; // unknown prefix key: swallow
    }
  }

  overlayKey(e) {
    const k = e.key;
    const ov = this.overlay;
    if (ov.kind === 'rename') {
      if (k === 'Enter') {
        this.win().name = ov.buf || 'zsh';
        this.k.emit({ type: 'tmux-rename', name: this.win().name });
        this.overlay = null;
      } else if (k === 'Escape') this.overlay = null;
      else if (k === 'Backspace') ov.buf = ov.buf.slice(0, -1);
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey) ov.buf += k;
      return true;
    }
    if (ov.kind === 'winlist') {
      if (k === 'ArrowDown') ov.idx = Math.min(ov.idx + 1, this.attached.windows.length - 1);
      else if (k === 'ArrowUp') ov.idx = Math.max(ov.idx - 1, 0);
      else if (k === 'Enter') {
        this.attached.activeWin = ov.idx;
        this.k.emit({ type: 'tmux-select-window', idx: ov.idx });
        this.overlay = null;
      } else if (k === 'Escape' || k === 'q') this.overlay = null;
      return true;
    }
    if (ov.kind === 'help') {
      this.overlay = null;
      return true;
    }
    return true;
  }

  // --- rendering ---------------------------------------------------------------

  render(el) {
    this.el = el;
    if (!this.attached) { el.innerHTML = ''; return; }
    const win = this.win();
    el.innerHTML = '';
    el.className = 'tmux-root';

    const paneArea = document.createElement('div');
    paneArea.className = 'tmux-panes';
    el.appendChild(paneArea);

    const renderNode = (node, container) => {
      if (node.type === 'leaf') {
        const wrap = document.createElement('div');
        wrap.className = 'tmux-pane' + (node.pane === win.activePane ? ' active' : '');
        container.appendChild(wrap);
        const termEl = document.createElement('div');
        termEl.className = 'tmux-pane-term';
        wrap.appendChild(termEl);
        node.pane.el = wrap;
        if (!node.pane.term) {
          node.pane.term = new TermUI(termEl, node.pane.shell, this.k);
        } else {
          // re-parent the existing terminal's element
          node.pane.term.el = termEl;
          node.pane.term.render();
        }
        if (this.copyPane === node.pane) {
          const badge = document.createElement('div');
          badge.className = 'tmux-copy-badge';
          badge.textContent = '[COPY]';
          wrap.appendChild(badge);
        }
        return;
      }
      const split = document.createElement('div');
      split.className = 'tmux-split ' + (node.dir === 'h' ? 'horiz' : 'vert');
      container.appendChild(split);
      renderNode(node.a, split);
      renderNode(node.b, split);
    };

    if (win.zoomed) {
      renderNode({ type: 'leaf', pane: win.activePane }, paneArea);
    } else {
      renderNode(win.root, paneArea);
    }

    // status bar
    const bar = document.createElement('div');
    bar.className = 'tmux-status';
    const winTabs = this.attached.windows
      .map((w, i) => {
        const mark = i === this.attached.activeWin ? '*' : (i === this.attached.windows.length - 1 ? '' : '');
        const cls = i === this.attached.activeWin ? 'tmux-win cur' : 'tmux-win';
        return `<span class="${cls}">${i}:${esc(w.name)}${mark}${w.zoomed && i === this.attached.activeWin ? 'Z' : ''}</span>`;
      })
      .join(' ');
    bar.innerHTML =
      `<span class="tmux-sess">[${esc(this.attached.name)}]</span> ${winTabs}` +
      `<span class="tmux-right">${this.prefix ? '<span class="tmux-prefix-ind">^B</span> ' : ''}"quest" ${new Date().toTimeString().slice(0, 5)}</span>`;
    el.appendChild(bar);

    // overlays
    if (this.overlay) {
      const ov = document.createElement('div');
      ov.className = 'tmux-overlay';
      if (this.overlay.kind === 'rename') {
        ov.innerHTML = `<div class="tmux-overlay-box">(rename-window) ${esc(this.overlay.buf)}<span class="tcursor">&nbsp;</span></div>`;
      } else if (this.overlay.kind === 'winlist') {
        const rows = this.attached.windows
          .map((w, i) => `<div class="${i === this.overlay.idx ? 'sel' : ''}">(${i}) ${esc(w.name)} — ${this.panes(w).length} panes</div>`)
          .join('');
        ov.innerHTML = `<div class="tmux-overlay-box"><div class="tdim">choose window (↑/↓, Enter):</div>${rows}</div>`;
      } else if (this.overlay.kind === 'help') {
        ov.innerHTML = `<div class="tmux-overlay-box">C-b %  split left/right<br>C-b "  split top/bottom<br>C-b ←→↑↓/o  move between panes<br>C-b z  zoom · C-b x  kill pane<br>C-b c/n/p/0-9  windows · C-b ,  rename<br>C-b d  detach · C-b [  scroll<br><br><span class="tdim">press any key to close</span></div>`;
      }
      el.appendChild(ov);
    }
  }

  pump() {
    let changed = false;
    for (const pane of this.allPanes()) {
      if (pane.term && pane.term.pump()) changed = true;
    }
    return changed;
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
