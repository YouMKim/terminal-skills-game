// Simulated shell: a Kernel (shared vfs + processes + env) and Shell instances
// (one per terminal/pane) that parse and execute command lines.
//
// Design: everything is synchronous and pure-JS so it can be unit-tested in
// node. Time advances via kernel.tick(), driven by the UI's setInterval.

export class Kernel {
  constructor(vfs, env = {}) {
    this.vfs = vfs;
    this.env = { HOME: '/home/dev', USER: 'dev', SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', ...env };
    this.procs = [];
    this.nextPid = 1001;
    this.programs = {}; // absPath -> factory(argv, kernel) -> program instance
    this.events = [];
    this.time = 0;
  }

  emit(ev) {
    this.events.push(ev);
  }

  registerProgram(absPath, factory) {
    this.programs[absPath] = factory;
  }

  spawn({ cmd, name, program, shell, bg = false, cpu = 0.3 }) {
    const proc = {
      pid: this.nextPid++,
      cmd,
      name: name || cmd.split(/\s+/)[0].split('/').pop(),
      cpu: program && program.cpu != null ? program.cpu : cpu,
      status: 'running', // running | stopped | done | killed
      bg,
      fgLines: [],
      prog: program || null,
      shell: shell || null,
      jobId: null,
    };
    if (shell) {
      proc.jobId = shell.nextJobId++;
      shell.jobs.push(proc);
    }
    this.procs.push(proc);
    this.emit({ type: 'spawn', name: proc.name, cmd, bg, pid: proc.pid });
    return proc;
  }

  findProc(pred) {
    return this.procs.find((p) => (p.status === 'running' || p.status === 'stopped') && pred(p));
  }

  kill(pid) {
    const proc = this.procs.find((p) => p.pid === pid && (p.status === 'running' || p.status === 'stopped'));
    if (!proc) return false;
    proc.status = 'killed';
    if (proc.prog && proc.prog.onKill) proc.prog.onKill(proc, this);
    this.emit({ type: 'kill', pid, name: proc.name });
    return true;
  }

  tick() {
    this.time++;
    for (const proc of this.procs) {
      if (proc.status !== 'running') continue;
      if (proc.prog && proc.prog.onTick) proc.prog.onTick(proc, this);
    }
  }
}

// ---------------------------------------------------------------------------

const HELP = {
  pwd: 'pwd — print the current working directory',
  ls: 'ls [-la] [path] — list directory contents',
  cd: 'cd [path] — change directory (cd with no args goes home)',
  cat: 'cat <file...> — print file contents',
  echo: 'echo [text] — print text (variables like $NAME expand)',
  head: 'head [-n N] <file> — first N lines (default 10)',
  tail: 'tail [-n N] [-f] <file> — last N lines; -f follows live output (Ctrl-C to stop)',
  grep: 'grep [-rinc] <pattern> [file...] — search for a pattern',
  find: 'find [path] [-name pat] [-type f|d] — walk the tree and print matching paths',
  wc: 'wc [-l] [file] — count lines/words/chars',
  sort: 'sort [-rn] [file] — sort lines',
  uniq: 'uniq [-c] [file] — collapse repeated adjacent lines (-c counts them)',
  mkdir: 'mkdir [-p] <dir> — create a directory',
  touch: 'touch <file> — create an empty file',
  rm: 'rm [-rf] <path> — remove files (careful!)',
  cp: 'cp <src> <dst> — copy a file',
  mv: 'mv <src> <dst> — move/rename',
  chmod: 'chmod +x <file> — make a file executable',
  ps: 'ps — list running processes',
  kill: 'kill [-9] <pid> — terminate a process',
  pgrep: 'pgrep [-f] <pattern> — print PIDs of matching processes',
  pkill: 'pkill [-f] <pattern> — kill all matching processes',
  cut: 'cut -d <delim> -f <N[,M]> [file] — extract columns',
  awk: "awk '{print $N}' [file] — extract whitespace-separated fields",
  sed: "sed 's/pattern/replacement/g' [file] — stream-edit text (prints result)",
  jobs: 'jobs — list this shell’s background jobs',
  fg: 'fg [%n] — bring a job to the foreground',
  bg: 'bg [%n] — resume a stopped job in the background',
  export: 'export NAME=value — set an environment variable',
  env: 'env — print environment variables',
  history: 'history — show command history (!! repeats the last command)',
  which: 'which <cmd> — locate a command',
  man: 'man <cmd> — short manual for a command',
  help: 'help — list available commands',
  clear: 'clear — clear the screen (or Ctrl-L)',
  tree: 'tree [path] — draw the directory tree',
  xargs: 'xargs <cmd> — run cmd with stdin words as extra arguments',
  date: 'date — print the current date/time',
  whoami: 'whoami — print your username',
  tmux: 'tmux [new -s name | ls | attach -t name | kill-session -t name]',
  sleep: 'sleep <seconds> — do nothing, slowly',
};

export class Shell {
  constructor(kernel, { cwd, onEvent } = {}) {
    this.k = kernel;
    this.cwd = cwd || kernel.env.HOME;
    this.env = kernel.env; // shared environment (keeps the game simple)
    this.history = [];
    this.jobs = [];
    this.nextJobId = 1;
    this.onEvent = onEvent || null; // used for tmux commands reaching the runner
    this.lastCode = 0;
  }

  prompt() {
    let p = this.cwd;
    const home = this.env.HOME;
    if (p === home) p = '~';
    else if (p.startsWith(home + '/')) p = '~' + p.slice(home.length);
    return p;
  }

  // Execute a full command line. Returns:
  //   { out: string[] }                 — finished, output lines
  //   { out: string[], fgProc: proc }   — a foreground process took over
  //   { out: [], clear: true }          — clear-screen request
  execute(rawLine) {
    let line = rawLine.trim();
    if (!line) return { out: [] };

    const echoed = [];
    if (line.includes('!!') || line.includes('!$')) {
      const last = this.history[this.history.length - 1];
      if (!last) return { out: ['zsh: no previous command'] };
      line = line.replace(/!!/g, last).replace(/!\$/g, last.trim().split(/\s+/).pop());
      echoed.push(line);
    }
    this.history.push(line);
    this.k.emit({ type: 'cmd', line, shell: this });

    const chains = splitChains(line);
    const out = [...echoed];
    let clear = false;
    for (const { seg, cond } of chains) {
      if (cond === '&&' && this.lastCode !== 0) continue;
      const res = this.runPipeline(seg);
      if (res.clear) { clear = true; continue; }
      if (res.out) out.push(...res.out);
      if (res.fgProc) return { out, fgProc: res.fgProc };
    }
    return clear ? { out, clear: true } : { out };
  }

  runPipeline(segment) {
    let seg = segment.trim();
    let bg = false;
    if (seg.endsWith('&')) { bg = true; seg = seg.slice(0, -1).trim(); }
    if (seg.includes('$(')) seg = this.expandSubst(seg);
    const stages = splitTop(seg, '|');
    if (stages.length > 1) {
      this.k.emit({ type: 'pipeline', cmds: stages.map((s) => s.trim().split(/\s+/)[0]) });
    }

    let stdin = '';
    let lastOut = '';
    for (let i = 0; i < stages.length; i++) {
      const parsed = this.parseStage(stages[i]);
      if (parsed.error) { this.lastCode = 1; return { out: [parsed.error] }; }
      const { argv, redirect } = parsed;
      if (!argv.length) continue;

      const result = this.runCommand(argv, stdin, { bg: bg && i === stages.length - 1 });
      if (result.fgProc) return result; // programs can't sit mid-pipeline; fine for the game
      if (result.clear) return result;
      this.lastCode = result.code || 0;
      lastOut = result.out || '';

      if (redirect) {
        const abs = this.k.vfs.resolve(redirect.file, this.cwd, this.env.HOME);
        const text = lastOut.length ? lastOut + '\n' : '';
        const ok = this.k.vfs.write(abs, text, { append: redirect.append });
        this.k.emit({ type: 'redirect', op: redirect.append ? '>>' : '>', path: abs });
        if (!ok) return { out: [`zsh: cannot write: ${redirect.file}`] };
        lastOut = '';
      }
      stdin = lastOut;
    }
    return { out: lastOut === '' ? [] : lastOut.split('\n') };
  }

  parseStage(stage) {
    const tokens = tokenize(stage, this.env);
    if (tokens.error) return { error: tokens.error };
    // Redirects
    let redirect = null;
    const argv = [];
    for (let i = 0; i < tokens.list.length; i++) {
      const t = tokens.list[i];
      if (!t.quoted && (t.text === '>' || t.text === '>>')) {
        const target = tokens.list[i + 1];
        if (!target) return { error: 'zsh: parse error near redirect' };
        redirect = { append: t.text === '>>', file: target.text };
        i++;
        continue;
      }
      if (!t.quoted && t.text.includes('*')) {
        argv.push(...this.k.vfs.glob(t.text, this.cwd, this.env.HOME));
      } else {
        argv.push(t.text);
      }
    }
    return { argv, redirect };
  }

  runCommand(argv, stdin, { bg = false } = {}) {
    const name = argv[0];

    // export FOO=bar / bare FOO=bar
    if (name === 'export' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) {
      const assigns = name === 'export' ? argv.slice(1) : argv;
      for (const a of assigns) {
        const m = a.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) {
          this.env[m[1]] = m[2];
          this.k.emit({ type: 'export', key: m[1], value: m[2] });
        }
      }
      return { out: '', code: 0 };
    }

    if (BUILTINS[name]) return BUILTINS[name](this, argv.slice(1), stdin);

    // Executable program in the vfs (./agents/foo.sh, /usr/local/bin/foo)
    if (name.includes('/')) {
      const abs = this.k.vfs.resolve(name, this.cwd, this.env.HOME);
      const node = this.k.vfs.get(abs);
      if (!node) return { out: `zsh: no such file or directory: ${name}`, code: 127 };
      if (node.type !== 'file' || !node.exec) return { out: `zsh: permission denied: ${name}`, code: 126 };
      const factory = this.k.programs[abs];
      if (!factory) return { out: `${name}: nothing happens (this script isn’t part of the mission)`, code: 0 };
      const program = factory(argv, this.k);
      if (program.immediateError) return { out: program.immediateError, code: 1 };
      const proc = this.k.spawn({ cmd: argv.join(' '), name: program.name, program, shell: this, bg });
      if (bg) return { out: `[${proc.jobId}] ${proc.pid}`, code: 0 };
      return { out: '', code: 0, fgProc: proc };
    }

    return { out: `zsh: command not found: ${name}`, code: 127 };
  }

  // Command substitution: replace $(cmd) with the command's output.
  expandSubst(seg) {
    this._substDepth = (this._substDepth || 0) + 1;
    if (this._substDepth > 3) { this._substDepth--; return seg; }
    let out = '';
    let i = 0;
    while (i < seg.length) {
      if (seg[i] === '$' && seg[i + 1] === '(') {
        let depth = 1;
        let j = i + 2;
        while (j < seg.length && depth) {
          if (seg[j] === '(') depth++;
          else if (seg[j] === ')') depth--;
          j++;
        }
        const inner = seg.slice(i + 2, j - 1);
        const res = this.runPipeline(inner);
        if (res.fgProc) res.fgProc.status = 'done'; // no interactive programs inside $()
        this.k.emit({ type: 'subst', inner });
        out += (res.out || []).join(' ').trim();
        i = j;
      } else {
        out += seg[i];
        i++;
      }
    }
    this._substDepth--;
    return out;
  }

  resolvePath(p) {
    return this.k.vfs.resolve(p, this.cwd, this.env.HOME);
  }
}

// --- parsing helpers -------------------------------------------------------

// Split on ; and && at the top level (quote-aware).
function splitChains(line) {
  const parts = [];
  let cur = '';
  let q = null;
  let cond = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '&' && line[i + 1] === '&') {
      parts.push({ seg: cur, cond }); cur = ''; cond = '&&'; i++; continue;
    }
    if (ch === ';') { parts.push({ seg: cur, cond }); cur = ''; cond = ';'; continue; }
    cur += ch;
  }
  parts.push({ seg: cur, cond });
  return parts.filter((p) => p.seg.trim());
}

// Split on a single-char separator at the top level (quote-aware).
function splitTop(line, sep) {
  const parts = [];
  let cur = '';
  let q = null;
  for (const ch of line) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === sep) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// Tokenize with quote handling and $VAR expansion (not inside single quotes).
function tokenize(stage, env) {
  const list = [];
  let cur = '';
  let started = false;
  let quoted = false;
  let i = 0;
  const s = stage;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return { error: 'zsh: unmatched ’' };
      cur += s.slice(i + 1, end);
      started = true; quoted = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      const end = s.indexOf('"', i + 1);
      if (end === -1) return { error: 'zsh: unmatched "' };
      cur += expandVars(s.slice(i + 1, end), env);
      started = true; quoted = true;
      i = end + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) { list.push({ text: cur, quoted }); cur = ''; started = false; quoted = false; }
      i++;
      continue;
    }
    if (ch === '$') {
      const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*|\?)/);
      if (m) {
        cur += m[1] === '?' ? '0' : (env[m[1]] ?? '');
        started = true;
        i += m[0].length;
        continue;
      }
    }
    if (ch === '~' && !started && (s[i + 1] === '/' || s[i + 1] === undefined || /\s/.test(s[i + 1]))) {
      cur += env.HOME || '~';
      started = true;
      i++;
      continue;
    }
    cur += ch;
    started = true;
    i++;
  }
  if (started) list.push({ text: cur, quoted });
  return { list };
}

function expandVars(text, env) {
  return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => env[name] ?? '');
}

// --- builtins ---------------------------------------------------------------

function parseFlags(args, spec) {
  // spec: string of single-char flags that take no value, e.g. 'rli'
  const flags = {};
  const rest = [];
  for (const a of args) {
    if (/^-[a-zA-Z]+$/.test(a) && [...a.slice(1)].every((c) => spec.includes(c))) {
      for (const c of a.slice(1)) flags[c] = true;
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

function readTarget(sh, path) {
  const abs = sh.resolvePath(path);
  const node = sh.k.vfs.get(abs);
  return { abs, node };
}

const BUILTINS = {
  pwd(sh) { return { out: sh.cwd, code: 0 }; },

  cd(sh, args) {
    const target = args[0] || sh.env.HOME;
    const abs = sh.resolvePath(target);
    if (!sh.k.vfs.isDir(abs)) return { out: `cd: no such directory: ${target}`, code: 1 };
    sh.cwd = abs;
    sh.k.emit({ type: 'cd', path: abs });
    return { out: '', code: 0 };
  },

  ls(sh, args) {
    const { flags, rest } = parseFlags(args, 'la');
    const paths = rest.length ? rest : ['.'];
    const chunks = [];
    const plainFiles = [];
    for (const p of paths) {
      const { abs, node } = readTarget(sh, p);
      if (!node) { chunks.push(`ls: no such file or directory: ${p}`); continue; }
      if (node.type === 'file') { plainFiles.push(p); continue; }
      let names = Object.keys(node.children).sort();
      if (!flags.a) names = names.filter((n) => !n.startsWith('.'));
      if (flags.l) {
        const lines = names.map((n) => {
          const c = node.children[n];
          const mode = c.type === 'dir' ? 'drwxr-xr-x' : (c.exec ? '-rwxr-xr-x' : '-rw-r--r--');
          const size = c.type === 'dir' ? 128 : c.content.length;
          return `${mode}  dev  ${String(size).padStart(6)}  ${n}${c.type === 'dir' ? '/' : ''}`;
        });
        chunks.push(lines.join('\n'));
      } else {
        chunks.push(names.map((n) => n + (node.children[n].type === 'dir' ? '/' : '')).join('  '));
      }
      sh.k.emit({ type: 'ls', path: abs });
    }
    if (plainFiles.length) chunks.unshift(plainFiles.join('  '));
    return { out: chunks.join('\n'), code: 0 };
  },

  cat(sh, args, stdin) {
    if (!args.length) return { out: stdin, code: 0 };
    const chunks = [];
    let code = 0;
    for (const p of args) {
      const { abs, node } = readTarget(sh, p);
      if (!node || node.type !== 'file') { chunks.push(`cat: no such file: ${p}`); code = 1; continue; }
      chunks.push(node.content.replace(/\n$/, ''));
      sh.k.emit({ type: 'read', path: abs });
    }
    return { out: chunks.join('\n'), code };
  },

  echo(sh, args) {
    return { out: args.filter((a) => a !== '-n').join(' '), code: 0 };
  },

  head(sh, args, stdin) { return headTail(sh, args, stdin, 'head'); },

  tail(sh, args, stdin) {
    if (args.includes('-f')) {
      const fileArg = args.filter((a) => a !== '-f' && !a.startsWith('-n') && !/^\d+$/.test(a)).pop();
      if (!fileArg) return { out: 'tail: -f needs a file', code: 1 };
      const { abs, node } = readTarget(sh, fileArg);
      if (!node || node.type !== 'file') return { out: `tail: no such file: ${fileArg}`, code: 1 };
      sh.k.emit({ type: 'read', path: abs });
      sh.k.emit({ type: 'tail-f', path: abs });
      let offset = node.content.length;
      const initial = node.content.replace(/\n$/, '').split('\n').slice(-10);
      const program = {
        name: 'tail',
        cpu: 0.1,
        onTick(proc, kernel) {
          const text = kernel.vfs.read(abs) ?? '';
          if (text.length > offset) {
            const fresh = text.slice(offset).replace(/\n$/, '');
            offset = text.length;
            if (fresh) proc.fgLines.push(...fresh.split('\n'));
          }
        },
      };
      const proc = sh.k.spawn({ cmd: `tail -f ${fileArg}`, name: 'tail', program, shell: sh });
      proc.fgLines.push(...initial);
      return { out: '', code: 0, fgProc: proc };
    }
    return headTail(sh, args, stdin, 'tail');
  },

  grep(sh, args, stdin) {
    const { flags, rest } = parseFlags(args, 'rinvc');
    if (!rest.length) return { out: 'usage: grep [-rinvc] pattern [file...]', code: 2 };
    const pattern = rest[0];
    const files = rest.slice(1);
    const re = new RegExp(escapeForGrep(pattern), flags.i ? 'i' : '');
    const matches = [];

    const scan = (text, label) => {
      const lines = text.replace(/\n$/, '').split('\n');
      let count = 0;
      lines.forEach((l, idx) => {
        const hit = re.test(l);
        if (flags.v ? !hit : hit) {
          count++;
          if (!flags.c) {
            let out = l;
            if (flags.n) out = `${idx + 1}:${out}`;
            if (label) out = `${label}:${out}`;
            matches.push(out);
          }
        }
      });
      if (flags.c) matches.push(label ? `${label}:${count}` : String(count));
      return count;
    };

    let total = 0;
    if (flags.r) {
      const roots = files.length ? files : ['.'];
      for (const rpath of roots) {
        const abs = sh.resolvePath(rpath);
        sh.k.vfs.walk(abs, (p, node) => {
          if (node.type === 'file') total += scan(node.content, relLabel(p, sh));
        });
      }
      sh.k.emit({ type: 'grep', pattern, recursive: true });
    } else if (files.length) {
      const multi = files.length > 1;
      for (const f of files) {
        const { abs, node } = readTarget(sh, f);
        if (!node || node.type !== 'file') { matches.push(`grep: ${f}: no such file`); continue; }
        total += scan(node.content, multi ? f : null);
        sh.k.emit({ type: 'read', path: abs });
      }
      sh.k.emit({ type: 'grep', pattern, recursive: false });
    } else {
      total += scan(stdin ?? '', null);
      sh.k.emit({ type: 'grep', pattern, recursive: false, stdin: true });
    }
    return { out: matches.join('\n'), code: total > 0 ? 0 : 1 };
  },

  find(sh, args) {
    let root = '.';
    let namePat = null;
    let type = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-name') namePat = args[++i];
      else if (args[i] === '-type') type = args[++i];
      else if (!args[i].startsWith('-')) root = args[i];
    }
    const abs = sh.resolvePath(root);
    if (!sh.k.vfs.get(abs)) return { out: `find: no such directory: ${root}`, code: 1 };
    const re = namePat
      ? new RegExp('^' + namePat.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
      : null;
    const results = [];
    sh.k.vfs.walk(abs, (p, node) => {
      if (type === 'f' && node.type !== 'file') return;
      if (type === 'd' && node.type !== 'dir') return;
      const base = p.split('/').filter(Boolean).pop() || '/';
      if (re && !re.test(base)) return;
      results.push(displayPath(p, abs, root));
    });
    sh.k.emit({ type: 'find', name: namePat, root: abs });
    return { out: results.join('\n'), code: 0 };
  },

  wc(sh, args, stdin) {
    const { flags, rest } = parseFlags(args, 'lwc');
    let text = stdin ?? '';
    if (rest.length) {
      const { node } = readTarget(sh, rest[0]);
      if (!node || node.type !== 'file') return { out: `wc: no such file: ${rest[0]}`, code: 1 };
      text = node.content;
    }
    const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
    if (flags.l) return { out: String(lines), code: 0 };
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    return { out: `${lines} ${words} ${text.length}`, code: 0 };
  },

  sort(sh, args, stdin) {
    const { flags, rest } = parseFlags(args, 'rnu');
    let text = stdin ?? '';
    if (rest.length) {
      const { node } = readTarget(sh, rest[0]);
      if (!node) return { out: `sort: no such file: ${rest[0]}`, code: 1 };
      text = node.content;
    }
    let lines = text.replace(/\n$/, '').split('\n').filter((l) => l !== '' || text.trim() !== '');
    lines.sort(flags.n ? (a, b) => parseFloat(a) - parseFloat(b) : undefined);
    if (flags.r) lines.reverse();
    if (flags.u) lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
    return { out: lines.join('\n'), code: 0 };
  },

  uniq(sh, args, stdin) {
    const { flags, rest } = parseFlags(args, 'c');
    let text = stdin ?? '';
    if (rest.length) {
      const { node } = readTarget(sh, rest[0]);
      if (!node) return { out: `uniq: no such file: ${rest[0]}`, code: 1 };
      text = node.content;
    }
    const lines = text.replace(/\n$/, '').split('\n');
    const out = [];
    let prev = null;
    let count = 0;
    const flush = () => {
      if (prev === null) return;
      out.push(flags.c ? `${String(count).padStart(4)} ${prev}` : prev);
    };
    for (const l of lines) {
      if (l === prev) { count++; continue; }
      flush();
      prev = l;
      count = 1;
    }
    flush();
    return { out: out.join('\n'), code: 0 };
  },

  mkdir(sh, args) {
    const { flags, rest } = parseFlags(args, 'p');
    if (!rest.length) return { out: 'usage: mkdir [-p] dir', code: 1 };
    for (const p of rest) {
      const ok = sh.k.vfs.mkdir(sh.resolvePath(p), { parents: flags.p });
      if (!ok) return { out: `mkdir: cannot create: ${p}`, code: 1 };
    }
    return { out: '', code: 0 };
  },

  touch(sh, args) {
    for (const p of args) {
      const abs = sh.resolvePath(p);
      if (!sh.k.vfs.get(abs)) sh.k.vfs.write(abs, '');
    }
    return { out: '', code: 0 };
  },

  rm(sh, args) {
    const { flags, rest } = parseFlags(args, 'rf');
    if (!rest.length) return { out: 'usage: rm [-rf] path', code: 1 };
    for (const p of rest) {
      const abs = sh.resolvePath(p);
      const node = sh.k.vfs.get(abs);
      if (!node) {
        if (!flags.f) return { out: `rm: no such file: ${p}`, code: 1 };
        continue;
      }
      if (node.type === 'dir' && !flags.r) return { out: `rm: ${p}: is a directory (use -r)`, code: 1 };
      sh.k.vfs.remove(abs);
      sh.k.emit({ type: 'rm', path: abs });
    }
    return { out: '', code: 0 };
  },

  cp(sh, args) {
    const { rest } = parseFlags(args, 'r');
    if (rest.length < 2) return { out: 'usage: cp src dst', code: 1 };
    const ok = sh.k.vfs.copy(sh.resolvePath(rest[0]), sh.resolvePath(rest[1]));
    return ok ? { out: '', code: 0 } : { out: `cp: cannot copy ${rest[0]}`, code: 1 };
  },

  mv(sh, args) {
    if (args.length < 2) return { out: 'usage: mv src dst', code: 1 };
    const ok = sh.k.vfs.move(sh.resolvePath(args[0]), sh.resolvePath(args[1]));
    return ok ? { out: '', code: 0 } : { out: `mv: cannot move ${args[0]}`, code: 1 };
  },

  chmod(sh, args) {
    if (args.length < 2) return { out: 'usage: chmod +x file', code: 1 };
    const { node } = readTarget(sh, args[1]);
    if (!node || node.type !== 'file') return { out: `chmod: no such file: ${args[1]}`, code: 1 };
    if (args[0] === '+x') node.exec = true;
    if (args[0] === '-x') node.exec = false;
    sh.k.emit({ type: 'chmod', mode: args[0] });
    return { out: '', code: 0 };
  },

  ps(sh) {
    const rows = ['  PID  %CPU  STAT  COMMAND'];
    for (const p of sh.k.procs) {
      if (p.status !== 'running' && p.status !== 'stopped') continue;
      const stat = p.status === 'running' ? (p.bg ? 'R' : 'R+') : 'T';
      rows.push(`${String(p.pid).padStart(5)}  ${p.cpu.toFixed(1).padStart(4)}  ${stat.padEnd(4)}  ${p.cmd}`);
    }
    sh.k.emit({ type: 'ps' });
    return { out: rows.join('\n'), code: 0 };
  },

  kill(sh, args) {
    const pids = args.filter((a) => /^\d+$/.test(a)).map(Number);
    if (!pids.length) return { out: 'usage: kill [-9] pid', code: 1 };
    const out = [];
    let code = 0;
    for (const pid of pids) {
      if (!sh.k.kill(pid)) { out.push(`kill: ${pid}: no such process`); code = 1; }
    }
    return { out: out.join('\n'), code };
  },

  pgrep(sh, args) {
    const { flags, rest } = parseFlags(args, 'f');
    const pat = rest[0];
    if (!pat) return { out: 'usage: pgrep [-f] pattern', code: 2 };
    const procs = sh.k.procs.filter(
      (p) => (p.status === 'running' || p.status === 'stopped') && (p.name.includes(pat) || (flags.f && p.cmd.includes(pat)))
    );
    sh.k.emit({ type: 'pgrep', pattern: pat, count: procs.length });
    return { out: procs.map((p) => String(p.pid)).join('\n'), code: procs.length ? 0 : 1 };
  },

  pkill(sh, args) {
    const { flags, rest } = parseFlags(args, 'f9');
    const pat = rest[0];
    if (!pat) return { out: 'usage: pkill [-f] pattern', code: 2 };
    const procs = sh.k.procs.filter(
      (p) => (p.status === 'running' || p.status === 'stopped') && (p.name.includes(pat) || (flags.f && p.cmd.includes(pat)))
    );
    for (const p of procs) sh.k.kill(p.pid);
    sh.k.emit({ type: 'pkill', pattern: pat, count: procs.length });
    return { out: '', code: procs.length ? 0 : 1 };
  },

  cut(sh, args, stdin) {
    let delim = '\t';
    let fields = null;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-d') delim = args[++i] ?? '\t';
      else if (a.startsWith('-d') && a.length > 2) delim = a.slice(2);
      else if (a === '-f') fields = args[++i];
      else if (a.startsWith('-f') && a.length > 2) fields = a.slice(2);
      else files.push(a);
    }
    if (!fields) return { out: 'usage: cut -d <delim> -f <N[,M]> [file]', code: 2 };
    const idxs = fields.split(',').map((n) => parseInt(n, 10)).filter((n) => n > 0);
    let text = stdin ?? '';
    if (files.length) {
      const { abs, node } = readTarget(sh, files[0]);
      if (!node || node.type !== 'file') return { out: `cut: no such file: ${files[0]}`, code: 1 };
      text = node.content;
      sh.k.emit({ type: 'read', path: abs });
    }
    const lines = text.replace(/\n$/, '').split('\n');
    sh.k.emit({ type: 'cut', fields });
    return { out: lines.map((l) => idxs.map((n) => l.split(delim)[n - 1] ?? '').join(delim)).join('\n'), code: 0 };
  },

  awk(sh, args, stdin) {
    const prog = args[0] || '';
    const m = prog.match(/^\{\s*print\s+(.*?)\s*\}$/);
    if (!m) return { out: "awk: this sim only supports '{print $N}' (and $N, $M lists)", code: 2 };
    const parts = m[1].split(/\s*,\s*/);
    let text = stdin ?? '';
    if (args[1]) {
      const { abs, node } = readTarget(sh, args[1]);
      if (!node || node.type !== 'file') return { out: `awk: no such file: ${args[1]}`, code: 1 };
      text = node.content;
      sh.k.emit({ type: 'read', path: abs });
    }
    const lines = text.replace(/\n$/, '').split('\n');
    sh.k.emit({ type: 'awk', program: prog });
    const out = lines.map((l) => {
      const f = l.trim().split(/\s+/);
      return parts
        .map((p) => {
          const fm = p.match(/^\$(\d+)$/);
          if (!fm) return p.replace(/^"(.*)"$/, '$1');
          const n = parseInt(fm[1], 10);
          return n === 0 ? l : f[n - 1] ?? '';
        })
        .join(' ');
    });
    return { out: out.join('\n'), code: 0 };
  },

  sed(sh, args, stdin) {
    if (args.includes('-i')) return { out: 'sed: -i is not supported here — redirect to a new file with > instead', code: 2 };
    const expr = args[0] || '';
    const m = expr.match(/^s\/((?:[^/\\]|\\.)*)\/((?:[^/\\]|\\.)*)\/([gi]*)$/);
    if (!m) return { out: "sed: this sim only supports 's/pattern/replacement/[g]'", code: 2 };
    let re;
    try {
      re = new RegExp(m[1], m[3]);
    } catch {
      return { out: `sed: bad pattern: ${m[1]}`, code: 2 };
    }
    let text = stdin ?? '';
    if (args[1]) {
      const { abs, node } = readTarget(sh, args[1]);
      if (!node || node.type !== 'file') return { out: `sed: no such file: ${args[1]}`, code: 1 };
      text = node.content;
      sh.k.emit({ type: 'read', path: abs });
    }
    sh.k.emit({ type: 'sed', expr });
    const lines = text.replace(/\n$/, '').split('\n');
    return { out: lines.map((l) => l.replace(re, m[2])).join('\n'), code: 0 };
  },

  jobs(sh) {
    sh.k.emit({ type: 'jobs' });
    const rows = sh.jobs
      .filter((p) => p.status === 'running' || p.status === 'stopped')
      .map((p) => `[${p.jobId}]  ${p.status === 'running' ? 'Running' : 'Stopped'}    ${p.cmd}${p.status === 'running' && p.bg ? ' &' : ''}`);
    return { out: rows.join('\n'), code: 0 };
  },

  fg(sh, args) {
    const proc = pickJob(sh, args[0]);
    if (!proc) return { out: 'fg: no current job', code: 1 };
    proc.status = 'running';
    proc.bg = false;
    sh.k.emit({ type: 'fg', name: proc.name });
    return { out: proc.cmd, code: 0, fgProc: proc };
  },

  bg(sh, args) {
    const proc = pickJob(sh, args[0], 'stopped');
    if (!proc) return { out: 'bg: no stopped job', code: 1 };
    proc.status = 'running';
    proc.bg = true;
    sh.k.emit({ type: 'bg', name: proc.name });
    return { out: `[${proc.jobId}] ${proc.cmd} &`, code: 0 };
  },

  env(sh) {
    return { out: Object.entries(sh.env).map(([k, v]) => `${k}=${v}`).join('\n'), code: 0 };
  },

  history(sh) {
    return { out: sh.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'), code: 0 };
  },

  which(sh, args) {
    if (!args.length) return { out: 'usage: which cmd', code: 1 };
    if (BUILTINS[args[0]]) return { out: `/usr/bin/${args[0]}`, code: 0 };
    return { out: `${args[0]} not found`, code: 1 };
  },

  man(sh, args) {
    if (!args.length) return { out: 'What manual page do you want?', code: 1 };
    return { out: HELP[args[0]] || `No manual entry for ${args[0]}`, code: 0 };
  },

  help() {
    return { out: 'Available commands:\n' + Object.values(HELP).map((h) => '  ' + h).join('\n'), code: 0 };
  },

  clear() { return { out: '', code: 0, clear: true }; },

  tree(sh, args) {
    const root = sh.resolvePath(args[0] || '.');
    const node = sh.k.vfs.get(root);
    if (!node) return { out: `tree: no such directory`, code: 1 };
    const lines = [args[0] || '.'];
    const draw = (n, prefix) => {
      const names = Object.keys(n.children).filter((x) => !x.startsWith('.')).sort();
      names.forEach((name, i) => {
        const last = i === names.length - 1;
        const child = n.children[name];
        lines.push(prefix + (last ? '└── ' : '├── ') + name + (child.type === 'dir' ? '/' : ''));
        if (child.type === 'dir') draw(child, prefix + (last ? '    ' : '│   '));
      });
    };
    if (node.type === 'dir') draw(node, '');
    return { out: lines.join('\n'), code: 0 };
  },

  xargs(sh, args, stdin) {
    if (!args.length) return { out: 'usage: ... | xargs cmd [args]', code: 1 };
    const extra = (stdin ?? '').trim().split(/\s+/).filter(Boolean);
    sh.k.emit({ type: 'xargs', cmd: args[0] });
    return sh.runCommand([...args, ...extra], '', {});
  },

  date() {
    return { out: new Date().toString(), code: 0 };
  },

  whoami(sh) { return { out: sh.env.USER, code: 0 }; },

  sleep(sh, args) {
    const secs = parseFloat(args[0]) || 1;
    let remaining = Math.max(1, Math.round(secs * 4)); // 4 ticks/second
    const program = {
      name: 'sleep',
      cpu: 0.0,
      onTick(proc) {
        if (--remaining <= 0) proc.status = 'done';
      },
    };
    const proc = sh.k.spawn({ cmd: `sleep ${args[0] || 1}`, name: 'sleep', program, shell: sh });
    return { out: '', code: 0, fgProc: proc };
  },

  tmux(sh, args) {
    if (!sh.onEvent) return { out: 'tmux: not available in this mission', code: 1 };
    return sh.onEvent({ type: 'tmux', args }) || { out: '', code: 0 };
  },

  vim() {
    return { out: 'The vim dojo lives in the VIM world — pick it from the home screen. 🥋', code: 0 };
  },
};

function headTail(sh, args, stdin, which) {
  let n = 10;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n') { n = parseInt(args[++i], 10) || 10; continue; }
    const m = args[i].match(/^-n?(\d+)$/);
    if (m) { n = parseInt(m[1], 10); continue; }
    rest.push(args[i]);
  }
  let text = stdin ?? '';
  if (rest.length) {
    const { abs, node } = readTarget(sh, rest[0]);
    if (!node || node.type !== 'file') return { out: `${which}: no such file: ${rest[0]}`, code: 1 };
    text = node.content;
    sh.k.emit({ type: 'read', path: abs });
  }
  const lines = text.replace(/\n$/, '').split('\n');
  const slice = which === 'head' ? lines.slice(0, n) : lines.slice(-n);
  return { out: slice.join('\n'), code: 0 };
}

function pickJob(sh, spec, wantStatus) {
  const live = sh.jobs.filter((p) => p.status === 'running' || p.status === 'stopped');
  let pool = live;
  if (wantStatus) pool = live.filter((p) => p.status === wantStatus);
  if (spec && /^%\d+$/.test(spec)) {
    return pool.find((p) => p.jobId === parseInt(spec.slice(1), 10)) || null;
  }
  return pool[pool.length - 1] || null;
}

function escapeForGrep(pattern) {
  // Treat the pattern as a literal string — regex metachars in it are escaped.
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relLabel(absPath, sh) {
  if (absPath.startsWith(sh.cwd + '/')) return './' + absPath.slice(sh.cwd.length + 1);
  return absPath;
}

function displayPath(p, absRoot, typedRoot) {
  if (p === absRoot) return typedRoot;
  const suffix = p.slice(absRoot.length === 1 ? 1 : absRoot.length + 1);
  if (typedRoot === '.') return './' + suffix;
  return typedRoot.replace(/\/$/, '') + '/' + suffix;
}
