# The Forge

A local-only personal projects and tasks app. Create projects, add and edit tasks,
track **Backlog**, **In Progress**, and **Done**, and search/filter your backlog.
Tasks have descriptions, low/medium/high priority, and optional due dates. Your
data stays in a local SQLite database and model JSON files; there are no accounts
or cloud services.

## Requirements

- Native development requires **Node.js 24.13 or newer**, including npm.
  `mise.toml` pins **24.21.0**; Docker supplies its own Node and npm.
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

Both Docker modes also bind **`./data/models` to `/app/models`**, with
`BACKLOG_MODEL_PATH=/app/models/model.json`. This is separate from `/app/data`:
native and Docker modes share the repository's model JSON, while their SQLite
databases remain separate. Changing the Compose project name does **not** isolate
this bind. Run only one API writer against a model file at a time.
The whole directory bind also shares every named `<uuid>.json` model; no separate
mount or migration is needed for named saves.

Before first Docker startup, create `data/models` on the host. On Linux, ensure
the container's non-root `node` user (UID/GID 1000 in these images) can write the
directory. For a new, empty directory, an administrator can use
`sudo install -d -m 0750 -o 1000 -g 1000 data/models` from the repository root.
That setup is for Docker-only use (or a native writer with the same numeric UID).
Atomic saves require directory write/search access and file read access. New files
default to owner-only `0600`; granting another user directory access alone does
**not** let that user load a model. Do not make the directory world-writable.

For sequential native/Docker use with different Linux UIDs, deliberately use a
shared group. The following example uses numeric GID 1000, already the container
user's primary group; first verify that this host group is appropriate and that
the native user belongs to it (`id`). All parent directories must be searchable.
With all API writers stopped, from the repository root:

```sh
# New directory only; choose the native user as owner and the shared numeric GID.
sudo install -d -m 2770 -o "$(id -u)" -g 1000 data/models
```

For an existing directory, inspect its contents/permissions first; set the model
directory's group with `sudo chgrp 1000 data/models` and its mode with
`sudo chmod 2770 data/models`. The setgid bit makes replacement files inherit the
shared group. This directory must not have the sticky bit: both writers need to
replace a file owned by the other UID. If `model.json` is missing, start **only
the native API**, make the first model save, then stop it. Before switching writers,
bootstrap that file's shared access (or apply this to an existing valid model):

```sh
sudo chgrp 1000 data/models/model.json
sudo chmod 0660 data/models/model.json
```

Subsequent saves preserve those `0660` bits while the file owner becomes the
current writer and its group inherits from the setgid directory. No other/world
access is granted by this setup. If you delete the file, repeat the bootstrap
after its first save. Only one API writer may run at a time. The API does not copy
existing ownership or ACLs; custom ACL policies must account for file replacement
and are not guaranteed to survive saves. Docker Desktop handles bind permissions
differently; verify model saves on your host.
Each new named save also starts at `0600`. If switching between different writer
UIDs, apply the same deliberate group/bootstrap permissions to each named file
while writers are stopped; permission settings on `model.json` do not transfer
to newly created named files.

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

The database maintenance helpers back up **only the SQLite volume**. They do not
include the model bind. With all native/container API writers stopped, separately
copy `data/models` (including `model.json`, if present) to a safe location outside
the repository. To restore, retain a separate current backup, replace that model
directory from the chosen backup, and verify container write permissions before
starting one API writer. Stopping only one Compose project is insufficient if
another project or native process uses the same model path.

## Native verification commands

| Command | Purpose |
| --- | --- |
| `npm test` | API integration tests using fresh temporary SQLite and model JSON paths |
| `npm run test:api` | Same API integration suite |
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

The root dependency pins `@playwright/cli` to **0.1.22**. Use an existing Chrome
installation; setup does not install browser engines. For an isolated manual
verification target, create a fresh per-session temporary directory and use free alternate ports
before starting the app, for example in PowerShell:

```powershell
$reviewDirectory = Join-Path $env:TEMP ("backlog-review-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $reviewDirectory -ErrorAction Stop | Out-Null
$env:BACKLOG_DB_PATH = Join-Path $reviewDirectory 'backlog.sqlite'
$env:BACKLOG_MODEL_PATH = Join-Path $reviewDirectory 'model.json'
$env:PORT = '3101'
$env:BACKLOG_WEB_PORT = '5273'
npm run dev
```

The fresh directory isolates the SQLite database, legacy `model.json`, and all
named-model sibling files for this session. A unique model filename directly in
the shared temporary directory does not isolate the named-model collection.

In a second terminal from the repository root:

```sh
npm run browser -- -s=review open http://127.0.0.1:5273 --browser=chrome
npm run browser -- -s=review snapshot
npm run browser -- -s=review close
```

The browser uses a separate temporary profile unless `--persistent` is requested.
Browser sessions do not isolate server data: verify the server's database and model paths
before creating or deleting anything. CLI snapshots/logs in `.playwright-cli/`
and screenshots in `artifacts/` are ignored by Git.

## Data, configuration, and backup

The default database is **`data/backlog.sqlite`**, relative to the repository root
regardless of the workspace command used. It is created automatically on first
startup. SQLite may also create `-wal` and `-shm` sidecar files. The local SQLite
database and its sidecars, other private runtime data, dependencies, build output,
and verification artifacts are ignored by Git. Model JSON is the exception below.

Data models are stored separately as schema-versioned JSON at
**`data/models/model.json`**, also relative to the repository root. Loading a missing
file returns an empty model at revision 0 without creating directories or a file.
A successful save creates the parent directory if necessary and increments the
server-managed revision. Saves write a unique same-directory temporary file,
close it, then atomically rename it over the destination; temporary files are
cleaned up after failures. This protects against partial replacement, but is not
a power-loss durability guarantee. Invalid/unsupported JSON and read/write errors
return meaningful errors and never silently reset existing data.

Named saves are siblings of that configured singleton file, in
**`dirname(BACKLOG_MODEL_PATH)`** (normally `data/models`). The server generates
lowercase UUIDv4 filenames, `<uuid>.json`. Each contains exactly
`{schemaVersion: 2, revision, name, nodes, relationships}`; the ID is derived from
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
metadata are not copied. Use the same writer UID, or the deliberate setgid/group
setup above, when alternating native and Docker writers. The API does not
automatically broaden a private file's access for another user.

Each load reads fresh disk state. Saves serialize the read/revision-check/write
sequence across app instances sharing a resolved path **within one Node process**.
Cross-process locking is not provided: use a **single API writer** per model file,
including native versus Docker and different Compose projects. Avoid editing the
file externally while an API save is in flight. Back up model JSON alongside
SQLite when both are part of your work; no SQLite schema changes store models.
Programmatic callers can inject `createApp({dbPath, modelPath, webRoot?})`;
omitting `modelPath` uses the repository default, independent of environment
variables. `BACKLOG_MODEL_PATH` is applied by the standalone server entrypoint.

To back up: stop the app, then copy the entire `data` directory to a safe location.
To restore: stop the app and replace `data` with that backup. For a custom path,
back up the SQLite file and any adjacent `-wal`/`-shm` files together. Do not copy
only the main SQLite file while the app is running. There is no in-app backup or
import/export feature yet.

Optional environment variables for the API:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKLOG_DB_PATH` | `<repo>/data/backlog.sqlite` | SQLite file; relative paths resolve from the API process working directory |
| `BACKLOG_MODEL_PATH` | `<repo>/data/models/model.json` | Legacy singleton JSON file and location anchor for named UUID files in its parent directory; relative paths resolve from the standalone API working directory. Compose explicitly uses `/app/models/model.json` on the whole-directory host bind. |
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

## API and implementation

The npm workspaces are `apps/web` (React + TypeScript + Vite) and `apps/api`
(TypeScript, Node HTTP, and SQLite). There are no backend runtime dependencies.
One root lockfile manages both workspaces.

JSON endpoints under `/api`:

- `GET /projects`, `POST /projects` with `{name}`.
- `PATCH /projects/:id` with `{name}`, `DELETE /projects/:id` (cascades tasks).
- `GET /tasks`, `POST /tasks` with `{projectId,title,description?,priority?,dueDate?,status?}`.
- `PATCH /tasks/:id` with any of those task fields; `DELETE /tasks/:id`.
- `GET /model` returns `{model: {schemaVersion: 2, revision, nodes, relationships}}`.
- `PUT /model` accepts `{expectedRevision, model: {schemaVersion: 2, nodes, relationships}}`
  and returns `{model}` including the new server-managed revision (HTTP 200).
  A stale expected revision returns HTTP 409 `{error}`; reload before saving again.
  Invalid input returns 400, and corrupt/unreadable/unwritable storage returns 500
  `{error}` without exposing stored contents.
- `GET /models` returns `{models: [...]}` sorted by display name, then ID using
  deterministic UTF-16 code-unit ordering. Available entries are
  `{id,name,revision,available:true,deletable:boolean}`; unavailable entries are
  `{id,name,available:false,error,deletable:false}`. `deletable` is true only for a
  supported, read-valid physical regular file; it does not guarantee directory
  permission to unlink it. Only physically present supported entries are listed;
  a missing singleton is omitted, with no directory or file creation. A physical
  legacy entry is named `Legacy model`; corrupt, unreadable or nonregular legacy
  entries are unavailable. UUID model names remain user-authored, including
  `Default model`. No query parameter is needed for this stored-only list.
- `GET /models/legacy` returns `{id:'legacy',name:'Legacy model',model}`. A missing
  singleton still returns an empty revision-0 model for compatibility, without
  writes; physical symlinks and other nonregular entries are rejected. The
  standalone `GET /model` also returns canonical schema 2. Save through `PUT /model`;
  `PUT /models/legacy` is not supported (404).
- `GET /models/:uuid` returns `{id,name,model}`. The nested model contains only
  `{schemaVersion:2,revision,nodes,relationships}`, without the display name.
- `POST /models` accepts `{name,model:{schemaVersion:2,nodes,relationships}}`
  and returns HTTP 201 `{id,name,model}` with a server-generated UUID and revision 1.
- `PUT /models/:uuid` accepts `{expectedRevision,name,model}` and returns HTTP 200
  `{id,name,model}` with revision incremented by one. Renaming alone still requires
  the current revision and the full graph. Stale revisions return 409; a missing
  UUID returns 404; corrupt storage blocks saves with 500. UUIDs must be exact
  lowercase UUIDv4 IDs; unsafe/malformed paths return 400 or 404.
- `DELETE /models/:id` accepts exactly `{expectedRevision}` as JSON, where `id`
  is an exact lowercase UUIDv4 or `legacy`, and returns HTTP 204 with no body.
  The expected revision must be a nonnegative safe integer. Invalid bodies or
  media types return 400; host/origin protections return 403; missing physical
  files return 404; stale revisions return 409. Corrupt, unreadable, unsupported
  or nonregular storage and unlink failures return 500 without purging data.
  Deletion validates current disk contents and compares revisions in the same
  per-resolved-path, in-process queue as PUT, then unlinks only that exact file.
  Symlinks and wrong-case filenames are rejected. No recursive, sibling-file or
  SQLite deletion occurs. Deleted UUIDs remain missing on subsequent PUT (404).
  `legacy` targets only the exact configured singleton filename, which must
  physically exist. After deletion, GET still returns its virtual empty revision-0
  model and LIST omits `legacy`; that empty model is not stored until an explicit
  `PUT /model` saves it again.
  Cross-process/external filesystem writers are not locked; use a single API
  writer and do not externally replace files while PUT or DELETE is in flight.
- `GET /model-node-definitions` returns `{models:[...]}`, sorted like `/models`.
  Available entries are `{id,name,available:true,revision,definitions}`; each
  definition contains exactly `{id,name,classification,draft,properties}`.
  Unavailable entries are `{id,name,available:false,error}` with content-redacted
  errors. Only supported physical files are included, never the virtual empty
  legacy model. Reads use at most eight concurrent file readers, with the same
  exact-case, regular-file and symlink protections as the model list. Targets are
  not recursively loaded; missing references do not make a source unavailable.
  Catalog reads always use fresh saved definitions and never change disk contents.

Named display names are trimmed, nonblank Unicode text of at most 100 Unicode
code points, including spaces, with no Unicode control characters (`Cc`). Names
need not be unique. Graph input excludes `name` and
`revision`; both named and singleton routes share the same strict graph validation
and metadata defaults below. Named create/update request bodies retain the 512 KiB
limit; DELETE retains the ordinary 32768-byte limit. All retain the same
host/origin/media-type protections. No import endpoints are provided.

Canonical graph input and saved files use schema version 2. Schema-1 files and
requests remain accepted as definitions only: a missing `kind` defaults to
`definition`; an explicit `kind:'definition'` is accepted, but references are not.
GET normalizes schema 1 to schema 2 in memory, without migrating or rewriting any
file. Only an explicit successful save writes schema 2. Schema 2 requires `kind`
on every node and all fields of its variant.

Definition nodes are `{kind:'definition',id,name,x,y,classification,draft,properties}`
and relationships are `{id,name,source,target,sourceCardinality,targetCardinality}`.
Each end's cardinality is exactly `0..*`, `1..*` or `1..1`. In schema-1 and schema-2
files and requests, either missing cardinality independently defaults to `0..*`.
GET/list normalize in memory without rewriting files; the next successful save
persists both fields in schema 2. Explicit invalid values (including null) and
unknown fields are rejected. Cardinalities are annotations, not enforced constraints;
local endpoint IDs, reference targets and direction/name uniqueness are unchanged.
Definition classification is exactly `Transactional`, `Master Data`,
`Reference Data` or `Metadata`; draft is a boolean. Under schema version 1, either
node field may independently be omitted by legacy files or clients, defaulting to
`Transactional` and `false`. GET normalizes responses without rewriting disk;
the next successful explicit save persists schema 2 and both fields. Supplied invalid values
(including null) are rejected; revision conflict behavior is unchanged.
Each node's `properties` is a normalized array (at most 100 entries). Missing
`properties` independently defaults to `[]` in schema-1 files and requests: GET
does not rewrite files; the next successful save persists the array. Each property
requires exactly `{name,dataType,description,nodeKey,uniqueness,mustExist,index}`.
Names and data types are trimmed, nonblank free text, at most 100 Unicode code
points with no Unicode control characters (`Cc`); names are case-sensitive unique
within each node. Data types have no predefined options. Descriptions are strings
of at most 2000 Unicode code points, allowing multiline text but no NUL. `nodeKey`,
`uniqueness` and `mustExist` are required strict booleans; `index` is required and
canonically `None`, `Range`, `Text` or `Point`. Schema-1 files and requests also
accept legacy boolean indexes (`true` → `Range`, `false` → `None`). GET/list
normalize without rewriting disk; the next successful save persists canonical
strings. These fields are independent model annotations and do not create or
enforce Neo4j constraints or indexes. Null/non-array properties, unknown
fields and invalid entries are rejected without changing file bytes or revision.
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
external targets resolve against a supported physical saved file. References
cannot target other references. Invalid/unavailable targets return 400, while
409 remains reserved for source revision conflicts. An existing reference with
the same local ID, classification and exact target tuple can be retained even if
the target was removed, is corrupt/unavailable, or now contains a reference.
Classification/context rules always apply. Reads never require target resolution.
Deleting a target never cascades to or rewrites dependents and does not block
source reads, unrelated saves or deletion; unresolved references remain stored.

Named POST allocates its UUID internally and rebases **all** Internal Reference
target model IDs to that UUID, allowing graph copies. External targets stay
unchanged and cannot equal the newly allocated containing UUID. Target identity
is the tuple `{modelId,nodeId}`: references reflect the latest saved definition at
that tuple, including renames and replacements, rather than a historical snapshot.
Discovery shows saved definitions only. Single-file atomic publication and
in-process revision queues do not provide atomic cross-file reference integrity:
an external writer or concurrent target deletion may change a target after validation.

Node IDs match `node-[0-9]+`; relationship IDs match `relationship-[0-9]+`, each
with a safe-integer suffix and unique exact IDs. Node names contain only ASCII
letters, start uppercase, are at most 24 characters and are exact-unique.
Relationship names match `[A-Z]+(?:_[A-Z]+)*`, at most 24 characters. Endpoints
must exist. Duplicate direction/name connections are rejected; self-links,
reverse links and differently named parallel links are allowed. Coordinates are
finite multiples of 20 in `[60,100000]`, with at least 180 Euclidean units between
nodes. Limits are 200 nodes, 1000 relationships and 512 KiB per model request
body; other request bodies retain the 32768-byte limit. Unknown fields are
rejected in requests and stored model files; schema versions 1 and 2 are supported.
Revisions and expected revisions are nonnegative safe integers.

Project/task lists return `{projects}` or `{tasks}`, writes return `{project}` or `{task}`,
creates return HTTP 201, and deletes return HTTP 204. Errors are `{error: string}`
with meaningful 400/404 responses. Project/task IDs are UUIDs; timestamps are UTC ISO strings.
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
