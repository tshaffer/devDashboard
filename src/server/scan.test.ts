import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectConfig } from './config.js';
import { buildViews, parseCwds, parseListening, parsePs, type Snapshot } from './scan.js';

const ps = [
  '  100     1 Tue Nov 17 06:05:35 2026 ttys001  -zsh',
  '  101   100 Tue Nov 17 06:05:36 2026 ttys001  npm run dev',
  '  102   101 Tue Nov 17 06:05:36 2026 ttys001  node /x/node_modules/.bin/concurrently web api',
  '  103   102 Tue Nov 17 06:05:37 2026 ttys001  node /x/node_modules/.bin/vite',
  '  104   102 Tue Nov 17 06:05:37 2026 ttys001  node /x/node_modules/.bin/tsx watch src/index.ts',
  '  200     1 Wed Nov 18 07:00:00 2026 ttys002  node /y/node_modules/.bin/vite',
  '  300     1 Wed Nov 18 07:00:00 2026 ??       /usr/local/bin/claude --resume',
].join('\n');

const cwd = ['p100', 'n/p/a', 'p101', 'n/p/a', 'p102', 'n/p/a', 'p103', 'n/p/a/web', 'p104', 'n/p/a/api', 'p200', 'n/p/b/web', 'p300', 'n/p/a'].join('\n');
const listen = ['p103', 'n*:5174', 'p104', 'n127.0.0.1:4000', 'n[::1]:4000', 'p200', 'n*:5173'].join('\n');

const snapshot: Snapshot = { procs: parsePs(ps), cwds: parseCwds(cwd), listening: parseListening(listen) };

const projects: ProjectConfig[] = [
  {
    id: 'a',
    name: 'A',
    folder: '/p/a',
    url: 'http://localhost:5173',
    parts: [
      { id: 'web', label: 'Web', folder: 'web', port: 5173 },
      { id: 'api', label: 'API', folder: 'api', port: 4000 },
    ],
  },
  { id: 'b', name: 'B', folder: '/p/b', parts: [{ id: 'web', label: 'Web', folder: 'web', port: 5173 }] },
];

test('parses ps, cwd and listening ports', () => {
  assert.equal(snapshot.procs.get(103)?.tty, 'ttys001');
  assert.equal(snapshot.procs.get(300)?.tty, undefined);
  assert.equal(snapshot.cwds.get(104), '/p/a/api');
  assert.deepEqual(snapshot.listening.get(104), [4000]);
});

test('groups processes into parts and follows the real Vite port', () => {
  const [a, b] = buildViews(projects, snapshot, new Set(), new Map());
  assert.equal(a?.state, 'running');
  assert.deepEqual(a?.shared.map((p) => p.pid), [101, 102]);
  assert.deepEqual(a?.parts[0]?.ports, [5174]);
  assert.equal(a?.parts[0]?.portTakenBy, 'B');
  // One `npm run dev` started both parts, so neither can be stopped alone.
  assert.equal(a?.parts[0]?.separatelyStoppable, false);
  assert.equal(a?.url, 'http://localhost:5174');
  // The Claude CLI and the shell are not dev tools, so they never count.
  assert.ok(![...(a?.shared ?? [])].some((p) => p.pid === 300 || p.pid === 100));
  assert.equal(b?.state, 'running');
});

test('a stopped project whose port another project holds gets no link', () => {
  const onlyB: Snapshot = { ...snapshot, cwds: new Map([[200, '/p/b/web']]) };
  const [a] = buildViews(projects, onlyB, new Set(), new Map());
  assert.equal(a?.state, 'stopped');
  assert.equal(a?.url, undefined);
  assert.match(a?.warnings[0] ?? '', /Port 5173 is in use by B/);
});
