import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export interface PartConfig {
  id: string;
  label: string;
  /** Relative to the project folder; "." means the whole project. */
  folder: string;
  port?: number;
}

export interface ProjectConfig {
  id: string;
  name: string;
  folder: string;
  launcher?: string;
  url?: string;
  note?: string;
  guard?: 'backerUpperJob';
  parts: PartConfig[];
}

export function loadProjects(): ProjectConfig[] {
  const file = join(PROJECT_ROOT, 'config/projects.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { projects: ProjectConfig[] };
  for (const project of parsed.projects) {
    if (!project.id || !project.folder || !Array.isArray(project.parts) || project.parts.length === 0) {
      throw new Error(`Project "${project.id ?? '?'}" in ${file} needs an id, a folder and at least one part.`);
    }
  }
  return parsed.projects;
}

export function partFolder(project: ProjectConfig, part: PartConfig): string {
  return resolve(project.folder, part.folder);
}
