# devDashboard

A local page that shows which of your personal projects' dev servers and watchers are running, and lets you stop, launch or restart each one.

Open it from Spotlight (**devDashboard**) or go to <http://127.0.0.1:4190>. The server listens only on this Mac.

## What it shows

Each project card shows:
- **Running**, **Partly running** or **Stopped**.
- Each part (web, API, watcher), whether it's up, and the port it actually listens on. Vite moves to the next free port when its usual one is taken, and the Open link follows it.
- Warnings:
  - when another project or program holds a port this one needs;
  - when a process was started by a Claude Code session rather than by you;
  - when stopping backerUpper would interrupt a backup.
- A **Processes** list with each process ID, command, ports, and terminal.

The page refreshes every 3 seconds.

## How it works

- **Finding processes.** A process belongs to a project when it is a dev tool (node, npm, pnpm, tsx, webpack, vite and so on) running from inside the project's folder. Its child processes belong to the project too. These are the same rules `~/.local/bin/stop-dev-app` uses, so the page shows exactly what Stop will stop.
- **Stop** runs `stop-dev-app` on the project's folder. It stops the processes and closes the iTerm panes they leave behind. A part gets its own Stop button when it runs in its own pane, as Chatalog's backend and frontend do. It gets none when one `pnpm dev` started all the parts.
- **Launch / Restart** opens the project's launcher app in `/Applications`. Each launcher stops any old copy first.

Projects are listed in [config/projects.json](config/projects.json).

## Launcher apps

`scripts/install-launchers.sh` builds an app in `/Applications` from each file in [launchers/](launchers/): **Tedmarks**, **hrCollector** and **Chatworthy**. It also installs `~/.local/bin/dev-app-port`, which the Tedmarks launcher uses to find the port Vite started on. Rerun the script after editing a launcher. It never overwrites an app it didn't make.

The first time each new launcher runs, macOS asks whether it may control iTerm. Click Allow.

## Commands

| Command | What it does |
|---|---|
| `pnpm start` | Build the page and serve everything at `:4190` |
| `pnpm dev` | Run the API on `:4190` and Vite on `http://127.0.0.1:5190` while you work on devDashboard |
| `pnpm test` / `pnpm typecheck` | Run the tests / check the types |
| `scripts/install-app.sh` | Build `/Applications/devDashboard.app`. Rerun it if Node or this folder moves. |

The Spotlight app starts the server in the background and logs to `~/Library/Logs/devDashboard.log`. After you change the code, stop it so the next launch picks up the change:

```bash
pkill -f 'devDashboard/node_modules/.*tsx.*src/server/index.ts'
```
