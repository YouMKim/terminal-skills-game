// Terminal UI: renders a shell session into a DOM element and implements
// readline-style line editing. All state lives here; the Shell does the work.

const MAX_LINES = 400;

export class TermUI {
  constructor(el, shell, kernel, opts = {}) {
    this.el = el;
    this.sh = shell;
    this.k = kernel;
    this.out = [];
    this.buf = '';
    this.pos = 0;
    this.histIdx = null;
    this.histStash = '';
    this.fgProc = null;
    this.search = null; // {q} when in Ctrl-R mode
    this.copyMode = false; // tmux copy-mode: allow scrollback
    this.title = opts.title || null;
    this.onCommand = opts.onCommand || null;
    this.el.classList.add('term');
    if (opts.banner) this.print(opts.banner);
    this.render();
  }

  print(lines) {
    if (typeof lines === 'string') lines = lines.split('\n');
    this.out.push(...lines);
    if (this.out.length > MAX_LINES) this.out.splice(0, this.out.length - MAX_LINES);
  }

  promptStr() {
    return `${this.sh.prompt()} $ `;
  }

  // Drain foreground process output; release the prompt when it finishes.
  pump() {
    let changed = false;
    if (this.fgProc) {
      const p = this.fgProc;
      if (p.fgLines.length) {
        this.print(p.fgLines.splice(0));
        changed = true;
      }
      if (p.status === 'done') {
        this.fgProc = null;
        changed = true;
      } else if (p.status === 'killed') {
        this.fgProc = null;
        changed = true;
      } else if (p.status === 'stopped') {
        this.print(`[${p.jobId}]+  Stopped    ${p.cmd}`);
        this.fgProc = null;
        changed = true;
      } else if (p.status === 'running' && p.bg) {
        // moved to background via bg after Ctrl-Z; shouldn't hold the prompt
        this.fgProc = null;
        changed = true;
      }
    }
    if (changed) this.render();
    return changed;
  }

  runLine(line) {
    this.print(this.promptStr() + line);
    this.buf = '';
    this.pos = 0;
    this.histIdx = null;
    const res = this.sh.execute(line);
    if (res.clear) this.out = [];
    if (res.out && res.out.length) this.print(res.out);
    if (res.fgProc) this.fgProc = res.fgProc;
    if (this.onCommand) this.onCommand(line, res);
    this.render();
  }

  key(e) {
    const k = e.key;
    const ctrl = e.ctrlKey;

    // Foreground process owns the terminal: only job-control keys work.
    if (this.fgProc) {
      if (ctrl && k === 'c') {
        this.k.emit({ type: 'ctrl', key: 'c' });
        this.print('^C');
        this.fgProc.status = 'killed';
        if (this.fgProc.prog && this.fgProc.prog.onKill) this.fgProc.prog.onKill(this.fgProc, this.k);
        this.fgProc = null;
        this.render();
        return true;
      }
      if (ctrl && k === 'z') {
        this.k.emit({ type: 'ctrl', key: 'z' });
        this.fgProc.status = 'stopped';
        this.pump();
        return true;
      }
      return true; // swallow everything else while a job runs
    }

    // Ctrl-R incremental history search
    if (this.search) {
      if (k === 'Enter') {
        const match = this.searchMatch();
        this.search = null;
        if (match) { this.k.emit({ type: 'ctrl', key: 'r-accept' }); this.runLine(match); }
        else this.render();
        return true;
      }
      if (k === 'Escape' || (ctrl && (k === 'c' || k === 'g'))) {
        this.search = null;
        this.render();
        return true;
      }
      if (ctrl && k === 'r') {
        this.search.skip++;
        this.render();
        return true;
      }
      if (k === 'Backspace') {
        this.search.q = this.search.q.slice(0, -1);
        this.render();
        return true;
      }
      if (k.length === 1 && !ctrl && !e.metaKey) {
        this.search.q += k;
        this.render();
        return true;
      }
      return true;
    }

    if (ctrl) {
      switch (k) {
        case 'a': this.pos = 0; this.k.emit({ type: 'ctrl', key: 'a' }); break;
        case 'e': this.pos = this.buf.length; this.k.emit({ type: 'ctrl', key: 'e' }); break;
        case 'u':
          this.buf = this.buf.slice(this.pos);
          this.pos = 0;
          this.k.emit({ type: 'ctrl', key: 'u' });
          break;
        case 'k':
          this.buf = this.buf.slice(0, this.pos);
          this.k.emit({ type: 'ctrl', key: 'k' });
          break;
        case 'w': {
          const head = this.buf.slice(0, this.pos).replace(/\S+\s*$/, '');
          this.buf = head + this.buf.slice(this.pos);
          this.pos = head.length;
          this.k.emit({ type: 'ctrl', key: 'w' });
          break;
        }
        case 'l':
          this.out = [];
          this.k.emit({ type: 'ctrl', key: 'l' });
          break;
        case 'c':
          this.print(this.promptStr() + this.buf + '^C');
          this.buf = '';
          this.pos = 0;
          this.k.emit({ type: 'ctrl', key: 'c' });
          break;
        case 'r':
          this.search = { q: '', skip: 0 };
          this.k.emit({ type: 'ctrl', key: 'r' });
          break;
        case 'b': return false; // let tmux take it
        default: return false;
      }
      this.render();
      return true;
    }

    switch (k) {
      case 'Enter': {
        const line = this.buf;
        if (!line.trim()) {
          this.print(this.promptStr());
          this.render();
          return true;
        }
        this.runLine(line);
        return true;
      }
      case 'Backspace':
        if (this.pos > 0) {
          this.buf = this.buf.slice(0, this.pos - 1) + this.buf.slice(this.pos);
          this.pos--;
        }
        break;
      case 'ArrowLeft': this.pos = Math.max(0, this.pos - 1); break;
      case 'ArrowRight': this.pos = Math.min(this.buf.length, this.pos + 1); break;
      case 'Home': this.pos = 0; break;
      case 'End': this.pos = this.buf.length; break;
      case 'ArrowUp': {
        const h = this.sh.history;
        if (!h.length) break;
        if (this.histIdx === null) { this.histStash = this.buf; this.histIdx = h.length; }
        this.histIdx = Math.max(0, this.histIdx - 1);
        this.buf = h[this.histIdx];
        this.pos = this.buf.length;
        this.k.emit({ type: 'hist', dir: 'up' });
        break;
      }
      case 'ArrowDown': {
        const h = this.sh.history;
        if (this.histIdx === null) break;
        this.histIdx++;
        if (this.histIdx >= h.length) {
          this.histIdx = null;
          this.buf = this.histStash;
        } else {
          this.buf = h[this.histIdx];
        }
        this.pos = this.buf.length;
        break;
      }
      case 'Tab': {
        this.complete();
        this.k.emit({ type: 'tab' });
        break;
      }
      default:
        if (k.length === 1 && !e.metaKey) {
          this.buf = this.buf.slice(0, this.pos) + k + this.buf.slice(this.pos);
          this.pos++;
        } else {
          return false;
        }
    }
    this.render();
    return true;
  }

  complete() {
    const head = this.buf.slice(0, this.pos);
    const m = head.match(/(\S*)$/);
    const partial = m[1];
    const isFirstWord = head.trimStart() === partial;
    let candidates = [];
    if (isFirstWord && !partial.includes('/')) {
      const cmds = ['ls', 'cd', 'cat', 'grep', 'find', 'tail', 'head', 'echo', 'ps', 'kill', 'pgrep', 'pkill', 'jobs', 'fg', 'bg', 'wc', 'sort', 'uniq', 'cut', 'awk', 'sed', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'tree', 'history', 'export', 'env', 'clear', 'tmux', 'man', 'help', 'which', 'chmod', 'xargs', 'pwd'];
      candidates = cmds.filter((c) => c.startsWith(partial));
    } else {
      // path completion
      const slash = partial.lastIndexOf('/');
      const dirPart = slash === -1 ? '' : partial.slice(0, slash + 1);
      const base = slash === -1 ? partial : partial.slice(slash + 1);
      const absDir = this.sh.resolvePath(dirPart || '.');
      const names = this.k.vfs.list(absDir) || [];
      candidates = names
        .filter((n) => n.startsWith(base) && !n.startsWith('.'))
        .map((n) => dirPart + n + (this.k.vfs.isDir(absDir + '/' + n) ? '/' : ''));
    }
    if (!candidates.length) return;
    if (candidates.length === 1) {
      const insert = candidates[0] + (candidates[0].endsWith('/') ? '' : ' ');
      this.buf = head.slice(0, head.length - partial.length) + insert + this.buf.slice(this.pos);
      this.pos = head.length - partial.length + insert.length;
      return;
    }
    // extend to the common prefix; show candidates
    let prefix = candidates[0];
    for (const c of candidates) {
      while (!c.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    if (prefix.length > partial.length) {
      this.buf = head.slice(0, head.length - partial.length) + prefix + this.buf.slice(this.pos);
      this.pos = head.length - partial.length + prefix.length;
    } else {
      this.print(this.promptStr() + this.buf);
      this.print(candidates.join('  '));
    }
  }

  searchMatch() {
    const { q, skip } = this.search;
    if (!q) return null;
    const h = this.sh.history;
    let found = 0;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].includes(q)) {
        if (found === skip) return h[i];
        found++;
      }
    }
    return null;
  }

  render() {
    const parts = [];
    for (const line of this.out) {
      parts.push(`<div class="tline">${esc(line) || '&nbsp;'}</div>`);
    }
    if (this.fgProc) {
      // no prompt while a foreground job runs
    } else if (this.search) {
      const match = this.searchMatch() || '';
      parts.push(
        `<div class="tline"><span class="tdim">(reverse-i-search)\`</span>${esc(this.search.q)}<span class="tdim">': </span>${esc(match)}<span class="tcursor">&nbsp;</span></div>`
      );
    } else {
      const before = esc(this.buf.slice(0, this.pos));
      const at = this.buf[this.pos] ? esc(this.buf[this.pos]) : '&nbsp;';
      const after = esc(this.buf.slice(this.pos + 1));
      parts.push(
        `<div class="tline"><span class="tprompt">${esc(this.promptStr())}</span>${before}<span class="tcursor">${at}</span>${after}</div>`
      );
    }
    this.el.innerHTML = parts.join('');
    if (!this.copyMode) this.el.scrollTop = this.el.scrollHeight;
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
