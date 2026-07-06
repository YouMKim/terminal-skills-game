# 🕹️ Terminal Quest

A browser game (in the spirit of [vim-adventures](https://vim-adventures.com/)) that teaches you the three skills of a terminal power user — by making you *play* them:

| World | What you master |
|---|---|
| ⌨️ **The Vim Dojo** — 15 levels | `hjkl` → words/lines → `f`/`t` sniping → insert modes → operators (`d` `c` `y`) → counts → undo → search → `:%s` → visual mode → a boss refactor |
| 🛰️ **Fleet Ops** — 10 levels | You operate a fleet of AI agents: `find`/`grep -r`, pipes, redirection, `ps`/`kill`, `&`/`jobs`/`fg`/`bg`/`Ctrl-Z`, `tail -f`, env vars, readline shortcuts (`Ctrl-A/E/U/K/R`), and a multi-agent boss mission |
| 🪟 **The Multiplexer** — 8 levels | tmux for real: prefix key, splits, pane navigation, zoom/kill, windows, detach/attach persistence, named sessions, and a 4-pane mission-control boss |

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
    vim-levels.js      15 dojo levels
    shell-levels.js    10 fleet-ops missions
    tmux-levels.js     8 multiplexer missions
tests/
  smoke.mjs            462 unit checks for the engines (node tests/smoke.mjs)
  dom-smoke.mjs        18 end-to-end level solves against a DOM stub
```

## Tests

```sh
node tests/smoke.mjs      # engine unit tests
node tests/dom-smoke.mjs  # integration: levels are actually winnable
```

## Ideas for later

- More vim: macros (`q`), marks, registers, `.` repeat, window splits
- Shell: `awk`/`sed` missions, `ssh` into "remote" boxes, cron
- A daily-challenge mode and a global keystroke-golf leaderboard
