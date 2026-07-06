// Tmux world levels. Same objective machinery as the shell world, but checks
// can also inspect the Tmux instance via ctx.tmux.

import { dir, file } from '../engine/vfs.js';

function baseTree(extra = {}) {
  return dir({
    home: dir({
      dev: dir({
        'README.txt': file('tmux: one terminal, many terminals inside it.\n'),
        ...extra,
      }),
    }),
    var: dir({ log: dir({}) }),
    tmp: dir({}),
  });
}

function foreverAgent({ name, log, line, period = 4, cpu = 1.5 }) {
  return () => {
    let t = 0;
    return {
      name,
      cpu,
      onTick(proc, kernel) {
        if (++t % period === 0) kernel.vfs.append(log, line.replace('{t}', String(t)) + '\n');
      },
    };
  };
}

export const TMUX_LEVELS = [
  {
    id: 'tmux/1',
    title: 'Enter the Multiplexer',
    teach: ['tmux', 'C-b d', 'tmux attach'],
    brief:
      'tmux turns one terminal into many, and — the killer feature — keeps everything running when you disconnect. ' +
      'Every tmux key starts with the prefix Ctrl-b (press it, release, then the key). ' +
      'Start a session with `tmux`, run something, detach with C-b d, then come back with `tmux attach`.',
    hints: [
      'Type tmux and press Enter. The green bar at the bottom means you are inside.',
      'Detach: press Ctrl-b, let go, then press d. You land back in your plain terminal.',
      'tmux ls shows sessions; tmux attach re-enters the last one.',
    ],
    setup(k) {
      k.vfs.root = baseTree({});
    },
    objectives: [
      { text: 'Start a session by running: tmux', check: (ctx) => ctx.has('tmux-new-session') },
      { text: 'Run any command inside the session (e.g. ls)', check: (ctx) => ctx.tmux && ctx.tmux.allPanes().some((p) => p.shell.history.length > 0) },
      { text: 'Detach with C-b d', check: (ctx) => ctx.has('tmux-detach') },
      { text: 'List sessions from outside: tmux ls', check: (ctx) => ctx.has('tmux-ls') },
      { text: 'Re-enter with tmux attach', check: (ctx) => ctx.has('tmux-attach') && ctx.has('tmux-detach') },
    ],
  },
  {
    id: 'tmux/2',
    title: 'Split Personality',
    teach: ['C-b %', 'C-b "', 'C-b o', 'C-b arrows'],
    brief:
      'C-b % splits the current pane left/right; C-b " splits it top/bottom. ' +
      'C-b o hops to the next pane, C-b + arrow keys move directionally. ' +
      'Build a 3-pane cockpit and visit every pane.',
    hints: [
      'Mnemonic: % looks like two things side by side; " looks like two things stacked.',
      'The green border marks the active pane.',
      'C-b ← → ↑ ↓ moves by direction — faster than cycling with o.',
    ],
    setup(k) {
      k.vfs.root = baseTree({});
    },
    objectives: [
      { text: 'Start tmux', check: (ctx) => ctx.has('tmux-new-session') },
      { text: 'Split left/right with C-b %', check: (ctx) => ctx.has('tmux-split', (e) => e.dir === 'h') },
      { text: 'Split top/bottom with C-b "', check: (ctx) => ctx.has('tmux-split', (e) => e.dir === 'v') },
      {
        text: 'Visit 3 different panes (C-b o or C-b arrows)',
        check(ctx) {
          const ids = new Set(ctx.events.filter((e) => e.type === 'tmux-focus').map((e) => e.paneId));
          return ids.size >= 2 && ctx.tmux && ctx.tmux.win() && ctx.tmux.panes().length >= 3;
        },
      },
      { text: 'Run a command in every pane', check: (ctx) => ctx.tmux && ctx.tmux.win() && ctx.tmux.panes().length >= 3 && ctx.tmux.panes().every((p) => p.shell.history.length > 0) },
    ],
  },
  {
    id: 'tmux/3',
    title: 'Mission Cockpit',
    teach: ['panes + real work'],
    brief:
      'The classic layout: logs streaming in one pane, a live shell in another. ' +
      'Split, start the watcher agent in one pane, then keep working in the other while it runs. ' +
      'This is the moment tmux clicks.',
    hints: [
      'C-b % to split, then ./agents/watcher.sh in one pane (no & — let it own that pane).',
      'C-b → to move to the other pane. The watcher keeps running. That is the magic.',
      'Try tail -f /var/log/watch.log in a third pane for the full cockpit feel.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({ 'watcher.sh': file('#!/bin/sh\n', { exec: true }) }),
      });
      k.vfs.write('/var/log/watch.log', '== watcher ==\n');
      k.registerProgram('/home/dev/agents/watcher.sh', foreverAgent({
        name: 'watcher', log: '/var/log/watch.log', line: 'WATCH tick {t}: fleet nominal', period: 3,
      }));
    },
    objectives: [
      { text: 'Split into at least 2 panes', check: (ctx) => ctx.tmux && ctx.tmux.win() && ctx.tmux.panes().length >= 2 },
      { text: 'Start ./agents/watcher.sh in a pane (foreground)', check: (ctx) => ctx.has('spawn', (e) => e.name === 'watcher' && !e.bg) },
      {
        text: 'While it runs, run a command in ANOTHER pane',
        check(ctx) {
          const watcher = ctx.k.procs.find((p) => p.name === 'watcher' && p.status === 'running');
          if (!watcher) return false;
          return ctx.has('cmd', (e) => e.shell && e.shell !== watcher.shell && e.shell.jobs.every((j) => j.name !== 'watcher'));
        },
      },
    ],
  },
  {
    id: 'tmux/4',
    title: 'Zoom & Doom',
    teach: ['C-b z', 'C-b x'],
    brief:
      'Two panes were prepared for you: a chatty spammer and a quiet worker. ' +
      'C-b z zooms the active pane to full screen (and back). C-b x kills a pane outright. ' +
      'Zoom into the worker to read it in peace, then execute the spammer.',
    hints: [
      'Zoom is a toggle: C-b z in, C-b z out. The status bar shows a Z while zoomed.',
      'Navigate to the spam pane first — C-b x kills the ACTIVE pane.',
      'Killing the pane kills the process inside it. Ruthless and effective.',
    ],
    setup(k, sh, tmux) {
      k.vfs.root = baseTree({
        agents: dir({ 'spammer.sh': file('#!/bin/sh\n', { exec: true }) }),
      });
      k.registerProgram('/home/dev/agents/spammer.sh', () => {
        let t = 0;
        return {
          name: 'spammer', cpu: 8.8,
          onTick(proc) {
            if (++t % 2 === 0) proc.fgLines.push(`SPAM SPAM SPAM ${'!'.repeat((t % 5) + 1)}`);
          },
        };
      });
      // Pre-build: session with two panes, spammer running in the right one.
      const session = tmux.createSession('ops');
      tmux.attach(session);
      const win = session.windows[0];
      tmux.splitActive('h');
      const [left, right] = tmux.panes(win);
      const res = right.shell.execute('./agents/spammer.sh');
      if (res.fgProc) {
        // wire the fg proc to the pane's terminal once it exists
        this._spamProc = res.fgProc;
        this._spamPane = right;
      }
      win.activePane = left;
    },
    postMount(ctx) {
      // attach the spammer's output to the pane terminal
      if (this._spamPane && this._spamPane.term) this._spamPane.term.fgProc = this._spamProc;
    },
    objectives: [
      { text: 'Zoom a pane with C-b z', check: (ctx) => ctx.has('tmux-zoom', (e) => e.zoomed) },
      { text: 'Unzoom with C-b z again', check: (ctx) => ctx.has('tmux-zoom', (e) => !e.zoomed) },
      { text: 'Move to the spam pane and kill it with C-b x', check: (ctx) => ctx.level._spamProc && ctx.level._spamProc.status === 'killed' && ctx.has('tmux-kill-pane') },
    ],
  },
  {
    id: 'tmux/5',
    title: 'Window Shopping',
    teach: ['C-b c', 'C-b n/p', 'C-b 0-9', 'C-b ,'],
    brief:
      'Panes split a screen; windows are whole extra screens — like browser tabs. C-b c creates one, ' +
      'C-b n / C-b p cycle, C-b 0..9 jump straight there, C-b , renames the current window. ' +
      'Build a tidy workspace: windows named "code", "logs" and "scratch".',
    hints: [
      'The status bar lists windows: 0:zsh 1:zsh — the * marks where you are.',
      'C-b , then type the name, then Enter.',
      'Rename each window right after you create it.',
    ],
    setup(k) {
      k.vfs.root = baseTree({});
    },
    objectives: [
      { text: 'Start tmux', check: (ctx) => ctx.has('tmux-new-session') },
      { text: 'Create 2 extra windows with C-b c', check: (ctx) => ctx.tmux && ctx.tmux.attached && ctx.tmux.attached.windows.length >= 3 },
      {
        text: 'Name them code, logs, scratch (C-b ,)',
        check(ctx) {
          if (!ctx.tmux || !ctx.tmux.attached) return false;
          const names = ctx.tmux.attached.windows.map((w) => w.name);
          return ['code', 'logs', 'scratch'].every((n) => names.includes(n));
        },
      },
      { text: 'Jump by number: C-b 0', check: (ctx) => ctx.has('tmux-select-window', (e) => e.idx === 0) },
    ],
  },
  {
    id: 'tmux/6',
    title: 'The Great Detach',
    teach: ['persistence'],
    brief:
      'The whole point of tmux: your work survives you. Start the trainer agent inside tmux, detach, ' +
      'and verify FROM OUTSIDE that it is still chewing through epochs. This is how you run long jobs on remote boxes ' +
      'without praying your wifi holds.',
    hints: [
      'Inside tmux: ./agents/trainer.sh (foreground is fine — the pane keeps it alive).',
      'C-b d to detach. Your terminal is back, but the session lives.',
      'Outside: ps shows the trainer still running; tail /var/log/train.log shows fresh epochs. Then tmux attach.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({ 'trainer.sh': file('#!/bin/sh\n', { exec: true }) }),
      });
      k.vfs.write('/var/log/train.log', 'epoch 0: loss 4.20\n');
      k.registerProgram('/home/dev/agents/trainer.sh', () => {
        let t = 0;
        let epoch = 0;
        return {
          name: 'trainer', cpu: 42.0,
          onTick(proc, kernel) {
            if (++t % 4 === 0) {
              epoch++;
              const loss = (4.2 / (epoch + 1)).toFixed(2);
              kernel.vfs.append('/var/log/train.log', `epoch ${epoch}: loss ${loss}\n`);
              proc.fgLines.push(`epoch ${epoch}: loss ${loss}`);
            }
          },
        };
      });
    },
    objectives: [
      { text: 'Start ./agents/trainer.sh inside tmux', check: (ctx) => ctx.has('spawn', (e) => e.name === 'trainer') },
      {
        text: 'Detach while it trains (C-b d)',
        check: (ctx) => ctx.events.some((e, i) => e.type === 'tmux-detach' && ctx.k.procs.some((p) => p.name === 'trainer' && p.status === 'running')),
      },
      {
        text: 'From outside, verify: ps or tail the train log',
        check(ctx) {
          const trainerAlive = () => ctx.k.procs.some((p) => p.name === 'trainer' && p.status === 'running');
          return ctx.has('cmd', (e) => !ctx.tmuxAttachedAt(e) && /^(ps|tail|cat)\b/.test(e.line) && trainerAlive());
        },
      },
      { text: 'Reattach: tmux attach', check: (ctx) => ctx.has('tmux-attach') && ctx.has('tmux-detach') },
    ],
  },
  {
    id: 'tmux/7',
    title: 'Fleet of Sessions',
    teach: ['tmux new -s', 'tmux ls', 'tmux attach -t'],
    brief:
      'One session per project is how real operators live. tmux new -s api creates a NAMED session; ' +
      'tmux attach -t api returns to it by name. Build two named sessions — "agents" and "monitor" — and hop between them.',
    hints: [
      'You must be OUTSIDE tmux to create a new session (detach first: C-b d).',
      'tmux new -s agents … C-b d … tmux new -s monitor … C-b d.',
      'tmux ls to see the fleet, tmux attach -t agents to board one.',
    ],
    setup(k) {
      k.vfs.root = baseTree({});
    },
    objectives: [
      { text: 'Create session "agents": tmux new -s agents', check: (ctx) => ctx.has('tmux-new-session', (e) => e.name === 'agents') },
      { text: 'Create session "monitor": tmux new -s monitor', check: (ctx) => ctx.has('tmux-new-session', (e) => e.name === 'monitor') },
      { text: 'Survey with tmux ls (while detached)', check: (ctx) => ctx.has('tmux-ls') && ctx.tmux && ctx.tmux.sessions.length >= 2 },
      { text: 'Board by name: tmux attach -t agents', check: (ctx) => ctx.has('cmd', (e) => /tmux\s+attach\s+-t\s+agents/.test(e.line)) },
    ],
  },
  {
    id: 'tmux/8',
    title: 'Boss: Mission Control',
    teach: ['everything'],
    brief:
      'Four panes. Three agents. One saboteur. Build a 4-pane grid: tail -f a different agent log in three panes ' +
      'and keep one command pane. agent-beta will start throwing errors — find its PID with ps, kill it from your ' +
      'command pane, and relaunch it with ./agents/beta.sh &. Fleet green across the board. That is the job.',
    hints: [
      'C-b % then C-b " on each side gets you a 2×2 grid.',
      'Three logs: /var/log/alpha.log, /var/log/beta.log, /var/log/gamma.log.',
      'When beta melts down: ps → kill <pid> → ./agents/beta.sh & — the relaunched beta behaves.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({
          'alpha.sh': file('#!/bin/sh\n', { exec: true }),
          'beta.sh': file('#!/bin/sh\n', { exec: true }),
          'gamma.sh': file('#!/bin/sh\n', { exec: true }),
        }),
      });
      for (const n of ['alpha', 'beta', 'gamma']) k.vfs.write(`/var/log/${n}.log`, `== agent-${n} ==\n`);
      const healthy = (n, period) => foreverAgent({ name: n, log: `/var/log/${n}.log`, line: `INFO [${n}] batch {t} ok`, period });
      k.registerProgram('/home/dev/agents/alpha.sh', healthy('alpha', 3));
      k.registerProgram('/home/dev/agents/gamma.sh', healthy('gamma', 4));
      // First beta melts down; relaunched betas (after a kill) are healthy.
      const level = this;
      k.registerProgram('/home/dev/agents/beta.sh', () => {
        const cursed = !level._betaKilled;
        let t = 0;
        return {
          name: 'beta', cpu: cursed ? 3.1 : 1.4,
          onTick(proc, kernel) {
            t++;
            if (t % 3 !== 0) return;
            if (cursed && t > 12) {
              proc.cpu = 88.4;
              kernel.vfs.append('/var/log/beta.log', `ERROR [beta] task ${t} failed: LOCK TIMEOUT\n`);
            } else {
              kernel.vfs.append('/var/log/beta.log', `INFO [beta] batch ${t} ok\n`);
            }
          },
          onKill() { level._betaKilled = true; },
        };
      });
      // Agents start in the background automatically — mission in progress.
      k.spawnAgents = () => {
        for (const n of ['alpha', 'beta', 'gamma']) {
          const prog = k.programs[`/home/dev/agents/${n}.sh`]([`./agents/${n}.sh`], k);
          k.spawn({ cmd: `./agents/${n}.sh`, name: n, program: prog, bg: true });
        }
      };
      k.spawnAgents();
    },
    objectives: [
      { text: 'Build a 4-pane grid in tmux', check: (ctx) => ctx.tmux && ctx.tmux.win() && ctx.tmux.panes().length >= 4 },
      {
        text: 'tail -f three different agent logs',
        check(ctx) {
          const tails = new Set(ctx.events.filter((e) => e.type === 'tail-f').map((e) => e.path));
          return ['/var/log/alpha.log', '/var/log/beta.log', '/var/log/gamma.log'].every((p) => tails.has(p));
        },
      },
      { text: 'Spot the meltdown, kill the cursed beta', check: (ctx) => !!ctx.level._betaKilled },
      {
        text: 'Relaunch beta (./agents/beta.sh &) — fleet green',
        check(ctx) {
          if (!ctx.level._betaKilled) return false;
          return ctx.k.procs.some((p) => p.name === 'beta' && p.status === 'running' && p.cpu < 10);
        },
      },
    ],
  },
];
