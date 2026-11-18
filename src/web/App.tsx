import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardState, PartView, ProcView, ProjectView } from '../shared/types';

const POLL_MS = 3000;
const LAUNCH_WAIT_MS = 120_000;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-devdashboard': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function since(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

const stateLabel: Record<ProjectView['state'], string> = {
  running: 'Running',
  partial: 'Partly running',
  stopped: 'Stopped',
};

const partLabel: Record<PartView['state'], string> = { up: 'Up', starting: 'No port yet', down: 'Down' };

/** Shortens absolute paths inside a command so it fits on a line. */
function shortCommand(command: string, folder: string): string {
  return command
    .replaceAll(`${folder}/`, '')
    .replace(/\/Users\/[^/ ]+\/\.nvm\/versions\/node\/[^/ ]+\/bin\//g, '')
    .replace(/\S*node_modules\/\S*\/([^/ ]+)/g, '$1')
    .trim();
}

function oldest(processes: ProcView[]): string | undefined {
  return processes.map((p) => p.startedAt).sort()[0];
}

type Busy = { kind: 'stop' | 'launch'; part?: string; until?: number };

function ProjectCard({
  project,
  busy,
  onStop,
  onLaunch,
}: {
  project: ProjectView;
  busy?: Busy;
  onStop: (project: ProjectView, part?: PartView) => void;
  onLaunch: (project: ProjectView) => void;
}) {
  const all = [...project.shared, ...project.parts.flatMap((part) => part.processes)];
  const started = oldest(all);
  const working = Boolean(busy);
  const launching = busy?.kind === 'launch';

  return (
    <section className={`card ${project.state}`}>
      <div className="card-head">
        <div className="title">
          <span className={`dot ${project.state}`} aria-hidden />
          <h2>{project.name}</h2>
          <span className={`state ${project.state}`}>
            {launching ? 'Launching…' : busy?.kind === 'stop' ? 'Stopping…' : stateLabel[project.state]}
          </span>
        </div>
        <div className="actions">
          {project.url && project.state !== 'stopped' && (
            <a className="button" href={project.url} target="_blank" rel="noreferrer">
              Open
            </a>
          )}
          {project.state !== 'stopped' && (
            <button type="button" className="danger" disabled={working} onClick={() => onStop(project)}>
              Stop
            </button>
          )}
          {project.launcherExists ? (
            <button type="button" className="primary" disabled={working} onClick={() => onLaunch(project)}>
              {project.state === 'stopped' ? 'Launch' : 'Restart'}
            </button>
          ) : (
            <span className="muted" title={project.launcher}>No launcher app</span>
          )}
        </div>
      </div>

      <p className="muted meta">
        {project.url ? <span>{project.url.replace(/^https?:\/\//, '')}</span> : null}
        {started ? <span>started {since(started)}</span> : null}
        {all.length ? <span>{all.length} processes</span> : null}
      </p>

      {project.busy && <div className="banner warn">{project.busy} Stopping it now would interrupt it.</div>}
      {project.warnings.map((warning) => (
        <div key={warning} className="banner warn">
          {warning}
        </div>
      ))}
      {project.note && <p className="muted note">{project.note}</p>}

      <ul className="parts">
        {project.parts.map((part) => (
          <li key={part.id} className="part">
            <span className={`pill ${part.state}`}>{partLabel[part.state]}</span>
            <span className="part-name">{part.label}</span>
            <span className="muted port">
              {part.ports.length
                ? part.ports.map((p) => `:${p}`).join(' ')
                : part.expectedPort
                  ? `:${part.expectedPort}`
                  : ''}
            </span>
            {part.separatelyStoppable && (
              <button
                type="button"
                className="small"
                disabled={working}
                onClick={() => onStop(project, part)}
                title={`Stop only ${part.label}`}
              >
                Stop
              </button>
            )}
          </li>
        ))}
      </ul>

      {all.length > 0 && (
        <details>
          <summary className="muted">Processes</summary>
          <table className="procs">
            <tbody>
              {all.map((proc) => (
                <tr key={proc.pid}>
                  <td className="num">{proc.pid}</td>
                  <td className="cmd" title={proc.command}>
                    {shortCommand(proc.command, project.folder)}
                  </td>
                  <td className="muted">{proc.ports.map((p) => `:${p}`).join(' ')}</td>
                  <td className="muted nowrap">{proc.fromClaude ? 'Claude session' : (proc.tty ?? 'background')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

export function App() {
  const [state, setState] = useState<DashboardState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const refresh = useCallback(async () => {
    try {
      const next = await api<DashboardState>('/api/state');
      setState(next);
      setError(undefined);
      // A launch is finished once every part is up, or after two minutes.
      const done = Object.entries(busyRef.current).filter(([id, b]) => {
        if (b.kind !== 'launch') return false;
        const project = next.projects.find((p) => p.id === id);
        return project?.state === 'running' || Date.now() > (b.until ?? 0);
      });
      if (done.length) {
        setBusy((current) => {
          const copy = { ...current };
          for (const [id] of done) delete copy[id];
          return copy;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const stop = async (project: ProjectView, part?: PartView) => {
    const what = part ? `${part.label} of ${project.name}` : project.name;
    let force = false;
    if (project.busy) {
      if (!window.confirm(`${project.busy}\n\nStop ${what} anyway? This will interrupt it.`)) return;
      force = true;
    }
    setBusy((b) => ({ ...b, [project.id]: { kind: 'stop', part: part?.id } }));
    try {
      setState(await api<DashboardState>(`/api/projects/${project.id}/stop`, { part: part?.id, force }));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(({ [project.id]: _, ...rest }) => rest);
    }
  };

  const launch = async (project: ProjectView) => {
    setBusy((b) => ({ ...b, [project.id]: { kind: 'launch', until: Date.now() + LAUNCH_WAIT_MS } }));
    try {
      await api(`/api/projects/${project.id}/launch`, {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(({ [project.id]: _, ...rest }) => rest);
    }
  };

  const projects = state?.projects ?? [];
  const running = projects.filter((p) => p.state !== 'stopped').length;

  return (
    <main>
      <header>
        <h1>devDashboard</h1>
        <p className="muted">
          {state
            ? `${running} of ${projects.length} projects running · checked ${new Date(state.scannedAt).toLocaleTimeString()}`
            : 'Checking…'}
        </p>
      </header>
      {error && <div className="banner bad">{error}</div>}
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} busy={busy[project.id]} onStop={stop} onLaunch={launch} />
      ))}
    </main>
  );
}
