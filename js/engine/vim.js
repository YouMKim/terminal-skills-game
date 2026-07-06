// A faithful-enough vim engine: modal editing over an array of lines.
// Pure logic (no DOM) so it can be tested in node.
//
// Supported: h j k l w b e 0 ^ $ f F t T ; , gg G {count} i a I A o O
//            x X r ~ d c y (+ motions, dd cc yy, text objects iw aw i" a" i( a()
//            D C s S p P J u Ctrl-r v V / n N :N :s :%s :w :q

const WORD = /[A-Za-z0-9_]/;

function charClass(ch) {
  if (ch === undefined || /\s/.test(ch)) return 0; // blank
  return WORD.test(ch) ? 1 : 2; // word chars vs punctuation
}

export class Vim {
  constructor({ lines, cursor = [0, 0], undoHistory = null }) {
    this.lines = lines.slice();
    this.r = cursor[0];
    this.c = cursor[1];
    this.mode = 'normal'; // normal | insert | visual | vline | cmd | search
    this.count = '';
    this.opCount = '';
    this.op = null; // 'd' | 'c' | 'y'
    this.pending = null; // {kind:'find',cmd} | {kind:'replace'} | {kind:'g'} | {kind:'textobj',incl}
    this.register = null; // {linewise, text|lines}
    this.undoStack = undoHistory ? undoHistory.map((l) => ({ lines: l.slice(), r: 0, c: 0 })) : [];
    this.redoStack = [];
    this.lastFt = null;
    this.searchPat = null;
    this.miniBuf = '';
    this.anchor = null; // [r,c] visual anchor
    this.desired = 0;
    this.message = '';
    this.lastEvent = null; // 'edit' | 'write' — for level checks
  }

  line(r = this.r) { return this.lines[r] ?? ''; }
  lineLen(r = this.r) { return this.line(r).length; }
  maxCol(r = this.r) { return Math.max(0, this.lineLen(r) - 1); }
  charAt(r, c) { return this.line(r)[c]; }

  clamp() {
    this.r = Math.max(0, Math.min(this.r, this.lines.length - 1));
    const max = this.mode === 'insert' ? this.lineLen() : this.maxCol();
    this.c = Math.max(0, Math.min(this.c, max));
  }

  snap() {
    this.undoStack.push({ lines: this.lines.slice(), r: this.r, c: this.c });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  // --- position walking ----------------------------------------------------

  fwd(r, c) {
    if (c < this.lineLen(r)) return [r, c + 1]; // may land on virtual newline (c === len)
    if (r < this.lines.length - 1) return [r + 1, 0];
    return null;
  }

  bwd(r, c) {
    if (c > 0) return [r, c - 1];
    if (r > 0) return [r - 1, this.lineLen(r - 1)]; // virtual newline of prev line
    return null;
  }

  classAt(r, c) {
    if (c >= this.lineLen(r)) return 0; // virtual newline is blank
    return charClass(this.charAt(r, c));
  }

  nextWordStart(r, c) {
    let pos = [r, c];
    const k0 = this.classAt(r, c);
    if (k0 !== 0) {
      while (pos && this.classAt(pos[0], pos[1]) === k0) {
        const n = this.fwd(pos[0], pos[1]);
        if (!n) return pos;
        pos = n;
      }
    }
    while (pos && this.classAt(pos[0], pos[1]) === 0) {
      const n = this.fwd(pos[0], pos[1]);
      if (!n) break;
      pos = n;
      // vim stops on empty lines
      if (this.lineLen(pos[0]) === 0 && pos[1] === 0) return pos;
    }
    return pos;
  }

  prevWordStart(r, c) {
    let pos = this.bwd(r, c);
    if (!pos) return [r, c];
    while (pos && this.classAt(pos[0], pos[1]) === 0) {
      const p = this.bwd(pos[0], pos[1]);
      if (!p) return pos;
      pos = p;
    }
    const k = this.classAt(pos[0], pos[1]);
    while (true) {
      const p = this.bwd(pos[0], pos[1]);
      if (!p || this.classAt(p[0], p[1]) !== k) break;
      pos = p;
    }
    return pos;
  }

  wordEnd(r, c) {
    let pos = this.fwd(r, c);
    if (!pos) return [r, c];
    while (pos && this.classAt(pos[0], pos[1]) === 0) {
      const n = this.fwd(pos[0], pos[1]);
      if (!n) return [r, Math.min(c, this.maxCol(r))];
      pos = n;
    }
    const k = this.classAt(pos[0], pos[1]);
    while (true) {
      const n = this.fwd(pos[0], pos[1]);
      if (!n || this.classAt(n[0], n[1]) !== k) break;
      pos = n;
    }
    return pos;
  }

  firstNonBlank(r) {
    const m = this.line(r).match(/\S/);
    return m ? m.index : 0;
  }

  findInLine(cmd, ch, r, c, n = 1) {
    const line = this.line(r);
    let col = c;
    for (let i = 0; i < n; i++) {
      if (cmd === 'f' || cmd === 't') {
        let from = col + 1;
        if (cmd === 't' && i > 0) from = col + 2;
        const idx = line.indexOf(ch, cmd === 't' ? from + (i === 0 ? 1 : 0) - 1 : from);
        if (idx === -1) return null;
        col = cmd === 't' ? idx - 1 : idx;
      } else {
        let from = col - 1;
        if (cmd === 'T' && i > 0) from = col - 2;
        const idx = line.lastIndexOf(ch, cmd === 'T' ? from - (i === 0 ? 1 : 0) + 1 : from);
        if (idx === -1) return null;
        col = cmd === 'T' ? idx + 1 : idx;
      }
    }
    return col;
  }

  searchFrom(r, c, pat, backward = false) {
    const N = this.lines.length;
    if (!backward) {
      for (let i = 0; i <= N; i++) {
        const row = (r + i) % N;
        const from = i === 0 ? c + 1 : 0;
        const idx = this.line(row).indexOf(pat, from);
        if (idx !== -1) return [row, idx];
      }
    } else {
      for (let i = 0; i <= N; i++) {
        const row = ((r - i) % N + N) % N;
        const upto = i === 0 ? c - 1 : this.lineLen(row);
        if (upto < 0) continue;
        const idx = this.line(row).lastIndexOf(pat, upto);
        if (idx !== -1 && !(i === 0 && idx >= c)) return [row, idx];
      }
    }
    return null;
  }

  // --- editing primitives ----------------------------------------------------

  deleteRange(range) {
    // range: {linewise, r1, c1, r2, c2} — inclusive, normalized
    if (range.linewise) {
      const removed = this.lines.slice(range.r1, range.r2 + 1);
      this.register = { linewise: true, lines: removed };
      this.lines.splice(range.r1, range.r2 - range.r1 + 1);
      if (!this.lines.length) this.lines = [''];
      this.r = Math.min(range.r1, this.lines.length - 1);
      this.c = this.firstNonBlank(this.r);
    } else {
      const { r1, c1, r2, c2 } = range;
      if (r1 === r2) {
        const line = this.line(r1);
        this.register = { linewise: false, text: line.slice(c1, c2 + 1) };
        this.lines[r1] = line.slice(0, c1) + line.slice(c2 + 1);
      } else {
        const parts = [this.line(r1).slice(c1)];
        for (let i = r1 + 1; i < r2; i++) parts.push(this.line(i));
        parts.push(this.line(r2).slice(0, c2 + 1));
        this.register = { linewise: false, text: parts.join('\n') };
        this.lines[r1] = this.line(r1).slice(0, c1) + this.line(r2).slice(c2 + 1);
        this.lines.splice(r1 + 1, r2 - r1);
      }
      this.r = r1;
      this.c = c1;
    }
    this.clamp();
    this.lastEvent = 'edit';
  }

  yankRange(range) {
    if (range.linewise) {
      this.register = { linewise: true, lines: this.lines.slice(range.r1, range.r2 + 1) };
      this.message = range.r2 > range.r1 ? `${range.r2 - range.r1 + 1} lines yanked` : 'line yanked';
      this.r = range.r1;
    } else {
      const { r1, c1, r2, c2 } = range;
      if (r1 === r2) {
        this.register = { linewise: false, text: this.line(r1).slice(c1, c2 + 1) };
      } else {
        const parts = [this.line(r1).slice(c1)];
        for (let i = r1 + 1; i < r2; i++) parts.push(this.line(i));
        parts.push(this.line(r2).slice(0, c2 + 1));
        this.register = { linewise: false, text: parts.join('\n') };
      }
      this.r = r1; this.c = c1;
      this.message = 'yanked';
    }
    this.clamp();
  }

  paste(before = false) {
    if (!this.register) { this.message = 'nothing in register'; return; }
    this.snap();
    if (this.register.linewise) {
      const at = before ? this.r : this.r + 1;
      this.lines.splice(at, 0, ...this.register.lines.map((l) => l));
      this.r = at;
      this.c = this.firstNonBlank(this.r);
    } else {
      const text = this.register.text;
      const line = this.line();
      const at = before ? this.c : Math.min(this.c + 1, line.length);
      if (text.includes('\n')) {
        const parts = text.split('\n');
        const tailStr = line.slice(at);
        this.lines[this.r] = line.slice(0, at) + parts[0];
        const middle = parts.slice(1, -1);
        const lastPart = parts[parts.length - 1];
        this.lines.splice(this.r + 1, 0, ...middle, lastPart + tailStr);
      } else {
        this.lines[this.r] = line.slice(0, at) + text + line.slice(at);
        this.c = at + text.length - 1;
      }
    }
    this.clamp();
    this.lastEvent = 'edit';
  }

  // --- motions --------------------------------------------------------------
  // Returns {r, c, incl, linewise, toEol?} or null (failed motion, e.g. f with no match).

  motion(key, n) {
    const { r, c } = this;
    switch (key) {
      case 'h': return { r, c: Math.max(0, c - n), incl: false };
      case 'l': return { r, c: Math.min(this.maxCol() + 1, c + n), incl: false };
      case ' ': return { r, c: Math.min(this.maxCol() + 1, c + n), incl: false };
      case 'j': return { r: Math.min(this.lines.length - 1, r + n), c, linewise: true };
      case 'k': return { r: Math.max(0, r - n), c, linewise: true };
      case '0': return { r, c: 0, incl: false };
      case '^': return { r, c: this.firstNonBlank(r), incl: false };
      case '$': return { r: Math.min(this.lines.length - 1, r + n - 1), c: Infinity, incl: true, toEol: true };
      case 'w': {
        let pos = [r, c];
        for (let i = 0; i < n; i++) pos = this.nextWordStart(pos[0], pos[1]);
        return { r: pos[0], c: pos[1], incl: false, isW: true };
      }
      case 'b': {
        let pos = [r, c];
        for (let i = 0; i < n; i++) pos = this.prevWordStart(pos[0], pos[1]);
        return { r: pos[0], c: pos[1], incl: false };
      }
      case 'e': {
        let pos = [r, c];
        for (let i = 0; i < n; i++) pos = this.wordEnd(pos[0], pos[1]);
        return { r: pos[0], c: pos[1], incl: true };
      }
      case 'G': return { r: this._hadCount ? Math.min(n - 1, this.lines.length - 1) : this.lines.length - 1, c: 0, linewise: true, firstNB: true };
      case 'g': return null; // handled via pending
      default: return null;
    }
  }

  // Build an inclusive char range (or linewise) from cursor to a motion result.
  rangeTo(m, motionKey) {
    if (m.linewise) {
      return { linewise: true, r1: Math.min(this.r, m.r), r2: Math.max(this.r, m.r) };
    }
    let start = [this.r, this.c];
    let end = [m.r, m.c === Infinity ? this.maxCol(m.r) : m.c];
    const forward = end[0] > start[0] || (end[0] === start[0] && end[1] >= start[1]);
    if (!forward) {
      // backward motion: operate over [target, cursor)
      const e = this.bwd(start[0], start[1]);
      if (!e) return null;
      start = end;
      end = e;
      if (end[0] < start[0] || (end[0] === start[0] && end[1] < start[1])) return null;
      return { linewise: false, r1: start[0], c1: start[1], r2: end[0], c2: Math.min(end[1], this.maxCol(end[0])) };
    }
    if (!m.incl) {
      // dw at end of line shouldn't join lines: clamp to end of start line
      if (motionKey === 'w' && end[0] > start[0]) {
        end = [start[0], this.lineLen(start[0])];
      }
      const e = this.bwd(end[0], end[1]);
      if (!e) return null;
      end = e;
      if (end[0] < start[0] || (end[0] === start[0] && end[1] < start[1])) return null;
    }
    return {
      linewise: false,
      r1: start[0], c1: start[1],
      r2: end[0], c2: Math.min(end[1], this.maxCol(end[0])),
    };
  }

  textObjectRange(obj, incl) {
    const { r, c } = this;
    const line = this.line();
    if (obj === 'w') {
      if (!line.length) return null;
      const k = charClass(line[c] ?? ' ');
      let a = c;
      let b = c;
      const cls = (i) => charClass(line[i]);
      while (a > 0 && cls(a - 1) === k) a--;
      while (b < line.length - 1 && cls(b + 1) === k) b++;
      if (incl === 'a') {
        let b2 = b;
        while (b2 < line.length - 1 && /\s/.test(line[b2 + 1])) b2++;
        if (b2 === b) while (a > 0 && /\s/.test(line[a - 1])) a--;
        b = b2;
      }
      return { linewise: false, r1: r, c1: a, r2: r, c2: b };
    }
    const pairs = { '"': ['"', '"'], "'": ["'", "'"], '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'], '{': ['{', '}'], '}': ['{', '}'], '[': ['[', ']'], ']': ['[', ']'] };
    const pair = pairs[obj];
    if (!pair) return null;
    const [open, close] = pair;
    let a = -1;
    if (line[c] === open) a = c;
    else {
      for (let i = c; i >= 0; i--) if (line[i] === open) { a = i; break; }
    }
    if (a === -1) return null;
    let b = -1;
    for (let i = Math.max(c, a) + (line[c] === close && c > a ? 0 : 1); i < line.length; i++) {
      if (line[i] === close) { b = i; break; }
    }
    if (line[c] === close && c > a) b = c;
    if (b === -1) return null;
    if (incl === 'i') { a++; b--; if (b < a) return null; }
    return { linewise: false, r1: r, c1: a, r2: r, c2: b };
  }

  // --- key handling ----------------------------------------------------------
  // key: e.key string. mods: {ctrl}. Returns true if the key was consumed.

  key(k, mods = {}) {
    this.lastEvent = null;
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return false;

    switch (this.mode) {
      case 'insert': return this.keyInsert(k, mods);
      case 'cmd': return this.keyMini(k, ':');
      case 'search': return this.keyMini(k, '/');
      default: return this.keyNormal(k, mods);
    }
  }

  keyInsert(k, mods) {
    if (k === 'Escape' || (mods.ctrl && k === '[')) {
      this.mode = 'normal';
      this.c = Math.max(0, this.c - 1);
      this.clamp();
      return true;
    }
    if (k === 'Enter') {
      const line = this.line();
      this.lines[this.r] = line.slice(0, this.c);
      this.lines.splice(this.r + 1, 0, line.slice(this.c));
      this.r++;
      this.c = 0;
      this.lastEvent = 'edit';
      return true;
    }
    if (k === 'Backspace') {
      if (this.c > 0) {
        const line = this.line();
        this.lines[this.r] = line.slice(0, this.c - 1) + line.slice(this.c);
        this.c--;
      } else if (this.r > 0) {
        const prev = this.line(this.r - 1);
        this.c = prev.length;
        this.lines[this.r - 1] = prev + this.line(this.r);
        this.lines.splice(this.r, 1);
        this.r--;
      }
      this.lastEvent = 'edit';
      return true;
    }
    if (k === 'Tab') {
      this.insertText('  ');
      return true;
    }
    if (k.length === 1 && !mods.ctrl) {
      this.insertText(k);
      return true;
    }
    return false;
  }

  insertText(text) {
    const line = this.line();
    this.lines[this.r] = line.slice(0, this.c) + text + line.slice(this.c);
    this.c += text.length;
    this.lastEvent = 'edit';
  }

  keyMini(k, kind) {
    if (k === 'Escape') { this.mode = 'normal'; this.miniBuf = ''; return true; }
    if (k === 'Backspace') {
      if (!this.miniBuf.length) { this.mode = 'normal'; return true; }
      this.miniBuf = this.miniBuf.slice(0, -1);
      return true;
    }
    if (k === 'Enter') {
      const buf = this.miniBuf;
      this.miniBuf = '';
      this.mode = 'normal';
      if (kind === '/') this.execSearch(buf);
      else this.execCmd(buf);
      return true;
    }
    if (k.length === 1) { this.miniBuf += k; return true; }
    return false;
  }

  execSearch(pat) {
    if (!pat) return;
    this.searchPat = pat;
    const hit = this.searchFrom(this.r, this.c, pat);
    if (hit) { [this.r, this.c] = hit; this.message = `/${pat}`; }
    else this.message = `E486: Pattern not found: ${pat}`;
  }

  execCmd(cmd) {
    if (/^\d+$/.test(cmd)) {
      this.r = Math.min(parseInt(cmd, 10) - 1, this.lines.length - 1);
      this.r = Math.max(0, this.r);
      this.c = this.firstNonBlank(this.r);
      return;
    }
    if (cmd === 'w' || cmd === 'w!') {
      this.message = '"quest.txt" written';
      this.lastEvent = 'write';
      return;
    }
    if (cmd === 'q' || cmd === 'q!' || cmd === 'wq' || cmd === 'x') {
      this.message = 'This is a dojo — there is no escape. (Use the ← Back button.)';
      return;
    }
    const m = cmd.match(/^(%?)s\/((?:[^/\\]|\\.)*)\/((?:[^/\\]|\\.)*)(?:\/([gi]*))?$/);
    if (m) {
      const [, all, patRaw, repRaw, flags = ''] = m;
      const pat = patRaw.replace(/\\\//g, '/');
      const rep = repRaw.replace(/\\\//g, '/');
      let re;
      try {
        re = new RegExp(pat, flags.includes('g') ? 'g' : '');
      } catch {
        this.message = `E486: bad pattern: ${pat}`;
        return;
      }
      this.snap();
      let hits = 0;
      const apply = (row) => {
        const before = this.lines[row];
        const after = before.replace(re, rep);
        if (after !== before) { hits++; this.lines[row] = after; }
      };
      if (all === '%') for (let i = 0; i < this.lines.length; i++) apply(i);
      else apply(this.r);
      if (hits) { this.message = `${hits} substitution${hits > 1 ? 's' : ''}`; this.lastEvent = 'edit'; }
      else { this.message = `E486: Pattern not found: ${pat}`; this.undoStack.pop(); }
      this.clamp();
      return;
    }
    this.message = `E492: Not an editor command: ${cmd}`;
  }

  keyNormal(k, mods) {
    const visual = this.mode === 'visual' || this.mode === 'vline';

    // pending single-char argument (f/t/r)
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      if (k === 'Escape') { this.resetPending(); return true; }
      if (k.length !== 1) { this.resetPending(); return true; }
      if (p.kind === 'find') {
        this.lastFt = { cmd: p.cmd, ch: k };
        return this.applyFind(p.cmd, k, this.takeCount());
      }
      if (p.kind === 'replace') {
        this.snap();
        const n = this.takeCount();
        const line = this.line();
        if (this.c + n <= line.length) {
          this.lines[this.r] = line.slice(0, this.c) + k.repeat(n) + line.slice(this.c + n);
          this.c += n - 1;
          this.lastEvent = 'edit';
        }
        return true;
      }
      if (p.kind === 'g') {
        if (k === 'g') {
          const n = this.count ? parseInt(this.count, 10) : 1;
          const target = this.count ? Math.min(n - 1, this.lines.length - 1) : 0;
          this.count = '';
          if (this.op) return this.opLinewise(this.r, target);
          if (visual) { this.r = target; this.c = this.firstNonBlank(target); this.clamp(); return true; }
          this.r = target;
          this.c = this.firstNonBlank(target);
          return true;
        }
        this.resetPending();
        return true;
      }
      if (p.kind === 'textobj') {
        const range = this.textObjectRange(k, p.incl);
        if (range && this.op) {
          this.applyOperator(this.op, range);
          this.op = null;
        } else {
          this.resetPending();
        }
        return true;
      }
      return true;
    }

    if (k === 'Escape') {
      if (visual) this.mode = 'normal';
      this.resetPending();
      this.anchor = null;
      this.message = '';
      return true;
    }

    // counts
    if (/^[1-9]$/.test(k) || (k === '0' && (this.op ? this.opCount : this.count))) {
      if (this.op) this.opCount += k;
      else this.count += k;
      return true;
    }

    if (mods.ctrl && k === 'r') { this.redo(); return true; }
    if (mods.ctrl) return false;

    // operators
    if (!visual && (k === 'd' || k === 'c' || k === 'y')) {
      if (this.op === k) {
        // dd / cc / yy
        const n = this.takeCount();
        const r2 = Math.min(this.r + n - 1, this.lines.length - 1);
        this.opLinewise(this.r, r2);
        return true;
      }
      if (this.op) { this.resetPending(); return true; }
      this.op = k;
      return true;
    }

    if (this.op && (k === 'i' || k === 'a')) {
      this.pending = { kind: 'textobj', incl: k };
      return true;
    }

    // motions & commands
    switch (k) {
      case 'f': case 'F': case 't': case 'T':
        this.pending = { kind: 'find', cmd: k };
        return true;
      case ';': case ',': {
        if (!this.lastFt) return true;
        let { cmd, ch } = this.lastFt;
        if (k === ',') cmd = { f: 'F', F: 'f', t: 'T', T: 't' }[cmd];
        return this.applyFind(cmd, ch, this.takeCount(), true);
      }
      case 'g':
        this.pending = { kind: 'g' };
        return true;
      case 'r':
        if (!this.op && !visual) { this.pending = { kind: 'replace' }; return true; }
        return true;
      case '/':
        this.mode = 'search';
        this.miniBuf = '';
        return true;
      case ':':
        this.mode = 'cmd';
        this.miniBuf = '';
        return true;
      case 'n': case 'N': {
        if (!this.searchPat) { this.message = 'E35: No previous search'; return true; }
        const hit = this.searchFrom(this.r, this.c, this.searchPat, k === 'N');
        if (hit) [this.r, this.c] = hit;
        else this.message = 'Pattern not found';
        return true;
      }
      case 'u': this.undo(); return true;
      case 'v':
        if (this.mode === 'visual') { this.mode = 'normal'; this.anchor = null; }
        else { this.mode = 'visual'; this.anchor = [this.r, this.c]; }
        return true;
      case 'V':
        if (this.mode === 'vline') { this.mode = 'normal'; this.anchor = null; }
        else { this.mode = 'vline'; this.anchor = this.anchor || [this.r, this.c]; }
        return true;
      case 'i': case 'a': case 'I': case 'A': case 'o': case 'O':
        if (visual) return true;
        this.snap();
        this.enterInsert(k);
        return true;
      case 'x': {
        const n = this.takeCount();
        if (visual) return this.visualOperate('d');
        if (!this.lineLen()) return true;
        this.snap();
        this.deleteRange({ linewise: false, r1: this.r, c1: this.c, r2: this.r, c2: Math.min(this.c + n - 1, this.maxCol()) });
        return true;
      }
      case 'X': {
        if (this.c === 0) return true;
        this.snap();
        this.deleteRange({ linewise: false, r1: this.r, c1: this.c - 1, r2: this.r, c2: this.c - 1 });
        return true;
      }
      case 'D':
        this.snap();
        this.deleteRange({ linewise: false, r1: this.r, c1: this.c, r2: this.r, c2: this.maxCol() });
        return true;
      case 'C':
        this.snap();
        this.deleteRange({ linewise: false, r1: this.r, c1: this.c, r2: this.r, c2: this.maxCol() });
        this.enterInsert('i', true);
        return true;
      case 's': {
        if (visual) return this.visualOperate('c');
        this.snap();
        if (this.lineLen()) this.deleteRange({ linewise: false, r1: this.r, c1: this.c, r2: this.r, c2: this.c });
        this.enterInsert('i', true);
        return true;
      }
      case 'S':
        this.snap();
        this.lines[this.r] = '';
        this.c = 0;
        this.enterInsert('i', true);
        this.lastEvent = 'edit';
        return true;
      case 'p':
        if (visual) return true;
        this.paste(false);
        return true;
      case 'P':
        if (visual) return true;
        this.paste(true);
        return true;
      case 'J': {
        if (this.r >= this.lines.length - 1) return true;
        this.snap();
        const cur = this.line().replace(/\s+$/, '');
        const next = this.line(this.r + 1).replace(/^\s+/, '');
        this.c = cur.length;
        this.lines[this.r] = cur + (cur && next ? ' ' : '') + next;
        this.lines.splice(this.r + 1, 1);
        this.lastEvent = 'edit';
        return true;
      }
      case '~': {
        if (visual) return true;
        this.snap();
        const n = this.takeCount();
        const line = this.line();
        const end = Math.min(this.c + n, line.length);
        let seg = '';
        for (let i = this.c; i < end; i++) {
          const ch = line[i];
          seg += ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
        }
        this.lines[this.r] = line.slice(0, this.c) + seg + line.slice(end);
        this.c = Math.min(end, this.maxCol());
        this.lastEvent = 'edit';
        return true;
      }
      case 'Y': {
        const n = this.takeCount();
        this.yankRange({ linewise: true, r1: this.r, r2: Math.min(this.r + n - 1, this.lines.length - 1) });
        return true;
      }
      case 'Enter': {
        if (this.r < this.lines.length - 1) { this.r++; this.c = this.firstNonBlank(this.r); }
        return true;
      }
    }

    if (visual && (k === 'd' || k === 'y' || k === 'c')) return this.visualOperate(k);

    // plain motion (possibly as operator target)
    this._hadCount = !!(this.count || this.opCount);
    const n = this.takeCount();
    const m = this.motion(k, n);
    if (!m) { this.resetPending(); return k.length === 1; }

    if (this.op) {
      const op = this.op;
      this.op = null;
      let motionKey = k;
      let mm = m;
      if (op === 'c' && k === 'w' && this.classAt(this.r, this.c) !== 0) {
        // cw behaves like ce
        mm = this.motion('e', n);
        motionKey = 'e';
      }
      const range = mm.linewise
        ? { linewise: true, r1: Math.min(this.r, mm.r), r2: Math.max(this.r, mm.r) }
        : this.rangeTo(mm, motionKey);
      if (range) this.applyOperator(op, range);
      return true;
    }

    // plain movement
    if (k === 'j' || k === 'k') {
      this.r = m.r;
      this.c = Math.min(this.desired, this.maxCol());
      return true;
    }
    this.r = m.r;
    this.c = m.c === Infinity ? this.maxCol(m.r) : m.c;
    if (m.firstNB) this.c = this.firstNonBlank(this.r);
    this.clamp();
    this.desired = m.toEol ? Infinity : this.c;
    return true;
  }

  applyFind(cmd, ch, n, isRepeat = false) {
    const col = this.findInLine(cmd, ch, this.r, this.c, n);
    if (col === null) {
      if (this.op) this.op = null;
      return true;
    }
    if (this.op) {
      const op = this.op;
      this.op = null;
      const incl = cmd === 'f' || cmd === 't';
      const forward = col >= this.c;
      let range;
      if (forward) {
        range = { linewise: false, r1: this.r, c1: this.c, r2: this.r, c2: incl ? col : col - 1 };
        if (range.c2 < range.c1) return true;
      } else {
        range = { linewise: false, r1: this.r, c1: col, r2: this.r, c2: this.c - (cmd === 'T' || cmd === 'F' ? 1 : 0) };
        if (cmd === 'F' || cmd === 'T') range.c2 = this.c - 1;
        if (range.c2 < range.c1) return true;
      }
      this.applyOperator(op, range);
      return true;
    }
    this.c = col;
    this.desired = col;
    return true;
  }

  opLinewise(r1, r2) {
    const op = this.op;
    this.op = null;
    const range = { linewise: true, r1: Math.min(r1, r2), r2: Math.max(r1, r2) };
    this.applyOperator(op, range);
    return true;
  }

  applyOperator(op, range) {
    if (op === 'y') { this.yankRange(range); return; }
    this.snap();
    if (op === 'd') { this.deleteRange(range); return; }
    // change
    if (range.linewise) {
      this.register = { linewise: true, lines: this.lines.slice(range.r1, range.r2 + 1) };
      this.lines.splice(range.r1, range.r2 - range.r1 + 1, '');
      this.r = range.r1;
      this.c = 0;
      this.enterInsert('i', true);
      this.lastEvent = 'edit';
    } else {
      this.deleteRange(range);
      this.enterInsert('i', true);
    }
  }

  visualOperate(op) {
    const [ar, ac] = this.anchor;
    let range;
    if (this.mode === 'vline') {
      range = { linewise: true, r1: Math.min(ar, this.r), r2: Math.max(ar, this.r) };
    } else {
      let r1 = ar; let c1 = ac; let r2 = this.r; let c2 = this.c;
      if (r2 < r1 || (r1 === r2 && c2 < c1)) { [r1, c1, r2, c2] = [r2, c2, r1, c1]; }
      range = { linewise: false, r1, c1, r2, c2 };
    }
    this.mode = 'normal';
    this.anchor = null;
    this.applyOperator(op, range);
    return true;
  }

  enterInsert(k, plain = false) {
    this.mode = 'insert';
    if (plain) return;
    switch (k) {
      case 'i': break;
      case 'a': this.c = Math.min(this.c + 1, this.lineLen()); break;
      case 'I': this.c = this.firstNonBlank(this.r); break;
      case 'A': this.c = this.lineLen(); break;
      case 'o':
        this.lines.splice(this.r + 1, 0, '');
        this.r++;
        this.c = 0;
        this.lastEvent = 'edit';
        break;
      case 'O':
        this.lines.splice(this.r, 0, '');
        this.c = 0;
        this.lastEvent = 'edit';
        break;
    }
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) { this.message = 'Already at oldest change'; return; }
    this.redoStack.push({ lines: this.lines.slice(), r: this.r, c: this.c });
    this.lines = snap.lines.slice();
    this.r = snap.r;
    this.c = snap.c;
    this.clamp();
    this.message = 'undo';
    this.lastEvent = 'edit';
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) { this.message = 'Already at newest change'; return; }
    this.undoStack.push({ lines: this.lines.slice(), r: this.r, c: this.c });
    this.lines = snap.lines.slice();
    this.r = snap.r;
    this.c = snap.c;
    this.clamp();
    this.message = 'redo';
    this.lastEvent = 'edit';
  }

  takeCount() {
    const a = this.count ? parseInt(this.count, 10) : 1;
    const b = this.opCount ? parseInt(this.opCount, 10) : 1;
    this.count = '';
    this.opCount = '';
    return a * b;
  }

  resetPending() {
    this.op = null;
    this.count = '';
    this.opCount = '';
    this.pending = null;
  }

  // Visual selection as a set of "r:c" keys, for rendering.
  selection() {
    if (!this.anchor || (this.mode !== 'visual' && this.mode !== 'vline')) return null;
    const set = new Set();
    const [ar, ac] = this.anchor;
    let r1 = Math.min(ar, this.r);
    let r2 = Math.max(ar, this.r);
    if (this.mode === 'vline') {
      for (let r = r1; r <= r2; r++) for (let c = 0; c <= this.maxCol(r); c++) set.add(`${r}:${c}`);
      return set;
    }
    let c1 = ar < this.r || (ar === this.r && ac <= this.c) ? ac : this.c;
    let c2 = ar < this.r || (ar === this.r && ac <= this.c) ? this.c : ac;
    if (r1 === r2) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) set.add(`${r1}:${c}`);
      return set;
    }
    for (let r = r1; r <= r2; r++) {
      const from = r === r1 ? c1 : 0;
      const to = r === r2 ? c2 : this.maxCol(r);
      for (let c = from; c <= to; c++) set.add(`${r}:${c}`);
    }
    return set;
  }

  statusline() {
    if (this.mode === 'cmd') return ':' + this.miniBuf;
    if (this.mode === 'search') return '/' + this.miniBuf;
    const mode = { insert: '-- INSERT --', visual: '-- VISUAL --', vline: '-- VISUAL LINE --' }[this.mode] || '';
    const pend = (this.count || '') + (this.op || '') + (this.opCount || '') + (this.pending ? this.pending.cmd || this.pending.kind[0] : '');
    return { mode, pending: pend, message: this.message, pos: `${this.r + 1},${this.c + 1}` };
  }
}
