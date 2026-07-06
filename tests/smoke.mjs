// Node smoke tests for the pure-logic engines. Run: node tests/smoke.mjs
import { VFS, dir, file } from '../js/engine/vfs.js';
import { Kernel, Shell } from '../js/engine/shell.js';
import { Vim } from '../js/engine/vim.js';
import { VIM_LEVELS } from '../js/levels/vim-levels.js';
import { SHELL_LEVELS } from '../js/levels/shell-levels.js';
import { TMUX_LEVELS } from '../js/levels/tmux-levels.js';

let failures = 0;
let count = 0;

function eq(actual, expected, label) {
  count++;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures++;
    console.error(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
  }
}

function ok(cond, label) {
  count++;
  if (!cond) {
    failures++;
    console.error(`✗ ${label}`);
  }
}

// --- VFS -----------------------------------------------------------------

{
  const vfs = new VFS(dir({ home: dir({ dev: dir({ 'a.txt': file('hello\n'), sub: dir({ 'b.txt': file('bee\n') }) }) }) }));
  eq(vfs.resolve('sub/../a.txt', '/home/dev'), '/home/dev/a.txt', 'vfs resolve ..');
  eq(vfs.resolve('~/sub', '/', '/home/dev'), '/home/dev/sub', 'vfs resolve ~');
  eq(vfs.read('/home/dev/a.txt'), 'hello\n', 'vfs read');
  ok(vfs.isDir('/home/dev/sub'), 'vfs isDir');
  vfs.write('/home/dev/new.txt', 'x');
  eq(vfs.read('/home/dev/new.txt'), 'x', 'vfs write new file');
  vfs.append('/home/dev/new.txt', 'y');
  eq(vfs.read('/home/dev/new.txt'), 'xy', 'vfs append');
  vfs.mkdir('/home/dev/d1/d2', { parents: true });
  ok(vfs.isDir('/home/dev/d1/d2'), 'vfs mkdir -p');
  eq(vfs.glob('*.txt', '/home/dev', '/home/dev').sort(), ['a.txt', 'new.txt'], 'vfs glob');
}

// --- Shell ------------------------------------------------------------------

{
  const vfs = new VFS(dir({
    home: dir({ dev: dir({
      'log.txt': file('ERROR one\nINFO two\nERROR three\nWARN four\n'),
      docs: dir({ 'deep.txt': file('needle here\n') }),
    }) }),
  }));
  const k = new Kernel(vfs);
  const sh = new Shell(k);

  eq(sh.execute('pwd').out, ['/home/dev'], 'shell pwd');
  eq(sh.execute('echo hello world').out, ['hello world'], 'shell echo');
  eq(sh.execute('grep ERROR log.txt | wc -l').out, ['2'], 'shell pipe grep|wc');
  eq(sh.execute('cat log.txt | grep -v ERROR | wc -l').out, ['2'], 'shell 3-stage pipe');
  sh.execute('grep ERROR log.txt > errs.txt');
  eq(vfs.read('/home/dev/errs.txt'), 'ERROR one\nERROR three\n', 'shell redirect >');
  sh.execute('echo more >> errs.txt');
  ok(vfs.read('/home/dev/errs.txt').endsWith('more\n'), 'shell redirect >>');
  eq(sh.execute('cd docs && pwd').out, ['/home/dev/docs'], 'shell cd && pwd');
  sh.execute('cd ..');
  eq(sh.execute('grep -r needle .').out, ['./docs/deep.txt:needle here'], 'shell grep -r');
  eq(sh.execute('find . -name "*.txt" -type f').out.length, 3, 'shell find -name');
  sh.execute('export FOO=bar');
  eq(sh.execute('echo $FOO').out, ['bar'], 'shell env expansion');
  eq(sh.execute("echo '$FOO'").out, ['$FOO'], 'shell single-quote no expansion');
  eq(sh.execute('echo "val: $FOO"').out, ['val: bar'], 'shell double-quote expansion');
  eq(sh.execute('sort log.txt | uniq -c').out.length, 4, 'shell sort|uniq -c');
  eq(sh.execute('ls *.txt').out, ['errs.txt  log.txt'], 'shell glob args');
  ok(sh.execute('nosuchcmd').out[0].includes('command not found'), 'shell unknown cmd');
  eq(sh.execute('head -2 log.txt').out, ['ERROR one', 'INFO two'], 'shell head -2');
  eq(sh.execute('tail -n 1 log.txt').out, ['WARN four'], 'shell tail -n 1');
  eq(sh.execute('echo a; echo b').out, ['a', 'b'], 'shell ; chaining');

  // processes + jobs
  vfs.write('/home/dev/run.sh', '#!/bin/sh\n');
  vfs.get('/home/dev/run.sh').exec = true;
  k.registerProgram('/home/dev/run.sh', () => ({ name: 'runner', cpu: 5, onTick() {} }));
  const bgRes = sh.execute('./run.sh &');
  ok(/^\[1\] \d+/.test(bgRes.out[0]), 'shell bg spawn output');
  ok(sh.execute('jobs').out[0].includes('runner') || sh.execute('jobs').out[0].includes('run.sh'), 'shell jobs lists');
  const psOut = sh.execute('ps').out;
  ok(psOut.some((l) => l.includes('run.sh')), 'shell ps lists proc');
  const pid = k.procs.find((p) => p.name === 'runner').pid;
  sh.execute(`kill ${pid}`);
  eq(k.procs.find((p) => p.name === 'runner').status, 'killed', 'shell kill');

  // tail -f behaves like a foreground proc
  const tf = sh.execute('tail -f log.txt');
  ok(tf.fgProc && tf.fgProc.name === 'tail', 'tail -f gives fg proc');
  vfs.append('/home/dev/log.txt', 'FRESH line\n');
  k.tick();
  ok(tf.fgProc.fgLines.some((l) => l.includes('FRESH')), 'tail -f picks up appended lines');
  tf.fgProc.status = 'killed';

  // xargs (log.txt gained a 5th line from the tail -f test above)
  eq(sh.execute('echo log.txt | xargs wc -l').out, ['5'], 'shell xargs');

  // command substitution
  eq(sh.execute('echo $(echo hi)').out, ['hi'], 'shell $() substitution');
  eq(sh.execute('echo n=$(grep -c ERROR log.txt)').out, ['n=2'], 'shell $() inline');

  // pgrep / pkill
  k.spawn({ cmd: './imp-a.sh', name: 'imposter-a', bg: true, program: { name: 'imposter-a', cpu: 9, onTick() {} } });
  k.spawn({ cmd: './imp-b.sh', name: 'imposter-b', bg: true, program: { name: 'imposter-b', cpu: 9, onTick() {} } });
  eq(sh.execute('pgrep imposter').out.length, 2, 'shell pgrep finds both');
  sh.execute('kill $(pgrep imposter)');
  ok(k.procs.filter((p) => p.name.startsWith('imposter')).every((p) => p.status === 'killed'), 'shell kill $(pgrep)');

  // cut / awk / sed
  vfs.write('/home/dev/cols.log', 'agent-a 12ms ok\nagent-b 40ms retry\n');
  eq(sh.execute("awk '{print $1}' cols.log").out, ['agent-a', 'agent-b'], 'shell awk $1');
  eq(sh.execute("awk '{print $2, $3}' cols.log").out, ['12ms ok', '40ms retry'], 'shell awk $2,$3');
  eq(sh.execute("cut -d' ' -f2 cols.log").out, ['12ms', '40ms'], 'shell cut -d -f');
  eq(sh.execute("sed 's/agent-//' cols.log").out, ['a 12ms ok', 'b 40ms retry'], 'shell sed s///');
  eq(sh.execute("awk '{print $1}' cols.log | sed 's/agent-//' | sort").out, ['a', 'b'], 'shell awk|sed|sort chain');

  // !$ — last argument of the previous command
  sh.execute('ls cols.log');
  eq(sh.execute('wc -l !$').out.pop(), '2', 'shell !$ expansion');
}

// --- Vim: motions -------------------------------------------------------------

function vimWith(lines, cursor = [0, 0]) {
  return new Vim({ lines, cursor });
}

function press(vm, keys) {
  for (const k of keys) {
    if (k === '<esc>') vm.key('Escape');
    else if (k === '<cr>') vm.key('Enter');
    else if (k === '<c-r>') vm.key('r', { ctrl: true });
    else vm.key(k);
  }
}

function seq(str) {
  // split "dd" style strings into single chars; use arrays for special keys
  return str.split('');
}

{
  const vm = vimWith(['abc def', 'ghi'], [0, 0]);
  press(vm, seq('llll'));
  eq([vm.r, vm.c], [0, 4], 'vim l movement');
  press(vm, seq('j'));
  eq([vm.r, vm.c], [1, 2], 'vim j clamps col');
  press(vm, seq('k0'));
  eq([vm.r, vm.c], [0, 0], 'vim k and 0');
  press(vm, seq('$'));
  eq([vm.r, vm.c], [0, 6], 'vim $');
}

{
  const vm = vimWith(['const agents = spawn(fleet);'], [0, 0]);
  press(vm, seq('w'));
  eq(vm.c, 6, 'vim w to word');
  press(vm, seq('w'));
  eq(vm.c, 13, 'vim w to punct');
  press(vm, seq('b'));
  eq(vm.c, 6, 'vim b back');
  press(vm, seq('e'));
  eq(vm.c, 11, 'vim e word end');
  press(vm, seq('3w'));
  eq(vm.c, 20, 'vim 3w count'); // 11→'='(13)→'spawn'(15)→'('(20)
}

{
  const vm = vimWith(['..x....x..x'], [0, 0]);
  press(vm, ['f', 'x']);
  eq(vm.c, 2, 'vim fx');
  press(vm, [';']);
  eq(vm.c, 7, 'vim ; repeat');
  press(vm, [',']);
  eq(vm.c, 2, 'vim , reverse');
  press(vm, ['t', 'x']);
  eq(vm.c, 6, 'vim tx stops before');
}

{
  const vm = vimWith(['one', 'two', 'three', 'four', 'five'], [2, 0]);
  press(vm, seq('gg'));
  eq(vm.r, 0, 'vim gg');
  press(vm, seq('G'));
  eq(vm.r, 4, 'vim G');
  press(vm, seq('3G'));
  eq(vm.r, 2, 'vim 3G');
}

// --- Vim: edits ------------------------------------------------------------------

{
  const vm = vimWith(['hello world'], [0, 0]);
  press(vm, seq('x'));
  eq(vm.lines[0], 'ello world', 'vim x');
  press(vm, seq('u'));
  eq(vm.lines[0], 'hello world', 'vim undo');
  press(vm, ['<c-r>']);
  eq(vm.lines[0], 'ello world', 'vim redo');
}

{
  const vm = vimWith(['alpha beta gamma'], [0, 0]);
  press(vm, seq('dw'));
  eq(vm.lines[0], 'beta gamma', 'vim dw');
  press(vm, seq('dd'));
  eq(vm.lines, [''], 'vim dd last line');
}

{
  const vm = vimWith(['one', 'two', 'three', 'keep'], [0, 0]);
  press(vm, seq('2dd'));
  eq(vm.lines, ['three', 'keep'], 'vim 2dd');
  press(vm, seq('u'));
  eq(vm.lines, ['one', 'two', 'three', 'keep'], 'vim undo 2dd');
}

{
  const vm = vimWith(['pig.retry = felse;'], [0, 0]);
  press(vm, seq('cw'));
  eq(vm.mode, 'insert', 'vim cw enters insert');
  press(vm, seq('hub'));
  press(vm, ['<esc>']);
  eq(vm.lines[0], 'hub.retry = felse;', 'vim cw replace word');
}

{
  const vm = vimWith(['let pig = 4;'], [0, 5]);
  press(vm, seq('ciw'));
  press(vm, seq('hub'));
  press(vm, ['<esc>']);
  eq(vm.lines[0], 'let hub = 4;', 'vim ciw mid-word');
}

{
  const vm = vimWith(['say "hallo world" now'], [0, 6]);
  press(vm, ['c', 'i', '"']);
  press(vm, seq('bye'));
  press(vm, ['<esc>']);
  eq(vm.lines[0], 'say "bye" now', 'vim ci" quotes');
}

{
  const vm = vimWith(['line one'], [0, 0]);
  press(vm, seq('yyp'));
  eq(vm.lines, ['line one', 'line one'], 'vim yy p');
  press(vm, seq('P'));
  eq(vm.lines.length, 3, 'vim P pastes above');
}

{
  const vm = vimWith(['abc', 'def'], [0, 0]);
  press(vm, ['A']);
  press(vm, seq('!'));
  press(vm, ['<esc>']);
  eq(vm.lines[0], 'abc!', 'vim A append at end');
  press(vm, ['o']);
  press(vm, seq('new'));
  press(vm, ['<esc>']);
  eq(vm.lines, ['abc!', 'new', 'def'], 'vim o opens below');
  press(vm, ['O']);
  press(vm, seq('top'));
  press(vm, ['<esc>']);
  eq(vm.lines, ['abc!', 'top', 'new', 'def'], 'vim O opens above');
}

{
  const vm = vimWith(['hallo'], [0, 1]);
  press(vm, ['r', 'e']);
  eq(vm.lines[0], 'hello', 'vim r replace');
  press(vm, ['~']);
  eq(vm.lines[0], 'hEllo', 'vim ~ toggle case');
}

{
  const vm = vimWith(['start', 'debug 1', 'debug 2', 'end'], [1, 0]);
  press(vm, ['V', 'j', 'd']);
  eq(vm.lines, ['start', 'end'], 'vim V j d linewise visual delete');
}

{
  const vm = vimWith(['find the bug here bug done'], [0, 0]);
  press(vm, ['/']);
  press(vm, seq('bug'));
  press(vm, ['<cr>']);
  eq(vm.c, 9, 'vim /search');
  press(vm, ['n']);
  eq(vm.c, 18, 'vim n next match');
  press(vm, ['n']);
  eq(vm.c, 9, 'vim n wraps');
}

{
  const vm = vimWith(['const data2 = 1;', 'use(data2, data2);'], [0, 0]);
  press(vm, [':']);
  press(vm, seq('%s/data2/payload/g'));
  press(vm, ['<cr>']);
  eq(vm.lines, ['const payload = 1;', 'use(payload, payload);'], 'vim :%s global');
  press(vm, seq('u'));
  eq(vm.lines[0], 'const data2 = 1;', 'vim undo :%s');
}

{
  const vm = vimWith(['keep', 'junkXXXX'], [1, 0]);
  press(vm, ['f', 'X']);
  eq(vm.c, 4, 'vim fX');
  press(vm, seq('4x'));
  eq(vm.lines[1], 'junk', 'vim 4x count delete');
}

{
  const vm = vimWith(['a b c'], [0, 4]);
  press(vm, seq('D'));
  eq(vm.lines[0], 'a b ', 'vim D to end');
  const vm2 = vimWith(['one two'], [0, 0]);
  press(vm2, seq('d$'));
  eq(vm2.lines[0], '', 'vim d$');
}

{
  // Time Lord: preloaded undo history
  const lvl = VIM_LEVELS.find((l) => l.id === 'vim/11');
  const vm = new Vim({ lines: lvl.lines, cursor: [0, 0], undoHistory: lvl.history });
  press(vm, seq('uuuu'));
  eq(vm.lines, lvl.target, 'vim time-lord undo chain');
}

{
  // dot repeat: A;<esc> then j. j.
  const vm = vimWith(['a', 'b', 'c'], [0, 0]);
  press(vm, ['A', ';', '<esc>', 'j', '.', 'j', '.']);
  eq(vm.lines, ['a;', 'b;', 'c;'], 'vim dot repeats A;<esc>');
  press(vm, seq('gg'));
  press(vm, ['>', '>', 'j', '.']);
  eq(vm.lines, ['  a;', '  b;', 'c;'], 'vim >> then dot');
  press(vm, ['<', '<', 'k', '.']);
  eq(vm.lines, ['a;', 'b;', 'c;'], 'vim << unindents');
}

{
  // dot repeats a dw
  const vm = vimWith(['del keep', 'del stay'], [0, 0]);
  press(vm, ['d', 'w', 'j', '0', '.']);
  eq(vm.lines, ['keep', 'stay'], 'vim dot repeats dw');
}

{
  // % bracket matching
  const vm = vimWith(['call(alpha, [x, y])'], [0, 0]);
  press(vm, ['%']);
  eq(vm.c, 18, 'vim % to closing paren');
  press(vm, ['%']);
  eq(vm.c, 4, 'vim % back to opening');
  const vm2 = vimWith(['if (a) {', '  b()', '}'], [0, 7]);
  press(vm2, ['%']);
  eq([vm2.r, vm2.c], [2, 0], 'vim % across lines');
}

{
  // * and # word search
  const vm = vimWith(['core x', 'y core z', 'core'], [0, 0]);
  press(vm, ['*']);
  eq([vm.r, vm.c], [1, 2], 'vim * next occurrence');
  press(vm, ['*']);
  eq([vm.r, vm.c], [2, 0], 'vim * again');
  press(vm, ['#']);
  eq([vm.r, vm.c], [1, 2], 'vim # backward');
}

{
  // marks
  const vm = vimWith(['one', 'two', 'three'], [0, 1]);
  press(vm, ['m', 'a', 'G']);
  eq(vm.r, 2, 'vim G before mark jump');
  press(vm, ['`', 'a']);
  eq([vm.r, vm.c], [0, 1], 'vim `a exact mark jump');
}

{
  // macros
  const vm = vimWith(['item a', 'item b', 'item c'], [0, 0]);
  press(vm, ['q', 'a', '0', 'd', 'w', 'i', '-', ' ', '<esc>', 'j', 'q']);
  eq(vm.lines[0], '- a', 'vim macro recording applies');
  press(vm, ['2', '@', 'a']);
  eq(vm.lines, ['- a', '- b', '- c'], 'vim 2@a replays macro');
}

{
  // ci' single-quote text object
  const vm = vimWith(["mode = 'slow';"], [0, 9]);
  press(vm, ['c', 'i', "'"]);
  press(vm, seq('turbo'));
  press(vm, ['<esc>']);
  eq(vm.lines[0], "mode = 'turbo';", "vim ci' text object");
}

{
  // di( empties parens
  const vm = vimWith(['cleanup(old_tmp_files);'], [0, 12]);
  press(vm, ['d', 'i', '(']);
  eq(vm.lines[0], 'cleanup();', 'vim di( text object');
}

// --- Level definitions sanity ----------------------------------------------------

{
  const ids = new Set();
  for (const lvl of [...VIM_LEVELS, ...SHELL_LEVELS, ...TMUX_LEVELS]) {
    ok(!ids.has(lvl.id), `unique level id: ${lvl.id}`);
    ids.add(lvl.id);
    ok(typeof lvl.title === 'string' && lvl.title.length > 0, `${lvl.id} has title`);
    ok(typeof lvl.brief === 'string', `${lvl.id} has brief`);
  }
  for (const lvl of VIM_LEVELS) {
    ok(Array.isArray(lvl.lines), `${lvl.id} has lines`);
    if (lvl.type === 'collect') {
      ok(Array.isArray(lvl.gems) && lvl.gems.length > 0, `${lvl.id} has gems`);
      for (const [r, c] of lvl.gems) {
        ok(r < lvl.lines.length && c < lvl.lines[r].length, `${lvl.id} gem [${r},${c}] within buffer`);
        ok(lvl.lines[r][c] !== ' ', `${lvl.id} gem [${r},${c}] not on a space`);
      }
      const [cr, cc] = lvl.cursor;
      ok(cr < lvl.lines.length && cc <= Math.max(0, lvl.lines[cr].length - 1), `${lvl.id} cursor in bounds`);
    }
    if (lvl.type === 'transform') ok(Array.isArray(lvl.target), `${lvl.id} has target`);
    ok(Array.isArray(lvl.keys) && lvl.keys.length > 0, `${lvl.id} has key whitelist`);
  }
  for (const lvl of [...SHELL_LEVELS, ...TMUX_LEVELS]) {
    ok(typeof lvl.setup === 'function', `${lvl.id} has setup`);
    ok(Array.isArray(lvl.objectives) && lvl.objectives.length > 0, `${lvl.id} has objectives`);
    for (const o of lvl.objectives) ok(typeof o.check === 'function' && typeof o.text === 'string', `${lvl.id} objective shape`);
  }
}

// --- Shell levels: setup runs + first objectives reachable -------------------------

{
  for (const lvl of SHELL_LEVELS) {
    const vfs = new VFS();
    const k = new Kernel(vfs);
    const sh = new Shell(k);
    try {
      lvl.setup.call(lvl, k, sh);
      sh.cwd = k.env.HOME;
      ok(vfs.isDir('/home/dev'), `${lvl.id} setup creates home`);
      const res = sh.execute('ls');
      ok(Array.isArray(res.out), `${lvl.id} ls works after setup`);
      for (let i = 0; i < 30; i++) k.tick();
    } catch (err) {
      ok(false, `${lvl.id} setup crashed: ${err.message}`);
    }
  }
}

// Walkthrough: shell/3 plumber is actually solvable
{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/3');
  const vfs = new VFS();
  const k = new Kernel(vfs);
  const sh = new Shell(k);
  lvl.setup.call(lvl, k, sh);
  sh.cwd = k.env.HOME;
  const res = sh.execute('grep ERROR logs/fleet.log | wc -l');
  eq(res.out, [lvl._answer], 'shell/3 count matches recorded answer');
  sh.execute('grep ERROR logs/fleet.log | sort | uniq -c');
  sh.execute(`echo ${lvl._answer} > answer.txt`);
  const ctx = { k, sh, vfs, level: lvl, events: k.events, has: (t, p) => k.events.some((e) => e.type === t && (!p || p(e))) };
  ok(lvl.objectives.every((o) => o.check(ctx)), 'shell/3 fully solvable');
}

// Walkthrough: shell/10 swarm commander end-to-end
{
  const lvl = SHELL_LEVELS.find((l) => l.id === 'shell/10');
  const vfs = new VFS();
  const k = new Kernel(vfs);
  const sh = new Shell(k);
  lvl.setup.call(lvl, k, sh);
  sh.cwd = k.env.HOME;
  sh.execute('./agents/alpha.sh &');
  sh.execute('./agents/beta.sh &');
  sh.execute('./agents/gamma.sh &');
  sh.execute('jobs');
  for (let i = 0; i < 40; i++) k.tick();
  ok(vfs.read('/home/dev/results/alpha.json') !== null, 'shell/10 alpha delivers');
  ok(vfs.read('/home/dev/results/gamma.json') !== null, 'shell/10 gamma delivers');
  const beta = k.procs.find((p) => p.name === 'beta');
  eq(beta.status, 'running', 'shell/10 beta hangs');
  sh.execute(`kill ${beta.pid}`);
  sh.execute('cat results/alpha.json results/gamma.json > summary.json');
  const ctx = { k, sh, vfs, level: lvl, events: k.events, has: (t, p) => k.events.some((e) => e.type === t && (!p || p(e))) };
  ok(lvl.objectives.every((o) => o.check(ctx)), 'shell/10 fully solvable');
}

// --- report ------------------------------------------------------------------------

if (failures) {
  console.error(`\n${failures}/${count} checks FAILED`);
  process.exit(1);
} else {
  console.log(`all ${count} checks passed ✔`);
}
