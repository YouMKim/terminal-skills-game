# 🕹️ Terminal Quest

A browser game (in the spirit of [vim-adventures](https://vim-adventures.com/)) that teaches you the three skills of a terminal power user — by making you *play* them:

| World | What you master |
|---|---|
| ⌨️ **The Vim Dojo** — 19 levels | `hjkl` → words/lines → `f`/`t` sniping → insert modes → operators (`d` `c` `y`) → text objects (`ciw` `ci"` `di(`) → counts → **the dot command** → undo → search → `%`/`*`/marks → `:%s` → visual mode → **macros** (`q`/`@`) → a boss refactor |
| 🛰️ **Fleet Ops** — 13 levels | You operate a fleet of AI agents: `find`/`grep -r`, pipes, redirection, `xargs`, `chmod`, `ps`/`kill`, `pgrep` + `$(...)` substitution, `&`/`jobs`/`fg`/`bg`/`Ctrl-Z`, `tail -f`, env vars, readline shortcuts (`Ctrl-A/E/U/K/R`), `cut`/`awk`/`sed`, and a multi-agent boss mission |
| 🪟 **The Multiplexer** — 11 levels | tmux for real: prefix key, splits, pane navigation, zoom/kill, copy-mode scrollback, windows, detach/attach persistence, named sessions, the `:` command prompt + `resize-pane`, `synchronize-panes` fan-out, and a 4-pane mission-control boss |

Everything runs in a **simulated terminal, vim, and tmux built from scratch in vanilla JS** — no backend, no build step, no dependencies. Progress (completed levels, best keystroke counts, where you left off) saves automatically to `localStorage`.

## Play

ES modules need a web server (opening `index.html` directly won't work):

```sh
cd terminal-quest
python3 -m http.server 8000
# then open http://localhost:8000
```

or any static server (`npx serve`, `caddy file-server`, …). GitHub Pages works too — it's a static site.

> Best played in Chrome/Safari/Firefox on macOS or Linux. The game captures keys like `Ctrl-B`, `Ctrl-R`, `Ctrl-A` — on macOS these don't collide with browser shortcuts (those use ⌘). ⌘-keys are never intercepted.

## How it plays

- **Vim levels** are either *gem hunts* (walk the cursor over every ◆ using only the motions that level allows — arrow keys are mocked mercilessly) or *transforms* (edit the buffer until it matches the target pane). Every level has a keystroke **par**; beat it for the ⭐.
- **Shell & tmux levels** are missions with live objective checklists. The simulated kernel has real(ish) processes: agents run in the background, write logs on a clock, melt down, and must be found and killed. Pipes, redirects, globs, `$VARS`, tab completion, and `!!` all work.
- The sidebar has a 💡 hint button (multiple hints per level) and a restart button. `help` and `man <cmd>` work inside every simulated terminal.

## Project layout

```
index.html
css/style.css
js/
  main.js              app shell: routing, HUD, win modal
  state.js             localStorage save/load
  runners.js           per-world level runners (vim / shell / tmux)
  engine/
    vim.js             modal vim engine (pure logic, node-testable)
    vfs.js             virtual filesystem
    shell.js           kernel + shell: parser, pipes, redirects, jobs, ~30 commands
    terminal.js        terminal UI + readline editing (Ctrl-A/E/U/K/W/R, history, tab)
    tmux.js            sessions → windows → split-tree panes, prefix keys, status bar
  levels/
    vim-levels.js      19 dojo levels
    shell-levels.js    13 fleet-ops missions
    tmux-levels.js     11 multiplexer missions
tests/
  smoke.mjs            580+ unit checks for the engines (node tests/smoke.mjs)
  dom-smoke.mjs        29 end-to-end level solves against a DOM stub
```

## Curriculum, checked against the standard advice

The level list is deliberately mapped to the canonical learning resources:

- **vim** — covers everything in `vimtutor` plus the core of *Practical Vim* (Drew Neil) and the classic ["grok vi" Stack Overflow answer](https://stackoverflow.com/questions/1218390): motions, operators+text objects as a language, counts, the dot command, `f/t` + `;`, `%`, `*`, marks, registers via yank/delete, `:%s`, visual mode, macros.
- **shell** — tracks [The Art of Command Line](https://github.com/jlevy/the-art-of-command-line) "Basics + Everyday use" and MIT's [Missing Semester](https://missing.csail.mit.edu/): pipes, redirection, globbing, `find`/`grep`, `xargs`, command substitution, job control, `ps`/`kill`/`pgrep`, env vars, readline editing, history expansion (`!!`, `!$`), `cut`/`awk`/`sed`, tab completion.
- **tmux** — the full working set from the standard tmux guides: prefix, panes, windows, sessions, detach/attach persistence, copy-mode scrollback, the command prompt, `resize-pane`, `synchronize-panes`.

**Deliberately out of scope** (real-world topics a simulator can't teach honestly): dotfile configuration (`.vimrc`, `.tmux.conf`), plugins, `ssh` to real hosts, `less` paging, vim registers beyond the unnamed one, and the jumplist (`Ctrl-o`/`Ctrl-i`). After finishing the game, run `vimtutor` in a real terminal and skim the three resources above — the game gives you the muscle memory to make them stick.

## Tests

```sh
node tests/smoke.mjs      # engine unit tests
node tests/dom-smoke.mjs  # integration: levels are actually winnable
```

## Ideas for later

- Vim: registers (`"a`), the jumplist, window splits, `gq`/formatting
- Shell: `ssh` into "remote" boxes, cron missions, a simulated `git`
- A daily-challenge mode and a global keystroke-golf leaderboard
