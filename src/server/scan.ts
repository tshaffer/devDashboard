import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import type { PartView, ProcView, ProjectView } from '../shared/types.js';
import { type ProjectConfig, partFolder } from './config.js';

const run = promisify(execFile);

// The same rules as ~/.local/bin/stop-dev-app, so the page shows exactly what Stop would stop.
const TOOLS = /^(node|npm|npx|pnpm|yarn|tsx|tsc|webpack|vite|next|next-server|turbo|esbuild|concurrently|nodemon)$/;
const NEVER = /(^|\/)claude( |$)|@anthropic-ai\/|modelcontextprotocol/;

export interface Proc {
  pid: number;
  ppid: number;
  startedAt: string;
  tty?: string;
  command: string;
}

export interface Snapshot {
  procs: Map<number, Proc>;
  cwds: Map<number, string>;
  listening: Map<number, number[]>;
}

/** Parses `ps -axo pid=,ppid=,lstart=,tty=,command=`. lstart is always five words. */
export function parsePs(text: string): Map<number, Proc> {
  const procs = new Map<number, Proc>();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, lstart, tty, command] = match as unknown as [string, string, string, string, string, string];
    const started = new Date(lstart);
    procs.set(Number(pid), {
      pid: Number(pid),
      ppid: Number(ppid),
      startedAt: Number.isNaN(started.getTime()) ? lstart : started.toISOString(),
      tty: tty === '??' ? undefined : tty,
      command,
    });
  }
  return procs;
}

/** Parses `lsof -F pn` output into pid → name lines. */
function parseLsofNames(text: string): Map<number, string[]> {
  const result = new Map<number, string[]>();
  let pid = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) {
      const list = result.get(pid) ?? [];
      list.push(line.slice(1));
      result.set(pid, list);
    }
  }
  return result;
}

export function parseCwds(text: string): Map<number, string> {
  const cwds = new Map<number, string>();
  for (const [pid, names] of parseLsofNames(text)) if (names[0]) cwds.set(pid, names[0]);
  return cwds;
}

export function parseListening(text: string): Map<number, number[]> {
  const ports = new Map<number, number[]>();
  for (const [pid, names] of parseLsofNames(text)) {
    const list = [...new Set(names.map((name) => Number(name.slice(name.lastIndexOf(':') + 1))))]
      .filter((port) => Number.isInteger(port) && port > 0)
      .sort((a, b) => a - b);
    if (list.length) ports.set(pid, list);
  }
  return ports;
}

async function output(cmd: string, args: string[]): Promise<string> {
  try {
    return (await run(cmd, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (error) {
    // lsof exits 1 when some processes can't be read but still prints the rest.
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout === 'string') return stdout;
    throw error;
  }
}

export async function takeSnapshot(): Promise<Snapshot> {
  const [ps, cwd, listen] = await Promise.all([
    output('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,tty=,command=']),
    output('/usr/sbin/lsof', ['-w', '-d', 'cwd', '-F', 'pn']),
    output('/usr/sbin/lsof', ['-w', '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']),
  ]);
  return { procs: parsePs(ps), cwds: parseCwds(cwd), listening: parseListening(listen) };
}

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

const toolName = (command: string): string => {
  const first = command.split(' ')[0] ?? '';
  return first.slice(first.lastIndexOf('/') + 1);
};

/** Processes running from inside `dir`, plus all their children, as stop-dev-app finds them. */
export function processesIn(snapshot: Snapshot, dir: string, exclude: Set<number>): Set<number> {
  const found = new Set<number>();
  for (const [pid, cwd] of snapshot.cwds) {
    const proc = snapshot.procs.get(pid);
    if (!proc || exclude.has(pid) || !inside(cwd, dir)) continue;
    if (!TOOLS.test(toolName(proc.command)) || NEVER.test(proc.command)) continue;
    found.add(pid);
  }
  const children = new Map<number, number[]>();
  for (const proc of snapshot.procs.values()) {
    children.set(proc.ppid, [...(children.get(proc.ppid) ?? []), proc.pid]);
  }
  const queue = [...found];
  while (queue.length) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (!found.has(child) && !exclude.has(child)) {
        found.add(child);
        queue.push(child);
      }
    }
  }
  return found;
}

/** True when an ancestor is the Claude Code CLI, which means a Claude session started it. */
function fromClaude(snapshot: Snapshot, pid: number): boolean {
  let current = snapshot.procs.get(pid);
  for (let depth = 0; current && depth < 30; depth++) {
    if (/\/claude( |$)/.test(current.command) && current.command.includes('claude-code')) return true;
    current = snapshot.procs.get(current.ppid);
  }
  return false;
}

function view(snapshot: Snapshot, pid: number): ProcView {
  const proc = snapshot.procs.get(pid)!;
  return {
    fromClaude: fromClaude(snapshot, pid),
    pid,
    command: proc.command,
    startedAt: proc.startedAt,
    tty: proc.tty,
    ports: snapshot.listening.get(pid) ?? [],
  };
}

export function buildViews(
  projects: ProjectConfig[],
  snapshot: Snapshot,
  exclude: Set<number>,
  busy: Map<string, string>,
): ProjectView[] {
  const owned = projects.map((project) => processesIn(snapshot, real(project.folder), exclude));
  const ownerOfPid = new Map<number, string>();
  owned.forEach((pids, i) => pids.forEach((pid) => ownerOfPid.set(pid, projects[i]!.name)));

  const portOwner = (port: number): string | undefined => {
    for (const [pid, ports] of snapshot.listening) {
      if (!ports.includes(port)) continue;
      const proc = snapshot.procs.get(pid);
      return ownerOfPid.get(pid) ?? (proc ? `${toolName(proc.command)} (pid ${pid})` : `pid ${pid}`);
    }
    return undefined;
  };

  return projects.map((project, i): ProjectView => {
    const pids = owned[i]!;
    const folders = project.parts.map((part) => real(partFolder(project, part)));

    // A process belongs to the part whose folder holds it most specifically. Children that run
    // elsewhere follow their parent. Processes in none of the parts run the whole project.
    const partOf = new Map<number, number>();
    const assign = (pid: number, seen = new Set<number>()): number => {
      if (partOf.has(pid)) return partOf.get(pid)!;
      seen.add(pid);
      const cwd = snapshot.cwds.get(pid);
      let best = -1;
      if (cwd) {
        folders.forEach((folder, index) => {
          if (inside(cwd, folder) && (best < 0 || folder.length > folders[best]!.length)) best = index;
        });
      }
      const parent = snapshot.procs.get(pid)?.ppid;
      if (best < 0 && parent && pids.has(parent) && !seen.has(parent)) best = assign(parent, seen);
      partOf.set(pid, best);
      return best;
    };
    const sorted = [...pids].sort((a, b) => a - b);
    sorted.forEach((pid) => assign(pid));

    const parts = project.parts.map((part, index): PartView => {
      const mine = sorted.filter((pid) => partOf.get(pid) === index);
      const ports = [...new Set(mine.flatMap((pid) => snapshot.listening.get(pid) ?? []))].sort((a, b) => a - b);
      const state = mine.length === 0 ? 'down' : !part.port || ports.length > 0 ? 'up' : 'starting';
      const startedByOther = mine.some((pid) => {
        const parent = snapshot.procs.get(pid)?.ppid;
        return parent !== undefined && pids.has(parent) && partOf.get(parent) !== index;
      });
      const holder = part.port && !ports.includes(part.port) ? portOwner(part.port) : undefined;
      return {
        id: part.id,
        label: part.label,
        expectedPort: part.port,
        state,
        ports,
        processes: mine.map((pid) => view(snapshot, pid)),
        separatelyStoppable: project.parts.length > 1 && mine.length > 0 && !startedByOther,
        portTakenBy: holder && holder !== project.name ? holder : undefined,
      };
    });

    const shared = sorted.filter((pid) => partOf.get(pid) === -1).map((pid) => view(snapshot, pid));
    const upCount = parts.filter((part) => part.state === 'up').length;
    const state =
      pids.size === 0 ? 'stopped' : upCount === parts.length ? 'running' : 'partial';

    const warnings: string[] = [];
    const all = [...shared, ...parts.flatMap((part) => part.processes)];
    if (all.some((proc) => proc.fromClaude)) {
      warnings.push('Some of these processes were started by a Claude Code session, which may still be using them.');
    }
    let url = project.url;
    for (const part of parts) {
      if (part.portTakenBy) {
        warnings.push(
          part.state === 'down'
            ? `Port ${part.expectedPort} is in use by ${part.portTakenBy}, so ${part.label} will start on another port.`
            : `${part.label} wanted port ${part.expectedPort}, which ${part.portTakenBy} has.`,
        );
      }
      // Another project holds the address this one opens at, so the link would open the wrong app.
      if (url && part.portTakenBy && part.state !== 'up' && Number(new URL(url).port) === part.expectedPort) {
        url = undefined;
      }
      // When Vite moved to another port, open the port it actually took.
      if (url && part.expectedPort && part.state === 'up' && !part.ports.includes(part.expectedPort)) {
        const parsed = new URL(url);
        if (Number(parsed.port) === part.expectedPort && part.ports[0]) {
          parsed.port = String(part.ports[0]);
          url = parsed.toString().replace(/\/$/, '');
        }
      }
    }

    return {
      id: project.id,
      name: project.name,
      folder: project.folder,
      note: project.note,
      url,
      state,
      parts,
      shared,
      launcher: project.launcher,
      launcherExists: Boolean(project.launcher && existsSync(project.launcher)),
      busy: busy.get(project.id),
      warnings,
    };
  });
}
