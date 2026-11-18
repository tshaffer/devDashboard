import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DashboardState } from '../shared/types.js';
import { loadProjects, partFolder, PROJECT_ROOT, type ProjectConfig } from './config.js';
import { buildViews, takeSnapshot } from './scan.js';

const run = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = Number(process.env.DEVDASHBOARD_PORT ?? 4190);
const STOP_DEV_APP = join(homedir(), '.local/bin/stop-dev-app');
const projects = loadProjects();
const app = express();

// This server can stop and start programs, so only this machine's own page may talk to it.
const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));

function localOnly(req: Request, res: Response, next: NextFunction): void {
  const originOk = !req.headers.origin || allowedOrigins.has(req.headers.origin);
  const headerOk = req.method === 'GET' || req.headers['x-devdashboard'] === '1';
  if (!allowedHosts.has(req.headers.host ?? '') || !originOk || !headerOk) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

app.use(localOnly);
app.use(express.json());

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => {
    handler(req, res).catch((error: unknown) => {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    });
  };

async function busyReasons(): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  await Promise.all(
    projects
      .filter((project) => project.guard === 'backerUpperJob' && project.url)
      .map(async (project) => {
        try {
          const res = await fetch(`${project.url}/api/state`, { signal: AbortSignal.timeout(1500) });
          const state = (await res.json()) as { job?: { status?: string; kind?: string } | null };
          if (state.job?.status === 'running') {
            reasons.set(project.id, state.job.kind === 'plan' ? 'A backup check is running.' : 'A backup is running.');
          }
        } catch {
          // Not running or not answering: nothing to protect.
        }
      }),
  );
  return reasons;
}

let pending: Promise<DashboardState> | undefined;
function scan(): Promise<DashboardState> {
  // Several polls arriving together share one scan.
  pending ??= (async () => {
    const [snapshot, busy] = await Promise.all([takeSnapshot(), busyReasons()]);
    return {
      projects: buildViews(projects, snapshot, new Set([process.pid]), busy),
      scannedAt: new Date().toISOString(),
    };
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}

function findProject(id: unknown): ProjectConfig {
  const project = projects.find((p) => p.id === id);
  if (!project) throw new Error('Unknown project.');
  return project;
}

app.get(
  '/api/state',
  asyncRoute(async (_req, res) => {
    res.json(await scan());
  }),
);

app.post(
  '/api/projects/:id/stop',
  asyncRoute(async (req, res) => {
    const project = findProject(req.params.id);
    const { part: partId, force } = req.body as { part?: string; force?: boolean };
    const busy = (await busyReasons()).get(project.id);
    if (busy && !force) throw new Error(`${busy} Stopping ${project.name} now would interrupt it.`);

    let folder = project.folder;
    if (partId) {
      const part = project.parts.find((p) => p.id === partId);
      if (!part) throw new Error('Unknown part.');
      const view = (await scan()).projects.find((p) => p.id === project.id)?.parts.find((p) => p.id === partId);
      if (!view?.separatelyStoppable) {
        throw new Error(`${part.label} was started together with the rest of ${project.name}, so stop the whole project.`);
      }
      folder = partFolder(project, part);
    }
    if (!existsSync(STOP_DEV_APP)) throw new Error(`${STOP_DEV_APP} is missing.`);
    await run(STOP_DEV_APP, [folder], { timeout: 30_000 });
    res.json(await scan());
  }),
);

app.post(
  '/api/projects/:id/launch',
  asyncRoute(async (req, res) => {
    const project = findProject(req.params.id);
    if (!project.launcher || !existsSync(project.launcher)) {
      throw new Error(`${project.name} has no launcher app at ${project.launcher ?? '(none set)'}.`);
    }
    // backerUpper's launcher only opens the page when it is already running, so a launch never
    // interrupts a backup. The launcher stops any old copy, opens iTerm and Chrome, so this returns right away.
    await run('/usr/bin/open', [project.launcher]);
    res.json({ ok: true });
  }),
);

const dist = join(PROJECT_ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`devDashboard listening on http://${HOST}:${PORT}`);
});
