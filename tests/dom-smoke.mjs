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
