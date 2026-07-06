// Vim dojo levels.
//
// type 'collect':   move the cursor over every ◆ gem (positions in `gems`).
// type 'transform': edit the buffer until it matches `target`.
//
// `keys` is the whitelist of normal-mode keys for the level (Escape and Enter
// are always allowed; insert mode is always free-typing).

const MOVE = ['h', 'j', 'k', 'l'];

export const VIM_LEVELS = [
  {
    id: 'vim/1',
    title: 'First Steps',
    teach: ['h', 'j', 'k', 'l'],
    keys: MOVE,
    type: 'collect',
    brief:
      'Welcome to the dojo. In vim you never touch the mouse or the arrow keys — your hand rests on h j k l. ' +
      'h ← · j ↓ · k ↑ · l →. Walk the cursor over every ◆ gem.',
    hints: [
      'j and k feel swapped at first — j hangs down like a hook (down), k points up.',
      'Keep your index finger on j. That is home.',
    ],
    par: 40,
    lines: [
      '◆.........◆',
      '.    .    .',
      '.    .    .',
      '◆....◆....◆',
      '.    .    .',
      '.    .    .',
      '◆.........◆',
    ],
    gems: 'auto', // every ◆ in the map
    cursor: [3, 5],
  },
  {
    id: 'vim/2',
    title: 'Word Hopper',
    teach: ['w', 'b', 'e'],
    keys: [...MOVE, 'w', 'b', 'e'],
    type: 'collect',
    brief:
      'Moving one character at a time is for tourists. w jumps to the next word, b hops back, e lands on a word’s end. ' +
      'The gems sit on word boundaries — h/l alone will blow your par.',
    hints: [
      'w → start of next word · e → end of this/next word · b → back to a word start.',
      'Punctuation counts as its own little word.',
    ],
    par: 26,
    lines: [
      'const agents = spawn(fleet, config);',
      '',
      'let results = await Promise.all(jobs);',
      '',
      'return merge(results, cache).flat();',
    ],
    gems: [[0, 6], [0, 13], [0, 15], [0, 26], [0, 34], [2, 4], [2, 12], [2, 20], [2, 32], [4, 7], [4, 13], [4, 23], [4, 34]],
    cursor: [0, 0],
  },
  {
    id: 'vim/3',
    title: 'Line Rider',
    teach: ['0', '$', '^'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', '^'],
    type: 'collect',
    brief:
      '0 slams the cursor to column zero, $ rides to the end of the line, ^ lands on the first real character. ' +
      'Gems live at the edges — jump, don’t walk.',
    hints: ['0 and ^ differ only on indented lines: ^ skips the leading spaces.', '$ then j then $ … surf the right edge.'],
    par: 22,
    lines: [
      'north = "gate"                     # patrol',
      '    indent = true                  # watch',
      'south = "harbor"                   # calm',
      '        deep = "indent"            # here',
      'west = "cliffs"                    # edge',
    ],
    gems: 'auto-edges', // first non-blank + last char of every line
    cursor: [2, 20],
  },
  {
    id: 'vim/4',
    title: 'Sniper',
    teach: ['f', 't', 'F', 'T', ';', ','],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', 'f', 't', 'F', 'T', ';', ','],
    type: 'collect',
    brief:
      'f<char> snaps the cursor onto the next <char> in the line; t stops just before it. F and T shoot backwards. ' +
      '; repeats the last shot, , repeats it the other way. Every gem sits on an x — take aim: fx then ; ; ;',
    hints: ['fx jumps ONTO the next x. ; repeats it. That is 4 gems in 4 keystrokes.', 'Overshot? , goes back.'],
    par: 24,
    lines: [
      '..x....x.......x....x....',
      '.........................',
      '....x.........x..x......x',
      '.........................',
      'x......x....x.......x....',
    ],
    gems: 'auto-x',
    cursor: [0, 0],
  },
  {
    id: 'vim/5',
    title: 'Skydive',
    teach: ['gg', 'G', '{n}G'],
    keys: [...MOVE, 'w', 'e', 'b', '0', '$', 'g', 'G', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    type: 'collect',
    brief:
      'gg teleports to the first line, G to the last, and 12G to line 12. The file is tall — falling with j is not a plan.',
    hints: ['Line numbers are in the gutter. See a gem on line 9? Type 9G.', 'gg is two taps of g.'],
    par: 14,
    lines: [
      '◆ -- line 1: the roof',
      '.',
      '.',
      '.    ◆ <- line 4',
      '.',
      '.',
      '.',
      '.',
      '.        ◆ <- line 9',
      '.',
      '.',
      '.',
      '.  ◆ <- line 13',
      '.',
      '.',
      '◆ -- line 16: the basement',
    ],
    gems: 'auto',
    cursor: [7, 0],
  },
  {
    id: 'vim/6',
    title: 'Insert Coin',
    teach: ['i', 'a', 'I', 'A', 'o', 'O'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', 'f', 'F', 't', 'T', ';', 'i', 'a', 'I', 'A', 'o', 'O'],
    type: 'transform',
    brief:
      'Six doors into insert mode: i (before cursor), a (after), I (line start), A (line end), o (new line below), O (new line above). ' +
      'Fix the config so it matches the target — pick the nearest door, type, then Escape back to normal mode.',
    hints: [
      'Escape returns to normal mode. You will press it ten thousand times in your life. Make peace with it.',
      'A is perfect for adding the missing semicolons; o for the missing line.',
    ],
    par: 60,
    lines: [
      'name = "quest"',
      'mode = "turbo"',
      'retries = 3',
    ],
    target: [
      '# generated by hand',
      'name = "quest";',
      'mode = "turbo";',
      'retries = 3;',
      'workers = 8;',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/7',
    title: 'Exterminator',
    teach: ['x', 'dd', 'dw', 'D'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', 'f', 't', ';', 'x', 'd', 'D'],
    type: 'transform',
    brief:
      'Bugs crawled into the code. x deletes the character under the cursor, dw deletes a word, dd deletes a whole line, ' +
      'D deletes to the end of the line. Exterminate until the buffer matches the target.',
    hints: ['The BUG words want dw. The bug lines want dd.', 'd is an operator: d + any motion deletes that far. d$ = D.'],
    par: 30,
    lines: [
      'const fleet = BUG spawn(3);',
      'BUGS EVERYWHERE DELETE THIS LINE',
      'let ready == false;',
      'await fleet.launch(); // BUG BUG BUG',
      'ALSO THIS LINE IS GARBAGE',
      'return fleet.statusxx;',
    ],
    target: [
      'const fleet = spawn(3);',
      'let ready = false;',
      'await fleet.launch();',
      'return fleet.status;',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/8',
    title: 'Shapeshifter',
    teach: ['cw', 'ciw', 'r', '~'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', 'f', 't', ';', 'c', 'r', '~', 'i', 'a', 'x', 'd'],
    type: 'transform',
    brief:
      'c is "change": delete, then drop into insert mode. cw changes to the end of the word; ciw changes the whole word ' +
      'under the cursor no matter where you stand in it. r swaps one character without leaving normal mode.',
    hints: [
      'ciw is the king of renames: cursor anywhere in the word, ciw, type the new one.',
      'One wrong letter? r + the right letter. No insert mode needed.',
    ],
    par: 46,
    lines: [
      'let pig = connect(hist, 8080);',
      'pig.retry = felse;',
      'pig.send("hallo world");',
    ],
    target: [
      'let hub = connect(host, 8080);',
      'hub.retry = false;',
      'hub.send("hello world");',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/9',
    title: 'Copy That',
    teach: ['yy', 'p', 'P', 'yw'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', 'y', 'p', 'P', 'd'],
    type: 'transform',
    brief:
      'yy yanks (copies) the line, p pastes it below, P pastes above. y is an operator like d — yw yanks a word. ' +
      'Deleted text lands in the same register, so dd + p is cut-and-paste.',
    hints: ['You need three copies of the worker line — yy then p then p.', 'dd the misplaced line, move, then p to drop it where it belongs.'],
    par: 24,
    lines: [
      'services:',
      '  - worker: alpha',
      'version: 3',
    ],
    target: [
      'version: 3',
      'services:',
      '  - worker: alpha',
      '  - worker: alpha',
      '  - worker: alpha',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/10',
    title: 'Multiplier',
    teach: ['3w', '2dd', '5j', '4x'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '$', 'x', 'd', 'y', 'p', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    type: 'transform',
    brief:
      'Every command takes a count. 5j drops five lines, 3w leaps three words, 2dd deletes two lines, 4x eats four characters. ' +
      'Stop repeating yourself — multiply. The par is brutal on purpose.',
    hints: ['The four junk lines are adjacent: 4dd.', 'xxxx is 4x. jjjjj is 5j.'],
    par: 18,
    lines: [
      'keep: header',
      'junk junk junk',
      'junk junk junk',
      'junk junk junk',
      'junk junk junk',
      'keep: footerXXXX',
      'keep: sig',
    ],
    target: [
      'keep: header',
      'keep: footer',
      'keep: sig',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/11',
    title: 'Time Lord',
    teach: ['u', 'Ctrl-r'],
    keys: [...MOVE, 'u'],
    type: 'transform',
    brief:
      'A gremlin made four bad edits to this haiku. u undoes the last change; Ctrl-r redoes it. ' +
      'Rewind time until the poem is whole again. (If you undo too far, Ctrl-r brings it back.)',
    hints: ['Just press u repeatedly and watch the poem heal.', 'u u u u — four gremlin edits, four undos.'],
    par: 4,
    lines: [
      'silent SEGFAULT screams',
      'the daemon REFUSES sleep',
      'logs bloom NULL like rot',
    ],
    history: [
      ['silent terminal', 'the daemon does not sleep', 'logs bloom like flowers'],
      ['silent SEGFAULT screams', 'the daemon does not sleep', 'logs bloom like flowers'],
      ['silent SEGFAULT screams', 'the daemon REFUSES sleep', 'logs bloom like flowers'],
      ['silent SEGFAULT screams', 'the daemon REFUSES sleep', 'logs bloom NULL like flowers'],
    ],
    target: [
      'silent terminal',
      'the daemon does not sleep',
      'logs bloom like flowers',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/12',
    title: 'Seeker',
    teach: ['/', 'n', 'N'],
    keys: [...MOVE, '/', 'n', 'N', 'w', 'b', 'e'],
    type: 'collect',
    brief:
      'Type /bug and Enter — the cursor jumps to the next "bug". n repeats the search forward, N backward. ' +
      'A gem sits on every bug in this codebase. Hunt them all: /bug then n n n n…',
    hints: ['/bug ⏎ then hammer n.', 'Search wraps around the end of the file back to the top.'],
    par: 14,
    lines: [
      'function deploy() {          // clean',
      '  const bug = inject();      // <--',
      '  release(); // no issues',
      '  if (bug) { patch(bug); }   // two here',
      '  ship(); // clean',
      '  return bug ? rollback() : done(); // last one',
      '}',
    ],
    gems: [[1, 8], [3, 6], [3, 19], [5, 9]],
    cursor: [0, 0],
  },
  {
    id: 'vim/13',
    title: 'Substitute Teacher',
    teach: [':s/old/new/', ':%s/old/new/g'],
    keys: [...MOVE, ':', 'w', 'b', 'e', '0', '$', '/', 'n'],
    type: 'transform',
    brief:
      'The rename to end all renames. :s/old/new/ substitutes on the current line; :%s/old/new/g does it on every line, ' +
      'every occurrence. Someone shipped the variable name "data2" — make it "payload" everywhere.',
    hints: [':%s/data2/payload/g — one command, whole file.', 'Without the trailing g only the first match on each line changes.'],
    par: 24,
    lines: [
      'const data2 = fetch(url);',
      'validate(data2);',
      'const size = data2.length + data2.offset;',
      'return transform(data2);',
    ],
    target: [
      'const payload = fetch(url);',
      'validate(payload);',
      'const size = payload.length + payload.offset;',
      'return transform(payload);',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/14',
    title: 'Visual Artist',
    teach: ['v', 'V', 'd', 'y'],
    keys: [...MOVE, 'v', 'V', 'd', 'y', 'p', 'w', 'b', 'e', '0', '$', 'f', 't', ';', 'j', 'k'],
    type: 'transform',
    brief:
      'v starts a character selection, V selects whole lines. Stretch the highlight with any motion, then strike: ' +
      'd deletes it, y yanks it. Select the three debug lines with V j j and delete them in one blow.',
    hints: ['Vjjd — select three lines, delete.', 'v with f/e selects precisely inside a line: v f )  d.'],
    par: 20,
    lines: [
      'start(engine);',
      'console.log("debug 1");',
      'console.log("debug 2");',
      'console.log("debug 3");',
      'run(engine, { fast: true, verbose: true });',
      'stop(engine);',
    ],
    target: [
      'start(engine);',
      'run(engine, { fast: true });',
      'stop(engine);',
    ],
    cursor: [0, 0],
  },
  {
    id: 'vim/15',
    title: 'Boss: The Refactor',
    teach: ['everything'],
    keys: [...MOVE, 'w', 'b', 'e', '0', '^', '$', 'f', 'F', 't', 'T', ';', ',', 'g', 'G', 'i', 'a', 'I', 'A', 'o', 'O', 'x', 'X', 'd', 'D', 'c', 'C', 's', 'r', '~', 'y', 'p', 'P', 'J', 'u', 'v', 'V', '/', 'n', 'N', ':', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    type: 'transform',
    brief:
      'Everything you know, one filthy diff. Rename the function, kill the dead code, fix the typos, duplicate the retry line. ' +
      'The par assumes you compose motions like a black belt. Good luck.',
    hints: [
      ':%s/procesData/processData/g fixes the name everywhere at once.',
      'ciw for the "tru" → "true" fix. dd for dead code. yy p for the retry line.',
    ],
    par: 62,
    lines: [
      'function procesData(input) {',
      '  // TODO delete me',
      '  // XXX and me',
      '  const valid = tru;',
      '  retry(procesData, 1);',
      '  return procesData.cache || input.map(fn);',
      '}',
    ],
    target: [
      'function processData(input) {',
      '  const valid = true;',
      '  retry(processData, 1);',
      '  retry(processData, 1);',
      '  return processData.cache || input.map(fn);',
      '}',
    ],
    cursor: [0, 0],
  },
];

// Resolve 'auto' gem specs into explicit [row, col] lists.
for (const lvl of VIM_LEVELS) {
  if (lvl.gems === 'auto' || lvl.gems === 'auto-x') {
    const ch = lvl.gems === 'auto' ? '◆' : 'x';
    const gems = [];
    lvl.lines.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) if (line[c] === ch) gems.push([r, c]);
    });
    lvl.gems = gems;
  } else if (lvl.gems === 'auto-edges') {
    const gems = [];
    lvl.lines.forEach((line, r) => {
      const first = line.search(/\S/);
      if (first === -1) return;
      gems.push([r, first]);
      if (line.length - 1 !== first) gems.push([r, line.length - 1]);
    });
    lvl.gems = gems;
  }
}
