// Shell world: you are the operator of a fleet of AI coding agents.
// Each level builds a vfs + programs, then checks objectives against the
// kernel event log and filesystem state.
//
// Objective checks are sticky: once true, they stay done.
// ctx = { k (kernel), sh (base shell), has(type, pred), vfs }

import { dir, file } from '../engine/vfs.js';

function baseTree(extra = {}) {
  return dir({
    home: dir({
      dev: dir({
        'README.txt': file('You are the operator. The agents are your fleet.\nType `help` to see every command you can use.\n'),
        ...extra,
      }),
    }),
    var: dir({ log: dir({}) }),
    tmp: dir({}),
    usr: dir({ bin: dir({}) }),
  });
}

// A generic long-running agent program: appends a line to its log every few ticks.
function agentProgram({ name, log, lines, period = 3, cpu = 1.2, dieAfter = null, resultFile = null, resultContent = null }) {
  return () => {
    let t = 0;
    let i = 0;
    return {
      name,
      cpu,
      onTick(proc, kernel) {
        t++;
        if (t % period !== 0) return;
        const line = lines[i % lines.length];
        i++;
        if (log) kernel.vfs.append(log, line.replace('{t}', String(t)) + '\n');
        if (dieAfter && i >= dieAfter) {
          if (resultFile) kernel.vfs.write(resultFile, resultContent ?? '{"ok": true}\n');
          proc.status = 'done';
        }
      },
    };
  };
}

export const SHELL_LEVELS = [
  {
    id: 'shell/1',
    title: 'Wayfinder',
    teach: ['pwd', 'ls', 'cd', 'cat'],
    brief:
      'Day one at Fleet Ops. Somewhere under ~/missions is your written briefing. ' +
      'pwd tells you where you are, ls what is here, cd moves you, cat reads files.',
    hints: [
      'ls → see missions/ → cd missions → ls again. Directories nest.',
      'You can chain: cat missions/day-01/briefing.txt works from home too.',
      'Tab completes file names. Try typing cat mi<Tab>.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        missions: dir({
          'day-01': dir({
            'briefing.txt': file(
              'FLEET OPS — DAY ONE\n===================\nWelcome, operator.\nYour access code is: TANGO-7\nMemorize it. Then get back to the terminal.\n'
            ),
          }),
        }),
        agents: dir({}),
        'notes.txt': file('remember: coffee first, then agents\n'),
      });
    },
    objectives: [
      { text: 'Check where you are with pwd', check: (ctx) => ctx.has('cmd', (e) => /^pwd\b/.test(e.line)) },
      { text: 'Look around with ls', check: (ctx) => ctx.has('ls') },
      { text: 'Move into the missions directory with cd', check: (ctx) => ctx.has('cd', (e) => e.path.includes('/missions')) },
      { text: 'Read day-01/briefing.txt with cat', check: (ctx) => ctx.has('read', (e) => e.path.endsWith('briefing.txt')) },
    ],
  },
  {
    id: 'shell/2',
    title: 'Needle in a Haystack',
    teach: ['find', 'grep -r'],
    brief:
      'An agent hid a rogue config somewhere in ~/projects — dozens of folders deep. Nobody clicks through that. ' +
      'find . -name "pattern" hunts by file name; grep -r "text" . hunts by contents.',
    hints: [
      'find . -name "*.conf" from your home directory lists every .conf file.',
      'grep -r "OVERRIDE" . searches the contents of everything below you.',
      'Quote your patterns: find . -name "*.conf" — otherwise the shell expands the * first.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        projects: dir({
          api: dir({
            src: dir({ 'main.py': file('def main():\n    serve()\n'), 'util.py': file('# helpers\n') }),
            'settings.conf': file('mode=normal\n'),
          }),
          web: dir({
            static: dir({ 'app.js': file('console.log("hi")\n') }),
            deep: dir({
              deeper: dir({
                'rogue.conf': file('# planted by agent-omega\nOVERRIDE=all-your-base\nmode=chaos\n'),
              }),
            }),
          }),
          ml: dir({ 'train.py': file('# training loop\n'), 'model.conf': file('layers=12\n') }),
        }),
      });
    },
    objectives: [
      { text: 'Hunt config files by name: find . -name "*.conf"', check: (ctx) => ctx.has('find', (e) => e.name && e.name.includes('.conf')) },
      { text: 'Search file contents: grep -r "OVERRIDE" .', check: (ctx) => ctx.has('grep', (e) => e.recursive && /OVERRIDE/i.test(e.pattern)) },
      { text: 'Read the rogue config with cat', check: (ctx) => ctx.has('read', (e) => e.path.endsWith('rogue.conf')) },
    ],
  },
  {
    id: 'shell/3',
    title: 'The Plumber',
    teach: ['|', 'wc -l', 'sort', 'uniq -c'],
    brief:
      'The overnight run produced a monster log. Pipes (|) feed one command’s output into the next — ' +
      'grep ERROR fleet.log | wc -l counts errors without you reading a single line. ' +
      'Count the ERROR lines, then write the number into answer.txt (echo N > answer.txt).',
    hints: [
      'grep ERROR logs/fleet.log | wc -l prints the count.',
      'Which agent errors most? grep ERROR logs/fleet.log | sort | uniq -c',
      'echo 7 > answer.txt writes "7" into the file (use YOUR count).',
    ],
    setup(k) {
      const lines = [];
      const agents = ['alpha', 'beta', 'gamma'];
      let errors = 0;
      for (let i = 0; i < 60; i++) {
        const a = agents[i % 3];
        if (i % 7 === 3 || i % 11 === 5) {
          lines.push(`ERROR [agent-${a}] task ${i} failed: timeout`);
          errors++;
        } else {
          lines.push(`INFO [agent-${a}] task ${i} ok`);
        }
      }
      this._errorCount = errors;
      k.vfs.root = baseTree({
        logs: dir({ 'fleet.log': file(lines.join('\n') + '\n') }),
      });
      this._answer = String(errors);
    },
    objectives: [
      { text: 'Pipe grep into wc: grep ERROR logs/fleet.log | wc -l', check: (ctx) => ctx.has('pipeline', (e) => e.cmds.includes('grep') && e.cmds.includes('wc')) },
      { text: 'Try a 3-stage pipe with sort and uniq -c', check: (ctx) => ctx.has('pipeline', (e) => e.cmds.includes('sort') || e.cmds.includes('uniq')) },
      {
        text: 'Write the ERROR count into answer.txt (echo N > answer.txt)',
        check(ctx) {
          const content = ctx.vfs.read('/home/dev/answer.txt');
          return content !== null && content.trim() === ctx.level._answer;
        },
      },
    ],
  },
  {
    id: 'shell/4',
    title: 'Redirector',
    teach: ['>', '>>'],
    brief:
      '> sends output into a file (replacing it); >> appends to the end. Build a triage report: ' +
      'WARN lines first, then ERROR lines appended below them, all in report.txt.',
    hints: [
      'grep WARN logs/fleet.log > report.txt creates the file.',
      'grep ERROR logs/fleet.log >> report.txt appends — with > you’d wipe the warnings.',
      'cat report.txt to double-check your work.',
    ],
    setup(k) {
      const lines = [
        'INFO [alpha] boot ok',
        'WARN [beta] slow response 1200ms',
        'INFO [gamma] boot ok',
        'ERROR [beta] task 12 failed',
        'WARN [alpha] retry queue growing',
        'INFO [beta] recovered',
        'ERROR [gamma] disk full',
      ];
      k.vfs.root = baseTree({
        logs: dir({ 'fleet.log': file(lines.join('\n') + '\n') }),
      });
    },
    objectives: [
      { text: 'Create the report: grep WARN logs/fleet.log > report.txt', check: (ctx) => ctx.has('redirect', (e) => e.op === '>' && e.path.endsWith('report.txt')) },
      { text: 'Append errors: grep ERROR logs/fleet.log >> report.txt', check: (ctx) => ctx.has('redirect', (e) => e.op === '>>' && e.path.endsWith('report.txt')) },
      {
        text: 'report.txt holds 2 WARN lines then 2 ERROR lines',
        check(ctx) {
          const c = ctx.vfs.read('/home/dev/report.txt');
          if (!c) return false;
          const ls = c.trim().split('\n');
          return ls.length === 4 && ls[0].includes('WARN') && ls[1].includes('WARN') && ls[2].includes('ERROR') && ls[3].includes('ERROR');
        },
      },
    ],
  },
  {
    id: 'shell/11',
    title: 'Chain Reaction',
    teach: ['xargs', 'chmod +x'],
    brief:
      'A crashed agent littered the workspace with .tmp files, and the cleanup script arrived without its execute bit. ' +
      'xargs turns a stream of names into arguments: find … | xargs rm deletes everything find found, in one line. ' +
      'And a script you can’t run yet just needs chmod +x.',
    hints: [
      'Scout first: find . -name "*.tmp" | wc -l — know your enemy.',
      'find . -name "*.tmp" | xargs rm — find feeds the names, xargs hands them to rm.',
      './agents/cleanup.sh says "permission denied"? chmod +x agents/cleanup.sh, then run it.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({ 'cleanup.sh': file('#!/bin/sh\n# certifies a clean workspace\n') }), // note: not executable yet
        work: dir({
          'cache-01.tmp': file('junk\n'),
          'cache-02.tmp': file('junk\n'),
          'report.md': file('keep me\n'),
          batch: dir({ 'a.tmp': file('junk\n'), 'b.tmp': file('junk\n'), 'results.json': file('{"keep": true}\n') }),
          deep: dir({ nest: dir({ 'zz.tmp': file('junk\n') }) }),
        }),
      });
      k.registerProgram('/home/dev/agents/cleanup.sh', (argv, kernel) => {
        let tmps = 0;
        kernel.vfs.walk('/home/dev', (p, node) => { if (node.type === 'file' && p.endsWith('.tmp')) tmps++; });
        if (tmps > 0) {
          return { name: 'cleanup', immediateError: `cleanup: refusing to certify — ${tmps} .tmp file(s) still present. Hunt them down first.` };
        }
        let t = 0;
        return {
          name: 'cleanup',
          cpu: 0.5,
          onTick(proc, k2) {
            if (++t === 2) {
              k2.vfs.write('/home/dev/work/cleaned.ok', 'workspace certified clean\n');
              proc.fgLines.push('cleanup: ✔ workspace certified clean');
              proc.status = 'done';
            }
          },
        };
      });
    },
    objectives: [
      { text: 'Scout the junk: find . -name "*.tmp" | wc -l', check: (ctx) => ctx.has('pipeline', (e) => e.cmds.includes('find') && e.cmds.includes('wc')) },
      {
        text: 'Wipe them in ONE line: find . -name "*.tmp" | xargs rm',
        check(ctx) {
          if (!ctx.has('xargs', (e) => e.cmd === 'rm')) return false;
          let tmps = 0;
          ctx.vfs.walk('/home/dev', (p, node) => { if (node.type === 'file' && p.endsWith('.tmp')) tmps++; });
          return tmps === 0;
        },
      },
      {
        text: 'Grant the execute bit: chmod +x agents/cleanup.sh',
        check(ctx) {
          const node = ctx.vfs.get('/home/dev/agents/cleanup.sh');
          return !!node && node.exec;
        },
      },
      { text: 'Run ./agents/cleanup.sh to certify the workspace', check: (ctx) => ctx.vfs.read('/home/dev/work/cleaned.ok') !== null },
    ],
  },
  {
    id: 'shell/5',
    title: 'Runaway',
    teach: ['ps', 'kill'],
    brief:
      'Something is eating the box alive. ps lists every running process with its PID and CPU. ' +
      'Find the runaway agent and kill <PID> it. Do NOT kill the healthy ones — they are billing by the hour.',
    hints: [
      'ps — the %CPU column tells the story.',
      'kill takes the PID (first column), not the name.',
      'Check with ps again afterwards.',
    ],
    setup(k) {
      k.vfs.root = baseTree({ agents: dir({}) });
      const mk = (name, cpu, lines) =>
        k.spawn({
          cmd: `./agents/${name}.sh`, name, bg: true,
          program: { name, cpu, onTick(proc, kernel) { if (kernel.time % 6 === 0) kernel.vfs.append(`/var/log/${name}.log`, lines + '\n'); } },
        });
      mk('agent-alpha', 1.2, 'INFO alpha working');
      this._runaway = mk('agent-omega', 94.7, 'LOOP omega spinning');
      mk('agent-gamma', 0.8, 'INFO gamma working');
    },
    objectives: [
      { text: 'Survey the fleet with ps', check: (ctx) => ctx.has('ps') },
      { text: 'Kill the CPU hog (94.7%!)', check: (ctx) => ctx.level._runaway.status === 'killed' },
      {
        text: 'Leave alpha and gamma alive',
        check(ctx) {
          if (ctx.level._runaway.status !== 'killed') return false;
          const alive = ctx.k.procs.filter((p) => p.status === 'running' && p.name.startsWith('agent-'));
          return alive.length === 2;
        },
        canFail: true,
      },
    ],
  },
  {
    id: 'shell/12',
    title: 'Substitution Cipher',
    teach: ['$(...)', 'pgrep', 'pkill'],
    brief:
      'Three imposter processes snuck into the fleet. Command substitution — $(...) — runs a command and pastes ' +
      'its output into your line, so kill $(pgrep imposter) finds AND executes in one stroke. This composition is ' +
      'the single most useful trick for wrangling many agents at once.',
    hints: [
      'Warm up: echo "operator: $(whoami)" — see how $() melts into the line.',
      'pgrep imposter prints the PIDs. That output can BE the arguments to kill.',
      'kill $(pgrep imposter) — then ps to confirm only the real agents remain.',
    ],
    setup(k) {
      k.vfs.root = baseTree({});
      const mk = (name, cpu) =>
        k.spawn({ cmd: `./agents/${name}.sh`, name, bg: true, program: { name, cpu, onTick() {} } });
      mk('agent-alpha', 1.1);
      mk('agent-gamma', 0.9);
      mk('imposter-x91', 22.4);
      mk('imposter-k07', 19.8);
      mk('imposter-qq3', 24.1);
    },
    objectives: [
      { text: 'Try substitution: echo "operator: $(whoami)"', check: (ctx) => ctx.has('subst') },
      { text: 'List the imposter PIDs: pgrep imposter', check: (ctx) => ctx.has('pgrep', (e) => 'imposter'.includes(e.pattern) || e.pattern.includes('imposter')) },
      {
        text: 'One stroke: kill $(pgrep imposter)',
        check(ctx) {
          if (!ctx.has('cmd', (e) => /kill\s+\$\(\s*pgrep/.test(e.line))) return false;
          return ctx.k.procs.filter((p) => p.name.startsWith('imposter')).every((p) => p.status === 'killed');
        },
      },
      {
        text: 'Verify with ps: only the real agents remain',
        check(ctx) {
          const evs = ctx.events;
          let lastKill = -1;
          evs.forEach((e, i) => { if (e.type === 'kill' && e.name.startsWith('imposter')) lastKill = i; });
          if (lastKill === -1) return false;
          const allDead = ctx.k.procs.filter((p) => p.name.startsWith('imposter')).every((p) => p.status === 'killed');
          return allDead && evs.some((e, i) => e.type === 'ps' && i > lastKill);
        },
      },
    ],
  },
  {
    id: 'shell/6',
    title: 'Backgrounder',
    teach: ['&', 'jobs', 'fg', 'Ctrl-Z', 'bg'],
    brief:
      'A crawler takes forever, and you have other work to do. Append & to run it in the background. ' +
      'jobs lists your background jobs, fg pulls one to the foreground, Ctrl-Z suspends the foreground job, bg resumes it in the back.',
    hints: [
      './agents/crawler.sh & — note the ampersand.',
      'While it crawls, run anything else — that is the point.',
      'fg to grab it, Ctrl-Z to freeze it, bg to shove it back. The full job-control loop.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({ 'crawler.sh': file('#!/bin/sh\n# crawls the docs\n', { exec: true }) }),
      });
      k.registerProgram(
        '/home/dev/agents/crawler.sh',
        agentProgram({ name: 'crawler', log: '/var/log/crawler.log', lines: ['GET /docs/page-{t} 200'], period: 4, cpu: 2.1 })
      );
    },
    objectives: [
      { text: 'Launch in background: ./agents/crawler.sh &', check: (ctx) => ctx.has('spawn', (e) => e.name === 'crawler' && e.bg) },
      { text: 'List your jobs with jobs', check: (ctx) => ctx.has('jobs') },
      { text: 'Pull it to the foreground with fg', check: (ctx) => ctx.has('fg', (e) => e.name === 'crawler') },
      { text: 'Suspend it with Ctrl-Z', check: (ctx) => ctx.has('ctrl', (e) => e.key === 'z') },
      { text: 'Resume it in the background with bg', check: (ctx) => ctx.has('bg', (e) => e.name === 'crawler') },
    ],
  },
  {
    id: 'shell/7',
    title: 'Log Surfer',
    teach: ['tail -f', 'Ctrl-C'],
    brief:
      'Three agents stream into /var/log/fleet.log. One of them has started failing — but only occasionally. ' +
      'tail -f follows a file live, printing new lines as they arrive. Watch until you spot the flaky agent, ' +
      'Ctrl-C to stop following, then file your verdict: echo <name> > suspect.txt (just the name: alpha, beta or gamma).',
    hints: [
      'tail -f /var/log/fleet.log … now wait and watch.',
      'Ctrl-C stops tail (it kills the foreground process).',
      'Saw "ERROR [agent-beta]"? Then: echo beta > suspect.txt',
    ],
    setup(k) {
      k.vfs.root = baseTree({});
      k.vfs.write('/var/log/fleet.log', 'INFO fleet boot\n');
      let t = 0;
      k.spawn({
        cmd: 'fleetd', name: 'fleetd', bg: true,
        program: {
          name: 'fleetd', cpu: 0.5,
          onTick(proc, kernel) {
            t++;
            if (t % 3 !== 0) return;
            const n = t / 3;
            const agents = ['alpha', 'beta', 'gamma'];
            const a = agents[n % 3];
            let line = `INFO [agent-${a}] heartbeat ok`;
            if (a === 'beta' && n % 2 === 1) line = `ERROR [agent-beta] task failed: connection reset`;
            kernel.vfs.append('/var/log/fleet.log', line + '\n');
          },
        },
      });
    },
    objectives: [
      { text: 'Follow the log live: tail -f /var/log/fleet.log', check: (ctx) => ctx.has('tail-f', (e) => e.path.endsWith('fleet.log')) },
      { text: 'Stop following with Ctrl-C', check: (ctx) => ctx.has('tail-f') && ctx.has('ctrl', (e) => e.key === 'c') },
      {
        text: 'Name the flaky agent: echo <name> > suspect.txt',
        check(ctx) {
          const c = ctx.vfs.read('/home/dev/suspect.txt');
          return c !== null && c.trim().replace(/^agent-/, '') === 'beta';
        },
      },
    ],
  },
  {
    id: 'shell/8',
    title: 'Env Wizard',
    teach: ['export', 'env', '$VAR'],
    brief:
      'The launcher refuses to start without credentials. Environment variables are how you hand secrets and switches ' +
      'to programs: export API_KEY=sk-fleet-42 sets one, $API_KEY reads it back, env shows them all.',
    hints: [
      'The launcher tells you exactly what it is missing — run it and read.',
      'export API_KEY=sk-fleet-42 then export AGENT_MODE=turbo.',
      'echo $API_KEY to confirm what a variable holds.',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({ 'launcher.sh': file('#!/bin/sh\n# launches the fleet\n', { exec: true }) }),
      });
      k.registerProgram('/home/dev/agents/launcher.sh', (argv, kernel) => {
        if (kernel.env.API_KEY !== 'sk-fleet-42') {
          return { name: 'launcher', immediateError: 'launcher: FATAL: API_KEY is not set (expected sk-fleet-42)' };
        }
        if (kernel.env.AGENT_MODE !== 'turbo') {
          return { name: 'launcher', immediateError: 'launcher: FATAL: AGENT_MODE must be "turbo"' };
        }
        let t = 0;
        return {
          name: 'launcher', cpu: 3.0,
          onTick(proc, k2) {
            if (++t === 2) {
              k2.vfs.write('/home/dev/launched.ok', 'fleet launched in turbo mode\n');
              proc.fgLines.push('launcher: fleet is UP ✔');
              proc.status = 'done';
            }
          },
        };
      });
    },
    objectives: [
      { text: 'Run ./agents/launcher.sh and read why it fails', check: (ctx) => ctx.has('cmd', (e) => e.line.includes('launcher.sh')) },
      { text: 'export API_KEY=sk-fleet-42', check: (ctx) => ctx.has('export', (e) => e.key === 'API_KEY' && e.value === 'sk-fleet-42') },
      { text: 'Inspect a variable: echo $API_KEY', check: (ctx) => ctx.has('cmd', (e) => /echo\s+.*\$API_KEY/.test(e.line)) },
      { text: 'Set AGENT_MODE=turbo and launch successfully', check: (ctx) => ctx.vfs.read('/home/dev/launched.ok') !== null },
    ],
  },
  {
    id: 'shell/9',
    title: 'Line Surgeon',
    teach: ['Ctrl-A', 'Ctrl-E', 'Ctrl-U', 'Ctrl-K', '↑', 'Ctrl-R', '!!'],
    brief:
      'Fast operators never retype a long command. Ctrl-A jumps to the start of the line, Ctrl-E to the end, ' +
      'Ctrl-U wipes to the start, Ctrl-K to the end, ↑ recalls history, Ctrl-R searches it, !! reruns the last command. ' +
      'Your history is pre-loaded with a deploy command that has a typo — resurrect it, fix it, ship it.',
    hints: [
      'Press ↑ a few times — the broken deploy is in there (or Ctrl-R and type "deploy").',
      'The typo: --env prod is misspelled as --env prid. Ctrl-E, then edit.',
      'Practice each shortcut once to tick the boxes — they are muscle-memory keys.',
    ],
    setup(k, sh) {
      k.vfs.root = baseTree({
        agents: dir({ 'deploy.sh': file('#!/bin/sh\n# ship it\n', { exec: true }) }),
      });
      k.registerProgram('/home/dev/agents/deploy.sh', (argv) => {
        if (argv.includes('--env') && argv[argv.indexOf('--env') + 1] === 'prod') {
          let t = 0;
          return {
            name: 'deploy', cpu: 1.0,
            onTick(proc, k2) {
              if (++t === 2) {
                k2.vfs.write('/home/dev/deployed.ok', 'ok\n');
                proc.fgLines.push('deploy: ✔ shipped to prod');
                proc.status = 'done';
              }
            },
          };
        }
        return { name: 'deploy', immediateError: `deploy: unknown environment: ${argv[argv.indexOf('--env') + 1] || '(none)'}` };
      });
      sh.history.push(
        'ls agents',
        './agents/deploy.sh --env prid --fleet all --confirm yes-i-am-sure',
        'cat README.txt'
      );
    },
    objectives: [
      { text: 'Recall history with ↑ or Ctrl-R', check: (ctx) => ctx.has('hist') || ctx.has('ctrl', (e) => e.key === 'r') },
      { text: 'Jump to line start with Ctrl-A', check: (ctx) => ctx.has('ctrl', (e) => e.key === 'a') },
      { text: 'Jump to line end with Ctrl-E', check: (ctx) => ctx.has('ctrl', (e) => e.key === 'e') },
      { text: 'Wipe a line with Ctrl-U (or Ctrl-K)', check: (ctx) => ctx.has('ctrl', (e) => e.key === 'u' || e.key === 'k') },
      { text: 'Ship the fixed deploy (--env prod)', check: (ctx) => ctx.vfs.read('/home/dev/deployed.ok') !== null },
    ],
  },
  {
    id: 'shell/13',
    title: 'Field Surgeon',
    teach: ['awk', 'cut', 'sed'],
    brief:
      'The access log is a table pretending to be text: "agent-name latency task status" per line. awk \'{print $1}\' ' +
      'slices out a whitespace column, cut -d" " -f2 does it by delimiter, sed \'s/old/new/\' rewrites on the way past. ' +
      'Chain them with sort | uniq -c to find which agent is spamming the API — then file your verdict.',
    hints: [
      "awk '{print $1}' logs/access.log — just the agent column.",
      "awk '{print $1}' logs/access.log | sort | uniq -c | sort -rn — counted, ranked.",
      "sed 's/agent-//' strips the prefix. Verdict: echo <name> > offender.txt (bare name, no prefix).",
    ],
    setup(k) {
      const lines = [];
      const seq = ['beta', 'alpha', 'beta', 'gamma', 'beta', 'alpha', 'beta'];
      const statuses = ['ok', 'ok', 'ok', 'retry'];
      for (let i = 0; i < 28; i++) {
        const name = seq[i % seq.length];
        lines.push(`agent-${name} ${80 + ((i * 37) % 400)}ms task-${100 + i} ${statuses[i % statuses.length]}`);
      }
      k.vfs.root = baseTree({
        logs: dir({ 'access.log': file(lines.join('\n') + '\n') }),
      });
    },
    objectives: [
      { text: "Slice a column: awk '{print $1}' logs/access.log", check: (ctx) => ctx.has('awk') },
      { text: 'Do it with cut too: cut -d" " -f2 logs/access.log', check: (ctx) => ctx.has('cut') },
      {
        text: 'Rank the chattiest agent: awk … | sort | uniq -c | sort -rn',
        check: (ctx) => ctx.has('pipeline', (e) => (e.cmds.includes('awk') || e.cmds.includes('cut')) && e.cmds.includes('uniq')),
      },
      { text: "Strip prefixes in the stream: … | sed 's/agent-//'", check: (ctx) => ctx.has('sed', (e) => e.expr.includes('agent-')) },
      {
        text: 'File the verdict: echo <name> > offender.txt',
        check(ctx) {
          const c = ctx.vfs.read('/home/dev/offender.txt');
          return c !== null && c.trim().replace(/^agent-/, '') === 'beta';
        },
      },
    ],
  },
  {
    id: 'shell/10',
    title: 'Boss: Swarm Commander',
    teach: ['everything'],
    brief:
      'The real thing: run three agents in parallel, babysit them, and assemble the results. ' +
      'alpha and gamma finish on their own and write JSON to results/. beta WILL hang — watch for it, kill it. ' +
      'When the dust settles, concatenate the surviving results into summary.json.',
    hints: [
      'Launch all three: ./agents/alpha.sh & ./agents/beta.sh & ./agents/gamma.sh &',
      'Watch: jobs, ps, tail -f /var/log/swarm.log. beta stops writing results and just spins.',
      'kill <beta’s PID>, then: cat results/alpha.json results/gamma.json > summary.json',
    ],
    setup(k) {
      k.vfs.root = baseTree({
        agents: dir({
          'alpha.sh': file('#!/bin/sh\n', { exec: true }),
          'beta.sh': file('#!/bin/sh\n', { exec: true }),
          'gamma.sh': file('#!/bin/sh\n', { exec: true }),
        }),
        results: dir({}),
      });
      k.vfs.write('/var/log/swarm.log', '== swarm log ==\n');
      k.registerProgram('/home/dev/agents/alpha.sh', agentProgram({
        name: 'alpha', log: '/var/log/swarm.log', period: 3, cpu: 2.0,
        lines: ['INFO [alpha] crunching batch {t}'], dieAfter: 4,
        resultFile: '/home/dev/results/alpha.json', resultContent: '{"agent": "alpha", "tasks": 128, "status": "complete"}\n',
      }));
      k.registerProgram('/home/dev/agents/gamma.sh', agentProgram({
        name: 'gamma', log: '/var/log/swarm.log', period: 4, cpu: 1.7,
        lines: ['INFO [gamma] indexing shard {t}'], dieAfter: 4,
        resultFile: '/home/dev/results/gamma.json', resultContent: '{"agent": "gamma", "tasks": 96, "status": "complete"}\n',
      }));
      k.registerProgram('/home/dev/agents/beta.sh', agentProgram({
        name: 'beta', log: '/var/log/swarm.log', period: 3, cpu: 51.0,
        lines: ['WARN [beta] retrying lock...', 'WARN [beta] still waiting on lock'],
      }));
    },
    objectives: [
      {
        text: 'Launch all three agents in the background',
        check: (ctx) => ['alpha', 'beta', 'gamma'].every((n) => ctx.has('spawn', (e) => e.name === n && e.bg)),
      },
      { text: 'Monitor the swarm (jobs, ps, or tail -f)', check: (ctx) => ctx.has('jobs') || ctx.has('ps') || ctx.has('tail-f') },
      {
        text: 'alpha and gamma deliver their results',
        check: (ctx) => ctx.vfs.read('/home/dev/results/alpha.json') !== null && ctx.vfs.read('/home/dev/results/gamma.json') !== null,
      },
      { text: 'Put beta out of its misery (kill its PID)', check: (ctx) => ctx.has('kill', (e) => e.name === 'beta') },
      {
        text: 'Assemble: cat results/*.json > summary.json',
        check(ctx) {
          const c = ctx.vfs.read('/home/dev/summary.json');
          return c !== null && c.includes('"alpha"') && c.includes('"gamma"');
        },
      },
    ],
  },
];
