# The Forge

A local-only personal projects and tasks app. Create projects, add and edit tasks,
track **Backlog**, **In Progress**, and **Done**, and search/filter your backlog.
Tasks have descriptions, low/medium/high priority, optional due dates and times, and
color-coded tags you can create, assign, and filter by. Backlog data lives in a
local Neo4j database; data-model graphs and PostgreSQL ERDs stay in local SQLite
and model JSON files. There are no accounts or cloud services.

## Requirements

- Native development requires **Node.js 24.13 or newer**, including npm.
  `mise.toml` pins **24.21.0**; Docker supplies its own Node and npm.
- A current browser. Windows, macOS, and Linux are supported by the startup scripts.
- Run commands from the repository root. Node's built-in SQLite module supplies
  the model database; no separate SQLite install is needed.
- A reachable Neo4j 5.26 instance for the backlog. See
  [Backlog storage in Neo4j](#backlog-storage-in-neo4j).
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

Before running Compose or the VS Code tasks, remove the former SQLite override
files (`compose.sqlite.yaml` and `compose.dev.sqlite.yaml`) from `-f` arguments
and `COMPOSE_FILE` (including in `.env`). Keep the existing project name and
resolved volume mapping.

| Task | Existing command |
| --- | --- |
| `mise run setup` | `npm ci` |
| `mise run dev` | `npm run dev` |
| `mise run build` | `npm run build` |
| `mise run test` | `npm test` |
| `mise run test:neo4j` | `npm run test:neo4j` |
| `mise run start` | `npm start` (build first) |
| `mise run test:startup` | `npm run test:startup` (build first) |
| `mise run docker:up` | `docker compose up --build -d --wait` |
| `mise run docker:down` | `docker compose down` |
| `mise run docker:logs` | `docker compose logs --follow --tail 100` |
| `mise run ide:up` | `docker compose -f compose.ide.yaml up --build -d --wait` |
| `mise run ide:down` | `docker compose -f compose.ide.yaml down` |
| `mise run ide:logs` | `docker compose -f compose.ide.yaml logs --follow --tail 100` |

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

The Forge opens in **dark mode** by default, independently of your operating system's
color preference. The visible **Light / Dark** button switches palettes and names
the next action for screen readers. Both palettes pair steel-gray neutrals with
forge-orange accents inspired by the logo, while retaining the board layout.

Theme choices are saved in this browser under `backlog-theme` (`dark` or `light`).
Missing/invalid values use dark; the page applies the preference before React
loads, including native controls and the browser's theme color. If browser storage
is unavailable, appearance controls still work for the current page.

Motion defaults to **on**, independently of your operating system's reduced-motion
setting or changes to it. **Motion on** (accessible name: **Motion on — reduce motion**) / **Enable animations**
sets an explicit browser preference in `backlog-motion` (`full` or `reduce`). Saved
choices are retained; missing/invalid values or unavailable storage default to full
motion. Clear that key to restore the default. Full motion includes contact-point/keyboard
button ripples, including on the theme switch. Supported browsers reveal the new
palette from the theme button's center in two distinct directions. Light to dark
takes 2,200 ms: feathered charcoal/inky shadows creep across the page with a broad
penumbra and uneven smoke-like gradient banks, without luminous rims. Dark to light
takes 1,800 ms: an ivory/champagne bloom, soft gold halos and restrained radial rays
spread outward, clearing into the clean light palette. Each is a single sweep with
fade-in/out, using gradient falloff rather than large blur filters or repeated pulses.
The choice is saved immediately; another pointer/keyboard action skips the reveal so controls
stay responsive, including rapid theme changes. An inert old-palette copy masks
away over the live page, preserving native pointer and keyboard actions throughout.
Browsers without animated CSS custom properties, masks, or the animation API switch
palettes directly (with button ripples when supported).
Reduced motion switches themes directly and suppresses ornamental motion. Effects
never submit forms or delay other actions; unsupported animation APIs fall back to
ordinary controls.

## Backlog storage in Neo4j

Projects, tasks, and tags live in Neo4j when `BACKLOG_STORE=neo4j` or when
`NEO4J_URI` is set. Data-model graphs, PostgreSQL ERDs, and backend schema
metadata stay in SQLite and model JSON. The API applies the backlog uniqueness
constraints and indexes with `IF NOT EXISTS` before it starts listening, and
startup fails if Neo4j is selected but unreachable.

Server-side configuration only:

| Variable | Meaning |
| --- | --- |
| `BACKLOG_STORE` | `neo4j` or `sqlite`; defaults to `neo4j` when `NEO4J_URI` is set |
| `NEO4J_URI` | For example `bolt://127.0.0.1:7687` through an SSH tunnel |
| `NEO4J_USER` | Defaults to `neo4j` |
| `NEO4J_DATABASE` | Defaults to `neo4j` |
| `NEO4J_PASSWORD` | Required for Neo4j; keep it in `.env` or the environment, never in Git |

The API loads `.env` from the repository root when present. For native
development, start the tunnel first, then run the app:

```sh
ssh -N graph-db-tunnel
npm run dev
```

For Compose, set `NEO4J_PASSWORD` in `.env` before starting. The default URI is
`bolt://host.docker.internal:7687`. On Linux, the tunnel must bind the Docker
bridge gateway, or the app must use host networking; see the tunnel guide in
the Workbench Home Neo4j setup.

`npm test` keeps using SQLite so it needs no database service.
`npm run test:neo4j` starts a disposable Neo4j container and runs the Neo4j
store tests. Never point tests at production.

Back up the backlog with Neo4j dumps. The SQLite volume still holds model data
in Compose SQLite mode, but it no longer holds backlog rows when Neo4j is
selected.

## VS Code workspace

The **VS Code** workspace embeds a real code-server instance running in Docker.
The IDE image includes OpenCode and the OpenCode VS Code extension, so the
integrated terminal and extension use the same OpenCode installation.

Start the IDE separately from the Forge:

```sh
docker compose -f compose.ide.yaml up --build -d --wait
```

Open the Forge and select **VS Code**. The IDE is iframed from `IDE_URL`
(default `http://127.0.0.1:8080`) and opens `/workspace`.

The workspace is a **fresh Docker volume**, `forge-ide_workspace-data` by default,
mounted at `/workspace`. It starts empty and has no access to host files. Clone a
repository in the IDE terminal or copy files into the volume once:

```sh
git clone <repository> /workspace/<name>
```

When the workspace opens, the Forge upserts an `IdeWorkspace` node in Neo4j with
the volume name and container path. Only that reference is stored, never the
workspace contents.

| Variable | Meaning |
| --- | --- |
| `IDE_URL` | URL the browser loads in the iframe; defaults to `http://127.0.0.1:8080` |
| `IDE_INTERNAL_URL` | API-side health-check URL; defaults to `IDE_URL` |
| `IDE_PORT` | Host port published by `compose.ide.yaml`; defaults to `8080` |
| `IDE_VOLUME` | Docker volume name stored in Neo4j; defaults to `forge-ide_workspace-data` |
| `IDE_WORKSPACE_NAME` | Display name stored in Neo4j; defaults to `Forge IDE` |

The IDE container uses `--auth none` and binds only to `127.0.0.1`, because it is
embedded in the loopback-only Forge. It has a terminal, so treat it as a shell
inside the workspace volume. OpenCode authentication and sessions persist in the
`forge-ide_opencode-data` volume; run `opencode auth login` in the IDE terminal
on first use. Code-server settings and extensions persist in
`forge-ide_ide-data`.

The Docker image does not expose the IDE beyond loopback. If you access the Forge
from another machine, use a tunnel and set `IDE_URL` to a reachable URL. To
authenticate OpenCode from a shell:

```sh
docker compose -f compose.ide.yaml exec -u coder ide opencode auth login
```

`docker compose -f compose.ide.yaml down -v` deletes the workspace volume and
everything cloned into it.

## Build and run locally

```sh
npm run build
npm start
```

The build typechecks and compiles both workspaces and bundles the frontend.
Open **http://127.0.0.1:3001**: the API serves the built frontend on the same origin.
Rebuild after source changes. `npm start` requires a completed build.

## Run with Docker

### VS Code tasks on Windows, macOS, and Linux

Use **Terminal > Run Task > Start application**. On Windows the process task runs
Windows PowerShell 5.1 directly, including when your default terminal is Git Bash.
On macOS it runs `/bin/sh` with stock Perl (including `JSON::PP`); Linux uses the
same shell helper and requires Perl with its core modules. All tasks need Docker
CLI/Compose v2+ but no local Node, npm, mise, or macOS PowerShell. If the selected
Docker engine is unavailable, Start opens Docker Desktop on macOS (`open -a Docker`)
or launches it on Windows. **On Linux, start your daemon manually**; the helper
does not launch Desktop or a system service. Start waits
up to **180 seconds** for a **Linux** engine before building/starting the app.
It leaves your Docker context and container mode as configured. A Windows engine,
missing tools, timeout, or failed Compose command fails the task with an error.
After building, Compose waits up to **120 seconds** for development health and
the task prints the actual loopback URL (normally **http://127.0.0.1:5173**).
Image downloads/build time is separate from these readiness deadlines.
Compose runs with `--ansi never --progress plain`, so redirected/noninteractive
task output does not require a console (including with `COMPOSE_PROGRESS=tty`).

Start resolves the normal production Compose configuration and stops its `app`
service first, without removing its container or volume. It then starts a separate
`dev` service in the same project using the exact resolved `backlog-data` volume
and `/app/data/backlog.sqlite`. Vite and the API run from mounted source inside
Docker. Frontend edits hot reload; API edits restart the API and Vite in order.
Polling detects Windows Docker filesystem changes. Changes to package manifests or
the lockfile require Restart to rebuild the image. No native Node/npm is needed.
The API listens only inside the container; Vite proxies `/api`, preserving Host.
Only the Vite port is published, on host loopback. Use the printed 127.0.0.1 URL.

Use **Stop application** to stop the `dev` service, preserving its container and
named data volume. It does not
launch or stop Docker Desktop. **View application logs** follows the last 100
lines; terminating that log task only stops log following. To stop the app after
startup completes, use **Stop application**, rather than terminating the completed
Start task. Tasks run only when selected and allow one instance per task.

Use **Restart application** to stop the development service, then rebuild and
start it using the same health wait and URL reporting as Start. This applies source
updates and preserves the data volume and project configuration. Compose handles
an already-stopped app normally; a failed stop prevents the start.

Start, Stop, and Restart share a per-workspace lifecycle lock: overlapping operations
fail immediately with an instruction to retry after the active operation finishes
or terminate its task first. Logs remain available while a lifecycle task runs.
The Windows database maintenance helper uses the same Windows lock. The macOS/Linux
lifecycle helper uses a termination-safe Perl `flock` in a private per-user `/tmp`
directory. The existing shell database maintenance helper does **not** acquire this
lock; keep lifecycle operations idle throughout shell maintenance.
The lock applies to this helper, not direct Docker commands. Terminating Start or Restart
does **not** guarantee cancellation or cleanup of a Compose build/start already
in progress; run **Stop application** again once any pending build/start finishes.
The lifecycle lock is released when the helper exits, including task termination.

Tasks inherit VS Code's Compose environment, including `COMPOSE_PROJECT_NAME`,
`COMPOSE_FILE`, and `COMPOSE_ENV_FILES`; Compose also reads the repository's `.env`
and normal production overrides. The resolved project and volume name are used for
development, including an explicitly named or external production volume. If an
override changes the production database path or `/app/data` mount, the tasks fail
instead of selecting a different database. A volume with a custom driver/options
must already exist (create it with production Compose first).
For a different Vite host port, set `BACKLOG_DEV_HOST_PORT=5273` in `.env` before
starting, or launch VS Code with that environment variable. `BACKLOG_HOST_PORT`
controls the production port only. Use the same project/port configuration for every
lifecycle command. Editing an integrated shell's environment does not change
the environment of new VS Code tasks.

To switch back to production, first run **Stop application**, then run
`docker compose up --build -d --wait` with the same production Compose environment.
Do not run production and development concurrently against the shared database;
direct Compose commands bypass the task lock and do not stop the dev service.
The native `data/backlog.sqlite` is separate and is not automatically migrated.

The same helper can be run from PowerShell in the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Restart
# Optional startup/health deadlines (seconds):
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\application.ps1 -Action Start -DockerTimeoutSeconds 240 -HealthTimeoutSeconds 180
# Dependency-free tooling checks; native process fixtures, no containers or Desktop launched:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-application.ps1
```

On macOS or Linux, from the repository root:

```sh
sh scripts/application.sh Start
sh scripts/application.sh Stop
sh scripts/application.sh Restart
sh scripts/application.sh Logs
# Optional Docker/health deadlines (seconds, defaults 180/120):
sh scripts/application.sh Start 240 180
# Dependency-free fixtures; fake Docker/Desktop commands, no real containers:
perl scripts/test-application.pl
```

Engine probes are individually bounded, including hung Docker commands. Image
downloads/builds are not limited by the engine-readiness deadline. Stop and Logs
never open Desktop; an unavailable engine causes the Compose command to fail.

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

Both Compose files store data-model graphs and ERDs in that SQLite volume and
the backlog in Neo4j. There is no runtime model directory bind. A fresh volume
initializes on first start; an older database requires the
[offline cutover](#sqlite-storage-and-offline-all-model-import).
The VS Code tasks resolve the production volume for dev. For direct dev commands,
set `BACKLOG_DEV_VOLUME` to that resolved name; dev treats it as an existing external volume.

### Container backup and restore

On Windows, use the offline maintenance helper from the repository root with the
same Compose environment as the tasks. It resolves and displays the project and
volume, stops both `dev` and `app`, and refuses to copy or restore while **any
running container** mounts that volume. It works when only a dev container exists;
at least one stopped app/dev container must exist to supply an image. If both were
removed, start and stop the app first. It copies the entire database directory,
including any `-wal` and `-shm` sidecars. Keep backups outside the repository.

Before proceeding, ensure no task, direct Compose command, other Docker client, or
host process can start a writer until maintenance finishes. The writer check is a
point-in-time check, not a lock against independent Docker commands or external
volume access. Check the displayed project and volume carefully.

```powershell
# The destination must not exist; keep it in a safe location.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\database-maintenance.ps1 -Action Backup -Path ..\backlog-container-backup
```

Before restoring, inspect the backup: `backlog.sqlite` must be at its root, with
any sidecars alongside it. First create a **separate** backup of the current data
using the command above and a different new destination. Then run the destructive
restore below, which clears the resolved volume and copies in the backup; it fixes
ownership to UID/GID 1000. A failure during restore can leave partial data; retain
the separate backup. The services remain stopped until explicitly started.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\database-maintenance.ps1 -Action Restore -Path ..\backlog-container-backup
```

#### macOS and Linux

From the repository root, with Docker Compose and Perl with its standard `JSON::PP`
module installed, run the
following using the same Compose environment, project name, `.env`, and overrides
as the application. The helper resolves and displays the production Compose project
and actual volume name, including explicit or external names; it rejects altered
database paths, subpaths, and overlapping mounts. Check the displayed identity.
It stops both `dev` and `app` in that project, checks for **any running container**
mounting the volume, and leaves both services stopped. A stopped `dev` or `app`
container must exist to supply its image, so dev-only installations work. If both
containers were removed, start and stop the app first. No volume is removed.

Before proceeding, ensure no task, direct Compose command, other Docker client, or
host process can start a writer until maintenance finishes. The volume checks are
point-in-time checks and cannot prevent concurrent writers or external volume access;
the shell helper does not acquire either platform's lifecycle task lock.

```sh
# Destination must not exist; keep backups outside the repository.
sh scripts/database-maintenance.sh backup ../backlog-container-backup
```

The backup includes the whole directory and any SQLite sidecars. Before restoring,
inspect it and confirm `backlog.sqlite` is at its root, with sidecars alongside it.
First make a **separate** backup of the current data with a different new path.
Then the following destructive restore clears the volume, copies the saved directory,
and sets ownership to UID/GID 1000. A failed restore can leave partial data; retain
the separate backup. Start the desired service explicitly after maintenance.

```sh
# Use the exact volume name printed by the backup command.
BACKLOG_MAINTENANCE_VOLUME='actual-volume-name' sh scripts/database-maintenance.sh restore ../backlog-container-backup
```

Never copy a live database or mix files from different backups.

The database maintenance helpers copy the entire SQLite volume, including all
current models in v2. For portability, preserve the database and sidecars together
and restore with the helpers on the target platform. The helpers fix container
ownership on restore. If the backup filesystem lost POSIX modes, verify and
restore owner-only modes (`0600`) on the database and its sidecars **in the
stopped target volume** before starting either service. Windows-native copies
need restrictive ACLs; a Docker Desktop Linux volume still uses POSIX modes.
Restoring a pre-cutover file-mode or named-only v1 backup also requires its matching
model directory and a matching older runtime. Keep that coordinated backup separately.

## Native verification commands

| Command | Purpose |
| --- | --- |
| `npm test` | API integration tests using fresh temporary SQLite and model JSON paths |
| `npm run test:api` | Same API integration suite |
| `npm run test:neo4j` | Disposable Neo4j container, then the Neo4j backlog store tests |
| `npm run test:startup` | After building: isolated dev/build startup, API reload, busy-port and invalid-database regressions |
| `npm run dev --workspace apps/api` | API only, with Node watch mode |
| `npm run build --workspace apps/api` | Backend typecheck and compile |
| `npm run browser -- --help` | Pinned Playwright CLI for browser verification (uses installed Chrome; no bundled browser) |

Tests override inherited `BACKLOG_DB_PATH` and `BACKLOG_MODEL_PATH` with isolated
temporary paths; they never use repository data. They verify project/task
CRUD, persistence across server restart, cascading deletion, validation without
partial writes, same-origin protection, and static frontend serving. Browser
interaction checks are separate from the API test suite.
Model checks cover JSON/restart roundtrips, revision conflicts and concurrent app
instances, validation, corrupt-file preservation, read/write failures and request
guards. Startup fixtures also explicitly isolate their model path.
Named-model checks additionally cover independent graphs, duplicate display names,
list/reopen/restart, name-only updates, no-clobber UUID collisions, unsupported
file filtering, per-entry failures, permission preservation and legacy-byte safety.
The startup check triggers API reload by touching the server source timestamp
(without changing its contents), then restores the timestamp during cleanup.

### Browser verification

Use only the user's already-running app at its actual URL. If it is not running
or the URL is unknown, ask the owner to start it or provide the URL, as needed,
or report browser verification as blocked. Never start, restart, or stop an app
for browser work. Do not use PowerShell or another app launcher, provision a
database or model files, or pick alternate ports to create a review target.

Treat app data as read-only. Inspect existing views and use nonpersisting controls
such as navigation, filters that do not save, and opening or dismissing dialogs.
Do not seed, create, edit, save, delete, change status, or otherwise mutate app
data through the UI, API, or storage. Mark scenarios that require a write as
**blocked**. The owner startup and maintenance instructions and the automated
native test fixtures above are separate workflows.

The root dependency pins `@playwright/cli` to **0.1.22**. Use an existing Chrome
installation. From the repository root, replace `ACTUAL_APP_URL` with the verified
URL and `review-unique` with an unused name for your own session:

```sh
npm run browser -- -s=review-unique open "ACTUAL_APP_URL" --browser=chrome
# Inspect only views and capture only artifacts that do not contain private data.
npm run browser -- -s=review-unique close
```

Use the session's temporary browser profile and close only the session you opened.
Browser-local theme and motion settings can be exercised in that profile; it does
not isolate app data. Keep credentials and private project, task, and model data
out of snapshots, logs, traces, and screenshots. Skip captures that would include
private content; store non-private artifacts only in ignored `.playwright-cli/`
or `artifacts/`.

## Data, configuration, and backup

The default SQLite database is **`data/backlog.sqlite`**, relative to the
repository root regardless of the workspace command used. It is created
automatically on first startup and holds model data and backend schema metadata
when SQLite model storage is selected. Backlog projects, tasks, and tags are
stored in Neo4j when the Neo4j backlog store is selected. SQLite may also create
`-wal` and `-shm` sidecar files. The local SQLite database and its sidecars,
other private runtime data, dependencies, build output, and verification
artifacts are ignored by Git. Model JSON is the exception below.

In default file mode, data models are stored separately as schema-versioned JSON at
**`data/models/model.json`**, also relative to the repository root. Loading a missing
file returns an empty model at revision 0 without creating directories or a file.
A successful save creates the parent directory if necessary and increments the
server-managed revision. Saves write a unique same-directory temporary file,
close it, then atomically rename it over the destination; temporary files are
cleaned up after failures. This protects against partial replacement, but is not
a power-loss durability guarantee. Invalid/unsupported JSON and read/write errors
return meaningful errors and never silently reset existing data.

By default, named saves are siblings of that configured singleton file, in
**`dirname(BACKLOG_MODEL_PATH)`** (normally `data/models`). The server generates
lowercase UUIDv4 filenames, `<uuid>.json`. Each contains exactly
`{schemaVersion:3,revision,name,nodes,relationshipTypes,relationships,constraints,indexes}`; the ID is derived from
the filename, not duplicated in the file. Duplicate display names are allowed.
Creating a named copy, including one with the same graph as the legacy model,
never changes the singleton. Named creation closes a private same-directory
temporary file, then publishes it with an atomic no-clobber hard link and cleans
up the temporary name. It requires a filesystem supporting same-directory hard
links. Updates atomically replace existing regular files and preserve their mode
bits. Missing named IDs are never auto-created by reads or updates.

The model list starts empty when no supported files are stored. Listing reads only
the physically present configured legacy entry and exact lowercase UUIDv4 `.json`
regular-file siblings. A missing legacy entry is omitted. Arbitrary JSON, nested
directories, UUID symlinks and other unsupported siblings are ignored, never
rewritten. A symlink or other nonregular entry at the configured legacy path is
listed as unavailable and is not followed. An invalid or unreadable
supported file is listed as unavailable with a generic, content-redacted error
and its ID as fallback name (`Legacy model` for the legacy entry); one broken file does not prevent other entries from
listing. Reads and lists do not create the model directory. With a custom model
path, use a dedicated directory to keep the named-model collection isolated.

Model JSON files directly inside **`data/models/`** are eligible for Git tracking,
so Git can back up and version model saves. Nested directories, non-JSON files,
and atomic-save temporary files such as `.model.json.<UUID>.tmp` remain ignored.
After saving in the app, explicitly run `git add data/models/model.json` and
`git commit -m "Save data model"` to record that version; the app does not
automatically stage or commit saves. Committed models become part of repository
history and are shared if you publish the repository, so keep secrets and private
information out of model JSON you commit. SQLite remains local and ignored.

On POSIX filesystems, new model files use owner-only `0600`; replacement saves
preserve the existing regular file's `0777` permission bits, independent of umask
(special setuid/setgid/sticky bits are not copied). Permissions are applied before
rename; failures leave the original file in place. Non-regular save destinations,
including symbolic links, are rejected. Ownership, ACLs and other extended
metadata are not copied. The API does not automatically broaden a private file's
access for another user.

Each load reads fresh disk state. Saves serialize the read/revision-check/write
sequence across app instances sharing a resolved path **within one Node process**.
Cross-process locking is not provided: use a **single API writer** per model file.
Avoid editing the file externally while an API save is in flight. Back up model JSON alongside
SQLite when both are part of your work. Programmatic callers can inject
`createApp({dbPath, modelPath, webRoot?, namedModelStorage?})`; omitting
`modelPath` uses the repository default, and omitting `namedModelStorage` uses
`file`, independent of environment variables.

In file mode, stop all writers and copy the entire `data` directory to a safe
location. For custom paths, copy the full model directory and the SQLite database
with all sidecars as one coordinated backup. Restore both from the same backup
while stopped. After all-model v2 cutover, current backups need only the stopped
SQLite database with its sidecars. Schema exports do not back up SQLite or Neo4j
graph data.

Optional environment variables for the API:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKLOG_DB_PATH` | `<repo>/data/backlog.sqlite` | SQLite file for model storage and schema metadata; relative paths resolve from the API process working directory |
| `BACKLOG_MODEL_PATH` | `<repo>/data/models/model.json` | Singleton file and location anchor for named graph and ERD files in native file mode; unused in SQLite mode. Relative paths resolve from the standalone API working directory. |
| `BACKLOG_NAMED_MODEL_STORAGE` | `file` (native), `sqlite` (Compose) | SQLite mode initializes a missing DB and requires the all-model v2 schema for an existing DB. File mode refuses cutover databases. |
| `BACKLOG_STORE` | `neo4j` when `NEO4J_URI` is set, otherwise `sqlite` | Backlog storage backend |
| `NEO4J_URI` | none | Bolt URI for the backlog database |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | none | Neo4j password; required for Neo4j |
| `NEO4J_DATABASE` | `neo4j` | Neo4j database name |
| `IDE_URL` | `http://127.0.0.1:8080` | URL loaded by the VS Code iframe |
| `IDE_INTERNAL_URL` | `IDE_URL` | API-side health-check URL for the IDE; use `http://host.docker.internal:8080` when the API runs in Docker |
| `IDE_PORT` | `8080` | Host port published by `compose.ide.yaml` |
| `IDE_VOLUME` | `forge-ide_workspace-data` | Docker volume name stored in the Neo4j `IdeWorkspace` node |
| `IDE_WORKSPACE_NAME` | `Forge IDE` | Display name stored in the Neo4j `IdeWorkspace` node |
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
to `127.0.0.1`; leave `BACKLOG_HOST` unset for native development. Native Vite binds
to loopback; Docker Vite listens inside its container and publishes only to host loopback.
Use the exact addresses shown above; this app is intended for access
from the same machine.

### SQLite storage and offline all-model import

This section covers SQLite model storage. When the Neo4j backlog store is
selected, projects, tasks, and tags are not stored in these tables; the SQLite
database remains for model data and schema metadata.

The offline v2 cutover makes the selected backlog SQLite database the source of
truth for named graphs (`named_graph_documents`), the singleton
(`legacy_graph_document`) and PostgreSQL ERDs (`erd_documents`). Models are stored
as JSON `TEXT`; named graph and ERD UUIDs are separate namespaces. Project/task
schema versioning is independent. Runtime v2 never accesses the source files.

SQLite mode initializes only a missing database, with an empty backlog and all
three model stores. The initialized file is published atomically on a filesystem
that supports same-directory hard links (for example, a local Docker volume or
NTFS). An existing zero-byte, unmarked, named-only v1, partial, or damaged database
is refused; startup does not import JSON or repair it. The mode check runs before
opening the database for writes. If there is a nonempty WAL, startup checks a
private temporary copy of the database and WAL so committed changes are visible
without touching the originals. This requires temporary disk space for both files;
if they keep changing during inspection, retry once writes settle. Startup refuses
a pending rollback journal; recover it through normal SQLite operation first.
If a forced termination leaves a `.backlog-bootstrap-*.tmp` file or its staging
sidecars, they are ignored on the next start and may be removed with all writers
stopped. Never remove sidecars belonging to the actual database.

**Owner procedure:** Stop all writers to the selected SQLite database and source
model directory, including native, production and development containers, and
external file editors. Back up the stopped database and any sidecars **and** the
model directory. Leave writers stopped through preview, apply and configuration.
Use the existing UTF-8 backlog database and model directory, even for an empty import.
The importer never creates the database: the destination must already have the
backlog schema, with either no model tables or a valid named-only v1 cutover.
The CLI requires both absolute paths on each invocation, ignores the environment,
and rejects a database with a nonempty WAL or rollback journal. If it rejects
pending state, have the owner recover/checkpoint it through normal SQLite operation
and shut down cleanly before retrying; do not remove sidecars by hand.

On POSIX, import and SQLite-mode startup require the database and any existing
`-wal`, `-shm`, or `-journal` sidecars to have no group or other permission bits
(for example, `0600`). Database and sidecar symlinks are rejected. The app and
importer do not change existing permissions. The owner must secure the database,
its current and future sidecars, backups, and parent directory against unauthorized
access or replacement (for example, a private `0700` data directory), including
any filesystem ACLs. Windows ACLs are not inferred from POSIX mode bits; on
Windows the owner must set restrictive ACLs on the database and its directory,
including inheritance for new sidecars.

Native example (from the repo root after `npm run build`, in a POSIX shell;
substitute the actual paths):

```sh
DB=/absolute/path/to/data/backlog.sqlite
MODEL=/absolute/path/to/data/models/model.json
node apps/api/dist/model-import.js --dry-run --db "$DB" --model "$MODEL"
node apps/api/dist/model-import.js --apply --db "$DB" --model "$MODEL"
BACKLOG_DB_PATH="$DB" BACKLOG_NAMED_MODEL_STORAGE=sqlite npm start
```

On Windows, use the same Node commands with quoted absolute Windows paths and
set the two environment variables in the shell that launches the API.
`--dry-run` checks destination integrity and reports eligible and failed IDs by model
kind without changing the database, sidecars or JSON files. Use the exact
singleton filename, even if it does not yet exist. The scan considers the
configured singleton if present, plus exact lowercase `<uuid>.json` and
`erd-<uuid>.json` UUIDv4 regular-file siblings. Symlinks, directories and unrelated
siblings are ignored; a nonregular configured singleton blocks import. A missing
singleton remains virtual at revision 0.

On v1 upgrade, the importer validates the existing named rows and leaves their
bytes untouched. It scans only the singleton and ERDs; retained named files are
never imported. `--apply` repeats destination validation, including integrity,
inside the write transaction before committing the full batch and v2 marker
together, replacing the old marker row. Invalid or unreadable eligible
files and conflicting or already cut-over destinations block the import. JSON
bytes are preserved, including names, IDs, revisions and unresolved references.
Source files are unchanged. An empty batch can complete cutover. The v2 database
has no file fallback, so deletes remain effective even with retained files.

For a Docker volume, remove the former SQLite override files from `-f` arguments
and `COMPOSE_FILE` before running the commands below. Use the **same Compose
project and resolved volume** as the stopped app. The stock production mapping is
`<project>_backlog-data`; retain the exact mapping in your production configuration
if you used a custom volume name. Build the production image without starting
the service. The one-off commands mount the source directory read-only for the
importer. The image's `node` user needs read access to that directory and its
files and write access to the SQLite directory and database. The commands below use the repository
`data/models`; substitute the actual source directory and singleton filename if
different. In Git Bash on Windows, prefix each `docker compose run` command with
`MSYS_NO_PATHCONV=1` to preserve the container paths.

```sh
docker compose config --format json  # Verify name and volumes.backlog-data.name first.
docker compose build app
docker compose run --rm --no-deps --volume './data/models:/import/models:ro' app \
  node apps/api/dist/model-import.js --dry-run --db /app/data/backlog.sqlite --model /import/models/model.json
docker compose run --rm --no-deps --volume './data/models:/import/models:ro' app \
  node apps/api/dist/model-import.js --apply --db /app/data/backlog.sqlite --model /import/models/model.json
```

After cutover, use `compose.yaml` for production or `compose.dev.yaml` for
development. Verify the resolved name before starting either service: a different
name can start with a fresh, empty database. For direct dev commands, set
`BACKLOG_DEV_VOLUME` to the same resolved volume. Development retains its
read-only source mounts.

The owner can apply the mount change by recreating the service (Bash examples,
run only the command for the service in use):

```sh
docker compose up -d --build --force-recreate --wait app
BACKLOG_DEV_VOLUME="$VOLUME" docker compose -p "$PROJECT" -f compose.dev.yaml up -d --build --force-recreate --wait dev
```

Set `PROJECT` and `VOLUME` from the verified production configuration before
using the dev command. An existing container keeps its original mounts until
recreated. Native SQLite and Compose volumes remain separate.

The v2 marker blocks file-mode startup and the older named-only SQLite runtime.
For rollback, stop all writers and restore the complete coordinated pre-cutover
backup (database with its sidecars and the full source model directory), then run
the matching pre-cutover version and mode. Back up the stopped v2 database or
volume and its sidecars for all current models. Retained source JSON and its Git
history are pre-cutover backups only. Maintain SQLite file and directory ownership
for the runtime account (`node` in Docker, your own account in native mode).

## API and implementation

The npm workspaces are `apps/web` (React + TypeScript + Vite) and `apps/api`
(TypeScript, Node HTTP, SQLite, and Neo4j). The API's runtime dependencies are
Node's built-in modules plus `neo4j-driver`. One root lockfile manages both
workspaces.

JSON endpoints under `/api`:

- `GET /backend-schema` returns `{sqlite:{userVersion,tables},jsonStorage}` for
  **General → Backend schema**, a read-only workspace presented as an ERD canvas.
  SQLite tables render as positioned table nodes connected by their real foreign
  keys (for example `tasks.projectId → projects.id`). Foreign keys between
  different tables use straight lines between the relevant rows. Drag from anywhere
  on a table (mouse or touch, snapped to the 20px grid), or move it with arrow keys
  when its header is focused (Shift for a larger step). Click or tap the table name,
  or press Enter/Space on the focused header or name, to open the details dock.
  Table positions are transient: they reset when leaving the page and are never
  persisted or sent to the API. FK endpoints and actions appear on hover and in
  the dock, without persistent midpoint labels or cardinality claims.
  Pan by dragging empty canvas space or using the arrow keys (Shift for a larger
  step). The canvas supports clamped zoom (25%–200%), reset view (pan/zoom only),
  a grid toggle, and focus reveal of the selected node. Selecting a table node or a
  relationship opens a read-only details dock with full fields (declared type,
  explicit `NOT NULL` separate from primary-key position, defaults), foreign-key
  actions including `ON DELETE CASCADE`, indexes (origin/unique/partial/expression
  columns), and expandable exact table/index DDL. A separate **JSON storage**
  control opens a dock section for the JSON summaries; JSON storage is not drawn as
  relational tables or foreign-key edges. There are no editing controls and no
  saved-model writes. SQLite metadata comes from
  the open application's `sqlite_schema` and `PRAGMA user_version`, `table_info`,
  `foreign_key_list`, `index_list` and `index_info`. Tables include exact `ddl`,
  column declared types, explicit `notNull`, `primaryKeyPosition`, `defaultSql`,
  foreign-key actions and indexes (including automatic primary-key indexes with
  null DDL). `notNull` reports the pragma flag independently of primary-key status:
  SQLite's current `TEXT PRIMARY KEY` does not declare `NOT NULL`. Exact expandable
  DDL is the canonical evidence for CHECK constraints, without SQL parsing or
  invented UUID/date constraints. JSON storage summaries describe graph schema 3
   and PostgreSQL ERD schema 1 structurally. In SQLite mode they identify all
   models as SQLite documents, and live metadata includes all model tables. The
   validators and sections below remain
  authoritative. No rows, counts, filesystem paths or saved model contents are
  returned, and reads perform no writes or DDL execution. The route accepts GET
  only, ignores query parameters, and retains localhost guards and `no-store`.
- `GET /projects`, `POST /projects` with `{name}`.
- `PATCH /projects/:id` with `{name}`, `DELETE /projects/:id` (cascades tasks).
- `GET /tags`, `POST /tags` with `{name,color}`.
- `PATCH /tags/:id` with `{name?,color?}`, `DELETE /tags/:id` (removes its task assignments).
- `GET /tasks`, `POST /tasks` with `{projectId,title,description?,priority?,dueDate?,dueTime?,status?,tagIds?}`.
- `PATCH /tasks/:id` with any of those task fields; `DELETE /tasks/:id`.
- `GET /model` returns `{model:{schemaVersion:3,revision,nodes,relationshipTypes,relationships,constraints,indexes}}`.
- `PUT /model` accepts `{expectedRevision,model}` with a schema-1, schema-2 or schema-3 graph
  and returns `{model}` including the new server-managed revision (HTTP 200).
  A stale expected revision returns HTTP 409 `{error}`; reload before saving again.
  Invalid input returns 400, and corrupt/unreadable/unwritable storage returns 500
  `{error}` without exposing stored contents.
- `GET /models` returns `{models: [...]}` sorted by display name, then ID using
  deterministic UTF-16 code-unit ordering. Available entries are
  `{id,name,revision,available:true,deletable:boolean}`; unavailable entries are
  `{id,name,available:false,error,deletable:false}`. `deletable` is true only for a
   supported, read-valid saved model; in file mode it does not guarantee directory
   permission to unlink it. Only stored supported entries are listed;
   a missing singleton is omitted without creating storage. A stored legacy
   entry is named `Legacy model`; invalid or unreadable entries are unavailable.
   SQLite mode lists only the database contents. UUID model names remain user-authored, including
  `Default model`. No query parameter is needed for this stored-only list.
- `GET /models/legacy` returns `{id:'legacy',name:'Legacy model',model}`. A missing
  singleton still returns an empty revision-0 model for compatibility, without
  writes; physical symlinks and other nonregular entries are rejected. The
  standalone `GET /model` also returns canonical schema 3. Save through `PUT /model`;
  `PUT /models/legacy` is not supported (404).
- `GET /models/:uuid` returns `{id,name,model}`. The nested model contains only
  `{schemaVersion:3,revision,nodes,relationshipTypes,relationships,constraints,indexes}`, without the model display name.
- `POST /models` accepts `{name,model}` (schema 1, 2 or 3)
  and returns HTTP 201 `{id,name,model}` with a server-generated UUID and revision 1.
- `PUT /models/:uuid` accepts `{expectedRevision,name,model}` and returns HTTP 200
  `{id,name,model}` with revision incremented by one. Renaming alone still requires
  the current revision and the full graph. Stale revisions return 409; a missing
  UUID returns 404; corrupt storage blocks saves with 500. UUIDs must be exact
  lowercase UUIDv4 IDs; unsafe/malformed paths return 400 or 404.
- `DELETE /models/:id` accepts exactly `{expectedRevision}` as JSON, where `id`
  is an exact lowercase UUIDv4 or `legacy`, and returns HTTP 204 with no body.
  The expected revision must be a nonnegative safe integer. Invalid bodies or
   media types return 400; host/origin protections return 403; missing saved
   entries return 404; stale revisions return 409. Corrupt, unreadable, unsupported
  or nonregular storage and unlink failures return 500 without purging data.
   File deletion validates current disk contents and compares revisions in the same
  per-resolved-path, in-process queue as PUT, then unlinks only that exact file.
   Symlinks and wrong-case filenames are rejected. In SQLite mode, graph writes
   check the current revision (when applicable) and new reference targets in the
   same transaction as the write. Deletion removes only the selected row after
   checking its revision. Deleted UUIDs remain missing on subsequent PUT (404).
   `legacy` targets the stored singleton, which must exist. After deletion,
   GET still returns its virtual empty revision-0
  model and LIST omits `legacy`; that empty model is not stored until an explicit
  `PUT /model` saves it again.
  Cross-process/external filesystem writers are not locked; use a single API
  writer and do not externally replace files while PUT or DELETE is in flight.
- `GET /model-node-definitions` returns `{models:[...]}`, sorted like `/models`.
  Available entries are `{id,name,available:true,revision,definitions}`; each
  definition contains schema-3 definition fields except coordinates (`x`, `y`).
  Unavailable entries are `{id,name,available:false,error}` with content-redacted
   errors. Only supported stored graphs are included, never the virtual empty
   legacy model. File reads use at most eight concurrent readers, with the same
  exact-case, regular-file and symlink protections as the model list. Targets are
  not recursively loaded; missing references do not make a source unavailable.
  Catalog reads always use fresh saved definitions and never change disk contents.

Named display names are trimmed, nonblank Unicode text of at most 100 Unicode
code points, including spaces, with no Unicode control characters (`Cc`). Names
need not be unique. Graph input excludes `name` and
`revision`; both named and singleton routes share the same strict graph validation
and metadata defaults below. Model create/update/validation/export bodies have a 16 MiB
limit; DELETE retains the ordinary 32768-byte limit. All retain the same
host/origin/media-type protections. No import endpoints are provided.

### Canonical schema 3 and migration

Canonical graph input is `{schemaVersion:3,nodes,relationshipTypes,relationships,constraints,indexes}`.
Stored documents add the server-managed `revision`, and named documents add `name`.
Schema-1/2 requests and stored documents remain accepted. Reads normalize in
memory only; the SQLite import preserves the stored version, and an explicit save
writes schema 3. Schema 1 defaults absent `kind` to
`definition`, classification to `Transactional`, draft to `false` and properties
to `[]`. Schema 2 requires its previous variant fields.

Node definitions are `{kind:'definition',id,name,displayName?,x,y,classification,draft,properties,impliedLabels}`.
Classification is `Transactional`, `Master Data`, `Reference Data` or `Metadata`;
classification is UI metadata and never becomes a Neo4j label automatically.
`name` is the canonical label; `displayName` is optional UI text. `impliedLabels`
is an array of label tokens, not property inheritance.
Properties contain **only** `{name,dataType,description}`, with at most 100 per
definition. Descriptions allow multiline text, at most 2000 code points and no
NUL. Declarations remain exact text in storage; unsupported/custom declarations
produce semantic validation issues rather than making stored files unreadable.

Legacy property annotations migrate deterministically in node/property order:
each `nodeKey:true` creates a single-property KEY; otherwise `uniqueness:true`
creates UNIQUE and `mustExist:true` creates EXISTS. A KEY implies uniqueness and
existence without separate declarations. Legacy Range becomes RANGE unless
KEY/UNIQUE already owns that tuple's RANGE index; Text and Point remain additional
explicit indexes. Schema-1 boolean index flags remain accepted. Generated IDs and
names are `constraint-N`/`migrated_constraint_N` and `index-N`/`migrated_index_N`.
No inference removes legacy Text indexes. Names, type declarations, descriptions,
classifications and draft metadata are retained.

Relationship definitions are
`{kind:'definition',id:'relationship-type-N',name,displayName?,draft,properties,sourceLabel,targetLabel}`.
Endpoint labels are canonical strings or `null`. References are
`{kind:'reference',id,name,classification,target:{modelId,relationshipTypeId}}`.
Edges are `{id,relationshipTypeId,source,target,sourceCardinality,targetCardinality}`,
with no edge name. Schema-1/2 relationship names group into one owned type per
exact name, assigned IDs in first-encounter order, with empty properties,
`draft:false` and null endpoint labels. Each cardinality is `0..*`, `1..*`,
`1..1` or `0..1`; omitted legacy ends independently default to `0..*`.
Cardinality is descriptive and has no native Neo4j enforcement.

Constraints are `{id:'constraint-N',name,draft,kind,target:{kind,definitionId},properties}`.
Target kind is `node` or `relationship` and must identify a locally owned
definition, never a reference. KEY and UNIQUE use ordered nonempty property
tuples; EXISTS and TYPE use exactly one property. TYPE takes its type from that
property's declaration. A declaration alone does not emit a Cypher TYPE constraint.

Indexes are `{id:'index-N',name,draft,kind,targets,properties,filterProperties,config}`;
every field is required. RANGE has one target and one or more properties;
TEXT/POINT have one target and one property. FULLTEXT has one or more same-kind
targets and properties. VECTOR has one or more same-kind targets, exactly one
embedding property, and optional filter properties. LOOKUP has empty target and
property arrays, and `config:{entity:'node'|'relationship'}`. KEY/UNIQUE backing
RANGE indexes are derived and never stored as index records. Multiple explicit
indexes are supported on each definition. Allowed configuration keys are exact:

- FULLTEXT: `fulltext.analyzer`, `fulltext.eventually_consistent`.
- VECTOR: `vector.dimensions` (1–4096), `vector.similarity_function`
  (`cosine`/`euclidean`), `vector.quantization.enabled`, `vector.hnsw.m` (1–512),
  `vector.hnsw.ef_construction` (1–3200).
- POINT: `spatial.{cartesian,cartesian-3d,wgs-84,wgs-84-3d}.{min,max}`; finite
  2D/3D arrays with ordered bounds and valid geographic longitude/latitude.
- RANGE/TEXT: empty config; LOOKUP: only `entity`.

Canonical labels, relationship types, property keys, constraint/index names and
implied labels preserve exact Unicode, case, punctuation and spaces. They must
be nonblank, well-formed Unicode without `Cc` controls, at most 16383 UTF-16 code
units. Display names and local reference aliases are trimmed, at most 100 Unicode
code points. Local node placement names remain unique across both node kinds.
Reference nodes are exactly
`{kind:'reference',id,name,x,y,classification,target:{modelId,nodeId}}`, without
`draft` or `properties`. Classification is `Internal Reference` when `modelId`
equals the containing model ID (`legacy` for the singleton), and `External Reference`
otherwise. Target model IDs are exact lowercase UUIDv4 or `legacy`; target node
IDs obey the same safe `node-N` rules as local nodes. Aliases use the ordinary
local name rules, are unique across both node kinds, and are independent of target
names and metadata. Relationships keep local node IDs as endpoints, including
references, to represent cross-model relationships.

New or retargeted references must resolve to a definition at save time. Internal
targets resolve against the submitted graph, including unsaved definitions;
external targets resolve against a supported saved model. References
cannot target other references. Invalid/unavailable targets return 400, while
409 remains reserved for source revision conflicts. An existing reference with
the same local ID, classification and exact target tuple can be retained even if
the target was removed, is corrupt/unavailable, or now contains a reference.
Classification/context rules always apply. Reads never require target resolution.
Deleting a target never cascades to or rewrites dependents and does not block
source reads, unrelated saves or deletion; unresolved references remain stored.

Named POST allocates its UUID internally and rebases **all node and relationship-type** Internal Reference
target model IDs to that UUID, allowing graph copies. External targets stay
unchanged and cannot equal the newly allocated containing UUID. Target identity
is the tuple `{modelId,nodeId}`: references reflect the latest saved definition at
that tuple, including renames and replacements, rather than a historical snapshot.
Discovery shows saved definitions only. Single-file atomic publication and
in-process revision queues do not provide atomic cross-file reference integrity:
an external writer or concurrent target deletion may change a target after validation.

Node/edge/type/constraint/index IDs use their respective prefix plus a
nonnegative safe-integer suffix, with unique exact IDs within each collection.
Endpoints and relationship type placements must exist. Duplicate directed typed
connections are rejected; loops, reverse links and differently typed parallel
links are allowed. Coordinates remain finite multiples of 20 in `[60,100000]`,
with at least 180 Euclidean units between nodes. Limits are 200 nodes, 1000 edges,
100 properties per definition, 40000 constraints, 20000 indexes and 1000 entries
in other schema arrays. The constraint/index caps cover the full legacy maximum
of 200 nodes × 100 properties × (UNIQUE + EXISTS + one explicit index), without
truncating annotations. Every legacy normalization is revalidated as canonical
schema 3, and final save candidates are structurally validated before publication.
Model request bodies allow 16 MiB so expanded legacy graphs can be resubmitted;
other bodies retain 32768 bytes. A 453061-byte legacy request in the regression
fixture expands to a 2113466-byte canonical request, exceeding the previous 2 MiB
limit; the full 200×100 annotation fixture also fits within 16 MiB. This is a
request-byte bound, not a read-time disk rewrite or a serialized-file size cap.
Unknown fields are
rejected. Revisions and expected revisions are nonnegative safe integers.

### Catalog, composition, validation and exports

All models describe schema reuse within **one Neo4j database**, not cross-database
data relationships. `GET /api/model-catalog` returns `{models:[...]}` for
stored models only. Available entries include `id,name,available:true,revision,
sourceSchemaVersion,definitions,relationshipTypes,constraints,indexes`; definition
nodes omit coordinates, and relationship types include owned definitions only.
Unavailable entries retain redacted errors. `sourceSchemaVersion` reflects the
stored graph version, including after import. In file mode, both catalogs use at
most eight concurrent readers and retain exact-case/nonregular/symlink safeguards.
Catalog reads never write.

`POST /api/model-validation` accepts `{modelId,model,excludeDrafts?:boolean}`.
The model is an unsaved candidate without revision or model name; `modelId` is
`legacy` or an existing/prospective lowercase UUIDv4. `excludeDrafts` defaults true.
Malformed structure returns 400. Semantic results return 200:

```json
{"valid":true,"excludeDrafts":true,"issues":[],"dependencies":[]}
```

Issues are `{severity:'error'|'warning',code,modelId,path,message,related?}` with
JSON-pointer paths; related entries contain `{modelId,path}`. Dependencies are
`{modelId,revision}`. Composition uses the unsaved root plus referenced owned
definitions and their constraint/index dependency closure. Multi-target indexes
include all required definitions. It deduplicates identity tuples, never canonical
names; distinct owned tuples sharing a label/type conflict. Reference aliases
collapse to target names. It includes no unrelated saved models or edges.
Reference chains and unavailable targets block export; retained unresolved
references still remain readable/savable. Traversal is bounded to 256 models,
5000 definitions and 20000 operations. Draft omissions warn; included schema
objects requiring excluded drafts error instead of being silently truncated.
Constraint/index names share one database namespace; KEY/UNIQUE on the same
ordered tuple conflict, and an explicit RANGE duplicating their backing index
errors. Composite and individual tuples remain distinct.

Property type validation recognizes scalar aliases, UUID, homogeneous scalar
lists, closed unions and VECTOR coordinate/dimension forms (dimensions 1–4096).
Nested lists, vector lists, MAP/NODE and unknown types produce issues. Outer
`NOT NULL` warns to use EXISTS. Incompatible index/property combinations error.
Generic VECTOR is preserved in storage but cannot be used for a TYPE constraint
or graph-type property requirement without explicit parameters.
VECTOR filter properties use an explicit allowlist: INTEGER, FLOAT, STRING,
BOOLEAN, DATE, LOCAL TIME, ZONED TIME, LOCAL DATETIME, ZONED DATETIME and DURATION.
Aliases normalize for validation; unions are accepted only when every member is
allowed. UUID, PROPERTY VALUE/ANY, POINT, lists, vectors and other unsupported
filter declarations block export with semantic diagnostics (422, no content).

`POST /api/model-export` adds `format:'json'|'cypher'|'graph-type'` to the same
candidate. Successful responses are `{format,filename,mediaType,content,validation,
requirements:string[]}`. Blocking issues return 422
`{error:'Model cannot be exported.',validation}` with no partial script.

- JSON is a `version:1` schema bundle with `rootModelId`, identity-preserving
  `fragments:[{modelId,model}]` and dependency revisions; it contains no graph data.
- Cypher emits only declared `CREATE CONSTRAINT` and explicit `CREATE INDEX`
  statements with `IF NOT EXISTS`. KEY emits one KEY constraint, not redundant
  UNIQUE/EXISTS/RANGE statements. Identifiers are escaped, including backticks
  and literal backslash-u sequences; user names never become variables.
  Implied-label and endpoint-label enforcement requires graph-type export and
  blocks plain DDL rather than being silently dropped.
- Graph-type export additionally requires
  `acknowledgeGraphTypeReplacement:true`, because `ALTER CURRENT GRAPH TYPE SET`
  **replaces existing graph types and constraints**. It expresses implied labels,
  explicit relationship endpoint labels and property requirements using current
  official syntax. Property declarations alone remain annotations in every format:
  only explicit TYPE constraints emit declared property types. EXISTS and KEY
  properties without TYPE use `ANY NOT NULL`, preserving existence without adding
  a type restriction. TYPE alone is optional; only EXISTS/KEY makes it required.
  An outer `NOT NULL` in a declaration remains a warning, not implicit enforcement.
  Unconstrained declarations (including generic VECTOR) are omitted from graph-type
  property maps. Unknown declarations retain blocking semantic diagnostics;
  explicit unsupported TYPE constraints remain blocking as well.
  Named KEY/UNIQUE declarations remain named; existence/type element constraints
  receive Neo4j-generated names with a warning. Identifying/implied label
  collisions, ambiguous endpoint scope, empty elements with no expressible
  requirements, and unsupported required union properties block export.

Example validation/export body for an empty schema:

```json
{"modelId":"legacy","model":{"schemaVersion":3,"nodes":[],"relationshipTypes":[],"relationships":[],"constraints":[],"indexes":[]},"excludeDrafts":true,"format":"cypher"}
```

Omit `format` for validation. No endpoint connects to Neo4j or executes DDL.
Exports target current Cypher 25 and report version/edition/privilege requirements.
KEY/EXISTS/TYPE and graph types require Enterprise; native VECTOR properties
require Enterprise block format or Aura. Native UUID properties require Neo4j
2026.08+, Cypher 25 and Enterprise block format (or Aura). Multi-target/filter VECTOR indexes need
Neo4j 2026.01+; graph types target the generally available 2026.06+ syntax.
Compatibility profiles are deferred. Syntax references:
[index syntax](https://neo4j.com/docs/cypher-manual/current/indexes/syntax/),
[property types](https://neo4j.com/docs/cypher-manual/current/values-and-types/property-structural-constructed/),
[graph-type SET](https://neo4j.com/docs/cypher-manual/current/schema/graph-types/set-graph-types/).
Unit/static syntax checks are not proof of execution against a Neo4j engine.

Project/tag/task lists return `{projects}`, `{tags}`, or `{tasks}`, writes return
`{project}`, `{tag}`, or `{task}`, creates return HTTP 201, and deletes return HTTP 204. Errors are `{error: string}`
with meaningful 400/404 responses. Project/task IDs are UUIDs; timestamps are UTC ISO strings.
Task defaults: empty description, `medium` priority, `null` due date and time, and
`backlog` status. `dueDate` is `null` or a calendar date in `YYYY-MM-DD` format
(years 0001–9999). `dueTime` is `null` or a 24-hour local wall time `HH:mm`
(`00:00`–`23:59`, with no seconds or time zone). A non-null time requires an
effective due date. In PATCH, omitting `dueTime` preserves it unless the date
is removed; explicitly setting `dueTime: null` clears it. Sending a non-null
time with no effective date returns 400 without changing the task.

Tags are global, with nonblank names up to 50 characters and case-insensitive
uniqueness. Colors are one of `slate`, `blue`, `teal`, `gold`, `purple`, or `red`.
`tagIds` is a list of existing tag IDs (at most 50); duplicate IDs are ignored.
Omitting `tagIds` in a PATCH preserves the current assignments, while an empty
list clears them. Deleting a tag removes its assignments but leaves tasks intact.

The board displays due times in the browser's locale and compares them to the
browser's current local date and time at minute boundaries while open. During
daylight-saving fall-back, a timed task can briefly stop being overdue if the
clock moves back before its due time; it becomes overdue again when the clock
reaches that time a second time. Date-only tasks become overdue the following
local day. Done tasks are never overdue.
Names/titles must be nonblank, with maximum lengths of 100/200 characters;
descriptions allow up to 5000 characters. Unknown fields and invalid types are
rejected. SQL uses parameters, and project/task writes with tag assignments are
atomic transactions with foreign-key cascading. On startup, SQLite schema version 1
or 2 migrates to version 3 under a write lock in one transaction, preserving
existing data and adding the nullable `dueTime` column when needed plus the
`tags` and `task_tags` tables. Fresh databases use the same version 3 schema.

Mutation requests require JSON where a body is expected. Requests with a foreign
`Origin` or cross-site fetch metadata are rejected, and only loopback hostnames
are accepted. Vite must preserve the incoming `Host` header when proxying.

## MVP limitations

This is a single-user, local-only app: no authentication, synchronization,
collaboration, recurring tasks, attachments, or undo. Anyone who can use your
machine/browser can access its data. Due dates and times do not send reminders.
All tasks are loaded for client-side search/filtering; large-scale backlogs and
simultaneous multi-user editing are outside the MVP scope. Deletions are permanent
unless restored from a backup. Remote/network hosting and HTTPS are not supported.

## License

Licensed under the [MIT License](LICENSE).

## PostgreSQL ERD models

SQL ERD models are independent of graph models. The canonical input is
`{kind:'sql',schemaVersion:1,dialect:'postgresql',tables,foreignKeys}`. Tables are
`{id,name,x,y,columns}`; columns are
`{id,name,dataType,nullable,primaryKey,unique}`; foreign keys are
`{id,name,sourceTableId,sourceColumnId,targetTableId,targetColumnId}`.
Column IDs are globally unique. Table/foreign-key IDs are unique in their category.
Table names and column names within each table are exact-case unique. SQL
identifiers preserve case and punctuation, contain no controls or malformed
Unicode, and have a 63 UTF-8 byte limit. Coordinates are finite numbers in
`[0,20000]`; limits are 100 tables, 100 columns per table and 500 foreign keys.

- `GET /api/erd-models` returns `{models:[...]}`. Available summaries are exactly
  `{id,name,available:true,revision}`; unavailable entries use
  `{id,name,available:false,error}` with the ID as fallback name.
- `POST /api/erd-models` accepts `{name,model}`, returning HTTP 201
  `{id,name,model}` with nested server-managed `revision:1`.
- `GET /api/erd-models/:uuid` returns the same envelope.
- `PUT /api/erd-models/:uuid` accepts `{name,expectedRevision,model}` and returns
  HTTP 200 with the incremented revision. `DELETE` accepts `{expectedRevision}`
  and returns HTTP 204. Stale revisions return 409, missing models 404, malformed
  requests 400, and invalid/unreadable/unwritable storage 500, using `{error}`.
- `POST /api/erd-export` accepts `{model}` and returns
  `{filename:'schema.sql',mediaType:'application/sql',content}`. Empty models and
  tables without columns can be saved as drafts, but export returns an actionable
  400 until every table has columns and at least one table exists.

Types are exactly `smallint`, `integer`, `bigint`, `numeric`, `real`,
`double precision`, `text`, `varchar`, `boolean`, `uuid`, `date`, `timestamp`,
`timestamptz`, `jsonb` and `bytea`. This slice supports one nonnullable primary
key column per table, individual unique columns, and single-column foreign keys
targeting a primary key or unique column with the exact same type. Duplicate
foreign-key endpoints are rejected; self-references between distinct columns
and cycles are supported. Foreign-key names are unique per source table.
Every emitted SQL identifier is double-quoted with embedded quotes escaped.
Generated PK/UNIQUE constraint names avoid table and foreign-key names; foreign
keys are added after all tables exist. No defaults, composite keys, imports,
database connections or SQL execution are provided.

In file mode, explicit saves write `erd-<uuid>.json` beside `BACKLOG_MODEL_PATH`, outside graph
collection discovery. Creation uses restrictive permissions; atomic replacements
preserve ordinary file modes. Corrupt, unsupported, symlink and nonregular entries
cannot be overwritten or deleted through these routes. Per-path in-process
serialization supports optimistic revisions across app instances in one process;
file-mode deployment requires a single writer, with no external file replacement
during mutations. In SQLite mode, ERD writes and revision checks use the same
SQLite transaction, in their own table separate from graphs. Names are trimmed,
nonblank text of at most 100 Unicode code points
without controls. Create/update/export requests allow at most 2 MiB; deletion
retains the ordinary body limit. Existing localhost, origin and JSON media-type
protections apply. Export uses the submitted candidate without writing files.
