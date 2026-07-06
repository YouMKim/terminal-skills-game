// Integration smoke: run the three level runners against a minimal DOM stub,
// simulate real keystrokes, and assert the levels can actually be won.
// Run: node tests/dom-smoke.mjs

class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = {};
    this._cls = '';
    this._html = '';
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {} };
    this.scrollTop = 0;
  }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  set className(v) { this._cls = v; }
  get className() { return this._cls; }
  appendChild(c) { this.children.push(c); return c; }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
  get scrollHeight() { return 100; }
  get clientHeight() { return 50; }
  querySelector() { return null; }
  textContent = '';
}

globalThis.document = { createElement: (t) => new El(t) };

const { VimRunner, ShellRunner, TmuxRunner } = await import('../js/runners.js');
const { VIM_LEVELS } = await import('../js/levels/vim-levels.js');
const { SHELL_LEVELS } = await import('../js/levels/shell-levels.js');
const { TMUX_LEVELS } = await import('../js/levels/tmux-levels.js');

let failures = 0;
let count = 0;
function ok(cond, label) {
  count++;
  if (!cond) { failures++; console.error(`✗ ${label}`); }
}

function key(runner, k, mods = {}) {
  runner.handleKey({ key: k, ctrlKey: !!mods.ctrl, metaKey: false });
}

function type(runner, text) {
  for (const ch of text) key(runner, ch);
  key(runner, 'Enter');
}

function ticks(runner, n) {
  for (let i = 0; i < n; i++) runner.tick();
}

// --- Vim: solve level 7 (Exterminator) with real keystrokes -------------------

{
  const lvl = VIM_LEVELS.find((l) => l.id === 'vim/7');
  let won = false;
  const el = new El('div');
  const r = new VimRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  // 'const fleet = BUG spawn(3);' → delete 'BUG '
  for (const k of ['f', 'B', 'd', 'w']) key(r, k);
  // delete the junk line 2
  key(r, 'j'); key(r, '0'); key(r, 'd'); key(r, 'd');
  // 'let ready == false;' → delete one '='
  for (const k of ['f', '=', 'x']) key(r, k);
  // 'await fleet.launch(); // BUG BUG BUG' → D from the space before //
  key(r, 'j'); key(r, '0');
  for (const k of ['f', '/', 'h', 'D']) key(r, k);
  // 'ALSO THIS LINE IS GARBAGE' → dd
  key(r, 'j'); key(r, 'd'); key(r, 'd');
  // 'return fleet.statusxx;' → remove xx
  for (const k of ['f', 'x', 'x', 'x']) key(r, k);
  ok(won, `vim/7 solvable with real keystrokes (buffer: ${JSON.stringify(r.vim.lines)})`);
}

// --- Vim: arrow keys rejected, locked keys rejected ----------------------------

{
  const lvl = VIM_LEVELS[0];
  const el = new El('div');
  const r = new VimRunner(el, lvl, { onChange: () => {}, onWin: () => {} });
  const before = [r.vim.r, r.vim.c];
  key(r, 'ArrowLeft');
  ok(r.vim.r === before[0] && r.vim.c === before[1], 'vim arrows do not move');
  key(r, 'd'); // not unlocked in level 1
  ok(r.vim.op === null, 'vim locked key ignored');
  key(r, 'h');
  ok(r.vim.c === before[1] - 1, 'vim allowed key moves');
}

// --- Vim: solve The Dot (vim/16) with j. j. -------------------------------------

{
  const lvl = VIM_LEVELS.find((l) => l.id === 'vim/16');
  let won = false;
  const el = new El('div');
  const r = new VimRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  for (const k of ['A', ';', 'Escape', 'j', '.', 'j', '.', 'j', 'j', '.', 'j', '.', 'k', '>', '>', 'j', '.']) key(r, k);
  ok(won, `vim/16 dot level solvable (buffer: ${JSON.stringify(r.vim.lines)})`);
}

// --- Vim: solve Teleporter (vim/18): % * marks ------------------------------------

{
  const lvl = VIM_LEVELS.find((l) => l.id === 'vim/18');
  let won = false;
  const el = new El('div');
  const r = new VimRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  for (const k of ['%', '0', 'f', 'c', '*', '*', 'm', 'a', 'k', 'f', '{', '%', '`', 'a']) key(r, k);
  ok(won, `vim/18 teleporter solvable (gems: ${r.gems.filter((g) => g.got).length}/${r.gems.length})`);
}

// --- Vim: solve Macro Machine (vim/19) ---------------------------------------------

{
  const lvl = VIM_LEVELS.find((l) => l.id === 'vim/19');
  let won = false;
  const el = new El('div');
  const r = new VimRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  for (const k of ['q', 'a', '0', 'd', 'w', 'i', '-', ' ', '[', ' ', ']', ' ', 'Escape', 'j', 'q', '3', '@', 'a']) key(r, k);
  ok(won, `vim/19 macro level solvable (buffer: ${JSON.stringify(r.vim.lines)})`);
}

// --- Vim: solve Inner Peace (vim/17): text objects ----------------------------------

{
  const lvl = VIM_LEVELS.find((l) => l.id === 'vim/17');
  let won = false;
  const el = new El('div');
  const r = new VimRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  const script = [
    'f', '"', 'c', 'i', '"', ...'hi there', 'Escape',        // "hello wrold" → "hi there"
    'j', '0', 'f', "'", 'c', 'i', "'", ...'turbo', 'Escape', // 'slow' → 'turbo'
    'j', '0', 'f', '(', 'd', 'i', '(',                       // cleanup(...) → cleanup()
    'j', '0', 'f', 'n', 'c', 'i', 'w', ...'null', 'Escape',  // nil → null
  ];
  for (const k of script) key(r, k);
  ok(won, `vim/17 text objects solvable (buffer: ${JSON.stringify(r.vim.lines)})`);
}

// --- Shell: solve level 1 (Wayfinder) ------------------------------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/1');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'pwd');
  type(r, 'ls');
  type(r, 'cd missions');
  type(r, 'cat day-01/briefing.txt');
  ok(won, 'shell/1 solvable');
}

// --- Shell: solve level 6 (Backgrounder: & jobs fg Ctrl-Z bg) --------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/6');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, './agents/crawler.sh &');
  ticks(r, 5);
  type(r, 'jobs');
  type(r, 'fg');
  ticks(r, 3);
  key(r, 'z', { ctrl: true }); // Ctrl-Z suspend
  ticks(r, 2);
  type(r, 'bg');
  ticks(r, 2);
  ok(won, 'shell/6 solvable (job control loop)');
}

// --- Shell: level 7 (tail -f, Ctrl-C, verdict) -----------------------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/7');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  ticks(r, 10);
  type(r, 'tail -f /var/log/fleet.log');
  ticks(r, 15);
  key(r, 'c', { ctrl: true }); // Ctrl-C
  type(r, 'echo beta > suspect.txt');
  ok(won, 'shell/7 solvable (tail -f + Ctrl-C)');
}

// --- Shell: level 9 readline shortcuts --------------------------------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/9');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  key(r, 'ArrowUp'); // history
  key(r, 'a', { ctrl: true });
  key(r, 'e', { ctrl: true });
  key(r, 'u', { ctrl: true });
  type(r, './agents/deploy.sh --env prod');
  ticks(r, 5);
  ok(won, 'shell/9 solvable (readline drills)');
}

// --- Shell: solve Chain Reaction (shell/11: xargs + chmod) --------------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/11');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'find . -name "*.tmp" | wc -l');
  type(r, 'find . -name "*.tmp" | xargs rm');
  type(r, 'chmod +x agents/cleanup.sh');
  type(r, './agents/cleanup.sh');
  ticks(r, 5);
  ok(won, 'shell/11 solvable (xargs + chmod)');
}

// --- Shell: solve Substitution Cipher (shell/12) -------------------------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/12');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'echo "operator: $(whoami)"');
  type(r, 'pgrep imposter');
  type(r, 'kill $(pgrep imposter)');
  type(r, 'ps');
  ok(won, 'shell/12 solvable (kill $(pgrep ...))');
}

// --- Shell: solve Field Surgeon (shell/13) --------------------------------------------

{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/13');
  let won = false;
  const el = new El('div');
  const r = new ShellRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, "awk '{print $1}' logs/access.log");
  type(r, 'cut -d" " -f2 logs/access.log');
  type(r, "awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn");
  type(r, "awk '{print $1}' logs/access.log | sed 's/agent-//' | sort | uniq -c | sort -rn");
  type(r, 'echo beta > offender.txt');
  ok(won, 'shell/13 solvable (awk/cut/sed)');
}

// --- Tmux: solve level 1 (enter, run, detach, ls, attach) ---------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/1');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  ok(r.tmux.attached, 'tmux/1 attached after `tmux`');
  type(r, 'ls'); // runs inside the pane
  key(r, 'b', { ctrl: true }); key(r, 'd'); // detach
  ok(!r.tmux.attached, 'tmux/1 detached after C-b d');
  type(r, 'tmux ls');
  type(r, 'tmux attach');
  ok(r.tmux.attached, 'tmux/1 reattached');
  ok(won, 'tmux/1 solvable');
}

// --- Tmux: level 2 splits + navigation ------------------------------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/2');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  key(r, 'b', { ctrl: true }); key(r, '%');
  key(r, 'b', { ctrl: true }); key(r, '"');
  ok(r.tmux.panes().length === 3, 'tmux/2 three panes exist');
  // run a command in each pane, cycling with C-b o
  for (let i = 0; i < 3; i++) {
    type(r, 'echo hi');
    key(r, 'b', { ctrl: true }); key(r, 'o');
  }
  ok(won, 'tmux/2 solvable');
}

// --- Tmux: level 5 windows + rename ----------------------------------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/5');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  const rename = (name) => {
    key(r, 'b', { ctrl: true }); key(r, ',');
    for (let i = 0; i < 20; i++) key(r, 'Backspace');
    for (const ch of name) key(r, ch);
    key(r, 'Enter');
  };
  rename('code');
  key(r, 'b', { ctrl: true }); key(r, 'c');
  rename('logs');
  key(r, 'b', { ctrl: true }); key(r, 'c');
  rename('scratch');
  key(r, 'b', { ctrl: true }); key(r, '0');
  ok(won, `tmux/5 solvable (windows: ${r.tmux.attached ? r.tmux.attached.windows.map((w) => w.name).join(',') : 'detached'})`);
}

// --- Tmux: solve Time Scroller (tmux/9: copy mode) ------------------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/9');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  type(r, 'cat /var/log/boot.log');
  key(r, 'b', { ctrl: true }); key(r, '[');
  key(r, 'g'); // jump to top of scrollback
  key(r, 'q'); // exit copy mode
  type(r, 'echo ORION-9 > code.txt');
  ok(won, 'tmux/9 solvable (copy-mode scrollback)');
}

// --- Tmux: solve The Command Line Within (tmux/10) --------------------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/10');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  const prompt = (cmd) => {
    key(r, 'b', { ctrl: true }); key(r, ':');
    for (const ch of cmd) key(r, ch);
    key(r, 'Enter');
  };
  prompt('split-window -h');
  prompt('rename-window ops');
  prompt('resize-pane -L 10');
  ok(won, 'tmux/10 solvable (command prompt)');
}

// --- Tmux: solve Hive Mind (tmux/11: synchronize-panes) ----------------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/11');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  key(r, 'b', { ctrl: true }); key(r, '%');
  key(r, 'b', { ctrl: true }); key(r, '"');
  const prompt = (cmd) => {
    key(r, 'b', { ctrl: true }); key(r, ':');
    for (const ch of cmd) key(r, ch);
    key(r, 'Enter');
  };
  prompt('setw synchronize-panes on');
  type(r, 'echo sync-check');
  const histories = r.tmux.panes().map((p) => p.shell.history.length);
  ok(histories.every((h) => h >= 1), `tmux/11 broadcast reached all panes (${histories.join(',')})`);
  prompt('setw synchronize-panes off');
  ok(won, 'tmux/11 solvable (synchronize-panes)');
}

// --- Tmux: level 8 boss --------------------------------------------------------------

{
  const lvl = TMUX_LEVELS.find((l) => l.id === 'tmux/8');
  let won = false;
  const el = new El('div');
  const r = new TmuxRunner(el, lvl, { onChange: () => {}, onWin: () => { won = true; } });
  type(r, 'tmux');
  key(r, 'b', { ctrl: true }); key(r, '%');
  key(r, 'b', { ctrl: true }); key(r, '"');
  key(r, 'b', { ctrl: true }); key(r, 'o');
  key(r, 'b', { ctrl: true }); key(r, '"');
  ok(r.tmux.panes().length === 4, 'tmux/8 four panes');
  type(r, 'tail -f /var/log/alpha.log');
  key(r, 'b', { ctrl: true }); key(r, 'o');
  type(r, 'tail -f /var/log/beta.log');
  key(r, 'b', { ctrl: true }); key(r, 'o');
  type(r, 'tail -f /var/log/gamma.log');
  key(r, 'b', { ctrl: true }); key(r, 'o');
  ticks(r, 20); // let beta melt down
  const beta = r.k.procs.find((p) => p.name === 'beta' && p.status === 'running');
  ok(beta && beta.cpu > 50, 'tmux/8 beta melts down');
  type(r, `kill ${beta.pid}`);
  type(r, './agents/beta.sh &');
  ticks(r, 5);
  ok(won, 'tmux/8 boss solvable');
}

if (failures) {
  console.error(`\n${failures}/${count} integration checks FAILED`);
  process.exit(1);
} else {
  console.log(`all ${count} integration checks passed ✔`);
}
