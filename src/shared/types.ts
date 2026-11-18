export interface ProcView {
  pid: number;
  command: string;
  startedAt: string;
  tty?: string;
  ports: number[];
  /** Started from a Claude Code session's shell rather than by you. */
  fromClaude: boolean;
}

export type PartState = 'up' | 'starting' | 'down';

export interface PartView {
  id: string;
  label: string;
  expectedPort?: number;
  state: PartState;
  ports: number[];
  processes: ProcView[];
  /** False when the part was started by a process that also runs other parts (one `pnpm dev`). */
  separatelyStoppable: boolean;
  /** Who holds the expected port, when it isn't this project. */
  portTakenBy?: string;
}

export type ProjectState = 'running' | 'partial' | 'stopped';

export interface ProjectView {
  id: string;
  name: string;
  folder: string;
  note?: string;
  url?: string;
  state: ProjectState;
  parts: PartView[];
  /** Processes that run the whole project from its root, such as `pnpm dev`. */
  shared: ProcView[];
  launcher?: string;
  launcherExists: boolean;
  /** Set when stopping now would interrupt work, such as a backup in progress. */
  busy?: string;
  warnings: string[];
}

export interface DashboardState {
  projects: ProjectView[];
  scannedAt: string;
}
