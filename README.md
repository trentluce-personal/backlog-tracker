# Backlog Tracker

A local-only personal projects and tasks app. Create projects, add and edit tasks,
track **Backlog**, **In Progress**, and **Done**, and search/filter your backlog.
Tasks have descriptions, low/medium/high priority, and optional due dates. Your
data stays in a local SQLite database; there are no accounts or cloud services.

## Requirements

- **Node.js 24.13 or newer**, including npm. `mise.toml` pins **24.21.0** for
  repeatable development; the Docker image uses the same version.
- A current browser. Windows, macOS, and Linux are supported by the startup scripts.
- Run commands from the repository root. Node's built-in SQLite module supplies
  the database; no separate database install is needed.
- Choose native development (optionally managed with mise) or Docker below.

### mise (recommended for native development)

Install [mise](https://mise.jdx.dev/getting-started.html) using its instructions for
your OS. On Windows, use a supported PowerShell terminal and the Windows mise
installation instructions; restart the terminal after installing so `mise` is on
PATH. No global Node installation is required when using mise.

Review `mise.toml`, then from the repository root:

```sh
mise trust
mise install
mise tasks
mise run setup
mise run dev
```

`mise install` downloads the exact pinned Node into mise's normal tool cache;
`mise run setup` uses **`npm ci`** with the root lockfile. npm remains the package
manager. `mise run` works without shell activation. To make `node` and `npm`
available directly, follow mise's shell activation instructions, for example
`mise activate pwsh | Out-String | Invoke-Expression` in PowerShell, or
`eval "$(mise activate bash)"` in Bash (add to your shell profile only if desired).

| Task | Existing command |
| --- | --- |
| `mise run setup` | `npm ci` |
| `mise run dev` | `npm run dev` |
| `mise run build` | `npm run build` |
| `mise run test` | `npm test` |
| `mise run start` | `npm start` (build first) |
| `mise run test:startup` | `npm run test:startup` (build first) |
| `mise run docker:up` | `docker compose up --build -d --wait` |
| `mise run docker:down` | `docker compose down` |
| `mise run docker:logs` | `docker compose logs --follow --tail 100` |

## Setup and development (npm alternative)

With a compatible Node and npm already on PATH, mise is optional:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. This starts the React/Vite frontend and the Node API
together. Both bind to `127.0.0.1`; Vite proxies `/api` to port 3001. Keep ports
5173 and 3001 free. Press **Ctrl+C** to stop both processes.

The root launcher waits for an IPC readiness message from its own API process
before starting Vite. An occupied API port or database startup failure exits the
launcher without exposing the frontend. API source changes restart both processes
in order (frontend stops first); a failed restart stops the development session.
Frontend hot reload remains handled by Vite.

Start by creating a project, then add tasks to it. The database starts empty.
Deleting a project also permanently deletes its tasks; the interface asks for
confirmation. Search and filters run locally over the loaded tasks.

### Theme and motion

Backlog opens in **dark mode** by default, independently of your operating system's
color preference. The visible **Light / Dark** button switches palettes and names
the next action for screen readers. Both palettes use warm neutrals inspired by
dndharness, with Backlog's green accents and existing board layout.

Theme choices are saved in this browser under `backlog-theme` (`dark` or `light`).
Missing/invalid values use dark; the page applies the preference before React
loads, including native controls and the browser's theme color. If browser storage
is unavailable, appearance controls still work for the current page.

Motion defaults to **on**, independently of your operating system's reduced-motion
setting or changes to it. **Motion on** (accessible name: **Motion on — reduce motion**) / **Enable animations**
sets an explicit browser preference in `backlog-motion` (`full` or `reduce`). Saved
choices are retained; missing/invalid values or unavailable storage default to full
motion. Clear that key to restore the default. Full motion includes contact-point/keyboard
button ripples, including on the theme switch. Palette changes are immediate.
Reduced motion switches themes directly and suppresses ornamental motion. Effects
never submit forms or delay other actions; unsupported animation APIs fall back to
ordinary controls.

## Build and run locally

```sh
npm run build
npm start
```

The build typechecks and compiles both workspaces and bundles the frontend.
Open **http://127.0.0.1:3001**: the API serves the built frontend on the same origin.
Rebuild after source changes. `npm start` requires a completed build.

## Run with Docker

### VS Code tasks on Windows

Use **Terminal > Run Task > Start application**. This Windows-specific task runs
Windows PowerShell 5.1 directly, including when your default terminal is Git Bash;
it needs Docker Desktop/Compose but no local Node, npm, or mise. If the selected
Docker engine is unavailable, it launches the installed Docker Desktop and waits
up to **180 seconds** for a **Linux** engine before building/starting the app.
It leaves your Docker context and container mode as configured. A Windows engine,
missing tools, timeout, or failed Compose command fails the task with an error.
After building, Compose waits up to **120 seconds** for application health and
the task prints the actual loopback URL (normally **http://127.0.0.1:3001**).
Image downloads/build time is separate from these readiness deadlines.
Compose runs with `--ansi never --progress plain`, so redirected/noninteractive
task output does not require a console (including with `COMPOSE_PROGRESS=tty`).

Use **Stop application** to run `docker compose stop` for this repository's
Compose project, preserving its container and named data volume. It does not
launch or stop Docker Desktop. **View application logs** follows the last 100
lines; terminating that log task only stops log following. To stop the app after
startup completes, use **Stop application**, rather than terminating the completed
Start task. Tasks run only when selected and allow one instance per task.

Start and Stop also share a per-workspace lifecycle lock: overlapping operations
fail immediately with an instruction to retry after the active operation finishes
or terminate its task first. Logs remain available while a lifecycle task runs.
The lock applies to this helper, not direct Docker commands. Terminating Start
does **not** guarantee cancellation or cleanup of a Compose build/start already
in progress; run **Stop application** again once any pending build/start finishes.
The lifecycle lock is released when the helper exits, including task termination.

Tasks inherit VS Code's environment, including `BACKLOG_HOST_PORT` and
`COMPOSE_PROJECT_NAME`; Compose also reads the repository's `.env`. For a different
port, set `BACKLOG_HOST_PORT=3101` in `.env` before starting, or launch VS Code with
that environment variable. Use the same project/port configuration for every
lifecycle command. Editing an integrated shell's environment does not change
the environment of new VS Code tasks.

The same helper can be run from PowerShell in the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Stop
# Optional startup/health deadlines (seconds):
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Start -DockerTimeoutSeconds 240 -HealthTimeoutSeconds 180
# Dependency-free tooling checks; native process fixtures, no containers or Desktop launched:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-application.ps1
```

### Docker commands (all platforms)

Install Docker Engine with the Compose v2+ plugin, or Docker Desktop. On Windows,
start Docker Desktop using **Linux containers** (with its WSL2 backend configured).
The daemon must be running; check `docker info` and `docker compose version`.
Native Node, npm, and mise are not required for this route.

```sh
docker compose up --build -d --wait
docker compose logs --follow --tail 100
```

Open **http://127.0.0.1:3001**. Press Ctrl+C to leave log following; the container
continues running. The multistage build runs `npm ci` from the root lockfile and
builds both workspaces. The non-root runtime contains Node, the compiled API, and
the frontend bundle, without installed npm dependencies or browser engines.
The healthcheck uses Node's built-in fetch against the API.

Inside the container only, `BACKLOG_HOST=0.0.0.0` allows Docker to reach port 3001.
Compose publishes that port **only on host loopback**, `127.0.0.1:3001`. Host-header
and mutation-origin protections remain enabled. There is **no authentication**;
keep this loopback publication and use the exact URL above. All-interface container
listening does not make remote/network hosting supported.

If host port 3001 is occupied, set `BACKLOG_HOST_PORT` before running Compose, for
example `$env:BACKLOG_HOST_PORT = '3101'` in PowerShell or
`export BACKLOG_HOST_PORT=3101` in Bash, then open `http://127.0.0.1:3101`.
The container port remains 3001. Use the same setting for subsequent commands.

Lifecycle and updates (run from the same repository/project):

```sh
docker compose stop
docker compose start --wait
docker compose restart
docker compose down
# After updating source, rebuild and recreate:
docker compose up --build -d --wait
```

`stop` stops the app; `down` also removes its container and network. **Both preserve
the named data volume.** Rebuilding/recreating reuses it. Compose mounts
`backlog-data` at `/app/data`, with `BACKLOG_DB_PATH=/app/data/backlog.sqlite`; a
new volume inherits the image directory's writable ownership for the `node` user.
Compose prefixes the volume name with its project name (normally
`backlog-tracker_backlog-data`). Changing the project name selects different data.
Existing native `data/backlog.sqlite` is neither mounted nor migrated automatically.

### Container backup and restore

Stop the app before copying **the entire database directory**, including any
`-wal` and `-shm` sidecars. With the container still present (`stop`, not `down`),
these commands copy to a **new/empty** backup directory on the host:

```sh
docker compose stop
docker compose cp app:/app/data/. ../backlog-container-backup
docker compose start --wait
```

The `/.` source copies directory contents directly into the backup root, whether
the destination is new or already exists and is empty. Keep this backup outside
the build context/repository in a safe location. Before restoring, inspect
`../backlog-container-backup` and confirm **`backlog.sqlite` is at its root**, with
any saved `-wal`/`-shm` sidecars alongside it (not nested in a `data` directory).
Stop the app and preserve a separate backup of its current `/app/data` directory
using the same copy command with a different new/empty destination; do not
overwrite the backup being restored. Only then run the destructive restore below,
which clears `/app/data` in this Compose project's stopped volume and copies the
saved directory contents back. Double-check the project and both backups first:

```sh
docker compose stop
docker compose run --rm --no-deps app node --input-type=module -e "import {readdir,rm} from 'node:fs/promises'; for (const name of await readdir('/app/data')) await rm('/app/data/'+name,{recursive:true,force:true});"
docker compose cp ../backlog-container-backup/. app:/app/data
docker compose run --rm --no-deps --user root app chown -R node:node /app/data
docker compose start --wait
```

The one-off ownership command makes the restored files writable by the normal
non-root process (UID/GID 1000), including after copying through a Windows host.
Do not copy a live database, mix files from different backups, or remove the named
volume as part of an ordinary stop/update. If the container was removed by `down`,
use `docker compose create` before the stopped-container copy/restore workflow.

## Native verification commands

| Command | Purpose |
| --- | --- |
| `npm test` | API integration tests using fresh temporary SQLite databases |
| `npm run test:api` | Same API integration suite |
| `npm run test:startup` | After building: isolated dev/build startup, API reload, busy-port and invalid-database regressions |
| `npm run dev --workspace apps/api` | API only, with Node watch mode |
| `npm run build --workspace apps/api` | Backend typecheck and compile |
| `npm run browser -- --help` | Pinned Playwright CLI for browser verification (uses installed Chrome; no bundled browser) |

Tests never use `data/backlog.sqlite` or `BACKLOG_DB_PATH`. They verify project/task
CRUD, persistence across server restart, cascading deletion, validation without
partial writes, same-origin protection, and static frontend serving. Browser
interaction checks are separate from the API test suite.
The startup check triggers API reload by touching the server source timestamp
(without changing its contents), then restores the timestamp during cleanup.

### Browser verification

The root dependency pins `@playwright/cli` to **0.1.22**. Use an existing Chrome
installation; setup does not install browser engines. For an isolated manual
verification target, set a fresh temporary database and free alternate ports
before starting the app, for example in PowerShell:

```powershell
$env:BACKLOG_DB_PATH = Join-Path $env:TEMP ("backlog-review-" + [guid]::NewGuid() + '.sqlite')
$env:PORT = '3101'
$env:BACKLOG_WEB_PORT = '5273'
npm run dev
```

In a second terminal from the repository root:

```sh
npm run browser -- -s=review open http://127.0.0.1:5273 --browser=chrome
npm run browser -- -s=review snapshot
npm run browser -- -s=review close
```

The browser uses a separate temporary profile unless `--persistent` is requested.
Browser sessions do not isolate server data: verify the server's database path
before creating or deleting anything. CLI snapshots/logs in `.playwright-cli/`
and screenshots in `artifacts/` are ignored by Git.

## Data, configuration, and backup

The default database is **`data/backlog.sqlite`**, relative to the repository root
regardless of the workspace command used. It is created automatically on first
startup. SQLite may also create `-wal` and `-shm` sidecar files. Data, dependencies,
build output, and verification artifacts are ignored by Git.

To back up: stop the app, then copy the entire `data` directory to a safe location.
To restore: stop the app and replace `data` with that backup. For a custom path,
back up the SQLite file and any adjacent `-wal`/`-shm` files together. Do not copy
only the main SQLite file while the app is running. There is no in-app backup or
import/export feature yet.

Optional environment variables for the API:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKLOG_DB_PATH` | `<repo>/data/backlog.sqlite` | SQLite file; relative paths resolve from the API process working directory |
| `PORT` | `3001` | Local API/production frontend port |
| `BACKLOG_HOST` | `127.0.0.1` | Bind address: `127.0.0.1` for native use; opt-in `0.0.0.0` for the container only; request guards remain loopback-only |
| `BACKLOG_WEB_PORT` | `5173` | Frontend port when using the root `npm run dev` command |

For example, in PowerShell:

```powershell
$env:BACKLOG_DB_PATH = 'C:\BacklogData\backlog.sqlite'
npm start
```

The root `npm run dev` command points the development proxy at `PORT` automatically.
The frontend-only Vite configuration targets port 3001. Native API binding defaults
to `127.0.0.1`; leave `BACKLOG_HOST` unset for native development. Vite always binds
to loopback. Use the exact addresses shown above; this app is intended for access
from the same machine.

## API and implementation

The npm workspaces are `apps/web` (React + TypeScript + Vite) and `apps/api`
(TypeScript, Node HTTP, and SQLite). There are no backend runtime dependencies.
One root lockfile manages both workspaces.

JSON endpoints under `/api`:

- `GET /projects`, `POST /projects` with `{name}`.
- `PATCH /projects/:id` with `{name}`, `DELETE /projects/:id` (cascades tasks).
- `GET /tasks`, `POST /tasks` with `{projectId,title,description?,priority?,dueDate?,status?}`.
- `PATCH /tasks/:id` with any of those task fields; `DELETE /tasks/:id`.

Lists return `{projects}` or `{tasks}`, writes return `{project}` or `{task}`,
creates return HTTP 201, and deletes return HTTP 204. Errors are `{error: string}`
with meaningful 400/404 responses. IDs are UUIDs; timestamps are UTC ISO strings.
Task defaults: empty description, `medium` priority, `null` due date, and `backlog`
status. Due dates are calendar dates in `YYYY-MM-DD` format (years 0001–9999).
Names/titles must be nonblank, with maximum lengths of 100/200 characters;
descriptions allow up to 5000 characters. Unknown fields and invalid types are
rejected. SQL uses parameters and project deletion is an atomic transaction with
foreign-key cascading. Schema version 1 is initialized on a fresh database.

Mutation requests require JSON where a body is expected. Requests with a foreign
`Origin` or cross-site fetch metadata are rejected, and only loopback hostnames
are accepted. Vite must preserve the incoming `Host` header when proxying.

## MVP limitations

This is a single-user, local-only app: no authentication, synchronization,
collaboration, recurring tasks, attachments, or undo. Anyone who can use your
machine/browser can access its data. Dates have no time-of-day or reminders.
All tasks are loaded for client-side search/filtering; large-scale backlogs and
simultaneous multi-user editing are outside the MVP scope. Deletions are permanent
unless restored from a backup. Remote/network hosting and HTTPS are not supported.

## License

Licensed under the [MIT License](LICENSE).
