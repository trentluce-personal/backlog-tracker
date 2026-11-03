# Isolated end-to-end Docker development check. Never targets the workspace project.
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$id = 'backlogdevtest' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$root = Join-Path ([IO.Path]::GetTempPath()) $id
$old = @{}
foreach ($key in @('COMPOSE_PROJECT_NAME', 'COMPOSE_FILE', 'COMPOSE_ENV_FILES', 'BACKLOG_DEV_HOST_PORT', 'BACKLOG_HOST_PORT', 'BACKLOG_DEV_VOLUME', 'BACKLOG_MAINTENANCE_VOLUME', 'MSYS_NO_PATHCONV', 'BACKLOG_SHELL_ACTION', 'BACKLOG_SHELL_PATH', 'BACKLOG_FIXTURE_ROOT')) { $old[$key] = [Environment]::GetEnvironmentVariable($key, 'Process'); [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
function Check($condition, $message) { if (-not $condition) { throw $message }; Write-Host "PASS $message" }
function FreePort { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start(); try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() } }
function Task($action) { & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\application.ps1" -Action $action; if ($LASTEXITCODE -ne 0) { throw "Task $action failed: $LASTEXITCODE" } }
function Maintenance($action, $path) { & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\database-maintenance.ps1" -Action $action -Path $path; if ($LASTEXITCODE -ne 0) { throw "Maintenance $action failed: $LASTEXITCODE" } }
function ShellMaintenance($action, $path) {
    $env:BACKLOG_SHELL_ACTION = $action; $env:BACKLOG_SHELL_PATH = $path; $env:BACKLOG_FIXTURE_ROOT = $root
    $env:MSYS_NO_PATHCONV = '1'
    & bash.exe -c 'cd "$BACKLOG_FIXTURE_ROOT" && sh scripts/database-maintenance.sh "$BACKLOG_SHELL_ACTION" "$BACKLOG_SHELL_PATH"' | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
}
function WaitFor($predicate, $message) { for ($i = 0; $i -lt 60; $i++) { if (& $predicate) { return }; Start-Sleep -Milliseconds 500 }; throw "Timed out: $message" }
try {
    [void][IO.Directory]::CreateDirectory($root)
    foreach ($item in @('compose.yaml', 'compose.dev.yaml', 'Dockerfile', 'Dockerfile.dev', '.dockerignore', 'package.json', 'package-lock.json', 'apps', 'scripts')) {
        Copy-Item -LiteralPath (Join-Path $source $item) -Destination $root -Recurse
    }
    # Exclude any copied local dependencies/builds; the dev image owns its npm install.
    foreach ($item in @('apps\api\node_modules', 'apps\web\node_modules', 'apps\api\dist', 'apps\web\dist')) { $path = Join-Path $root $item; if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force } }
    $env:COMPOSE_PROJECT_NAME = $id
    $env:BACKLOG_DEV_HOST_PORT = [string](FreePort)
    $env:BACKLOG_HOST_PORT = [string](FreePort)
    $volume = "${id}_custom_data"
    [IO.File]::WriteAllText((Join-Path $root 'compose.override.yaml'), "volumes:`n  backlog-data:`n    name: $volume`n")
    $base = "http://127.0.0.1:$env:BACKLOG_DEV_HOST_PORT"
    Write-Host "Isolated project=$id volume=$volume copy=$root URL=$base"
    Push-Location $root
    try {
        Task Start
        Check ((Invoke-RestMethod "$base/api/projects").projects.Count -eq 0) 'fresh custom volume initialized by development'
        $cors = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/projects" -Headers @{ Origin = 'http://localhost:49152' }
        Check (-not $cors.Headers['Access-Control-Allow-Origin']) 'unrelated localhost origin receives no CORS access'
        $backup = Join-Path ([IO.Path]::GetTempPath()) "${id}-backup"
        Maintenance Backup $backup
        Check (Test-Path -LiteralPath "$backup\backlog.sqlite") 'backup works with dev running and no production container'
        Check (@(& docker ps -q --filter "volume=$volume").Count -eq 0) 'maintenance stopped dev and no writer remains'
        Check (@(& docker ps -aq --filter "volume=$volume").Count -eq 1) 'backup removes offline copy container'
        Task Start
        $shellProject = Invoke-RestMethod -Uri "$base/api/projects" -Method Post -ContentType 'application/json' -Headers @{ Origin = $base } -Body '{"name":"shell backup"}'
        $shellBackup = Join-Path ([IO.Path]::GetTempPath()) "${id}-shell-backup"
        Check ((ShellMaintenance backup $shellBackup) -eq 0) 'POSIX documented backup command succeeds with dev-only external-name volume'
        Check (Test-Path -LiteralPath "$shellBackup\backlog.sqlite") 'POSIX backup contains database'
        Check (@(& docker ps -q --filter "volume=$volume").Count -eq 0) 'POSIX backup stopped dev and checked volume users'
        Task Start
        $after = Invoke-RestMethod -Uri "$base/api/projects" -Method Post -ContentType 'application/json' -Headers @{ Origin = $base } -Body '{"name":"after shell backup"}'
        $env:BACKLOG_MAINTENANCE_VOLUME = $volume
        $shellWriter = (& docker run -d --network none --mount "type=volume,source=$volume,target=/app/data" --entrypoint node "${id}-dev" -e 'setInterval(()=>{},1000)').Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Failed to start isolated POSIX writer fixture' }
        Check ((& docker inspect --format '{{.State.Running}}' $shellWriter).Trim() -eq 'true') 'POSIX writer fixture is running'
        try { Check ((ShellMaintenance restore $shellBackup) -ne 0) 'POSIX restore refuses unrelated volume user' } finally { & docker rm -f $shellWriter }
        Task Start
        Check ((Invoke-RestMethod "$base/api/projects").projects.id -contains $after.project.id) 'POSIX refused restore preserved current data'
        Check ((ShellMaintenance restore $shellBackup) -eq 0) 'POSIX documented restore command succeeds'
        Task Start
        $projects = (Invoke-RestMethod "$base/api/projects").projects.id
        Check (($projects -contains $shellProject.project.id) -and ($projects -notcontains $after.project.id)) 'POSIX restore recovered backed up data and writable ownership'
        Task Stop
        # Create a disposable production container to exercise switching.
        & docker compose up --build -d --wait app
        if ($LASTEXITCODE -ne 0) { throw 'Isolated production start failed' }
        $production = (& docker compose ps -q app).Trim()
        Check ($production.Length -gt 0) 'production default starts in isolated project'
        $shellProductionBackup = Join-Path ([IO.Path]::GetTempPath()) "${id}-shell-production-backup"
        Check ((ShellMaintenance backup $shellProductionBackup) -eq 0) 'POSIX backup stops running production service'
        Check ((& docker inspect --format '{{.State.Running}}' $production).Trim() -eq 'false') 'POSIX backup leaves production stopped'
        & docker compose start --wait app
        if ($LASTEXITCODE -ne 0) { throw 'Isolated production restart failed' }
        [IO.File]::WriteAllText((Join-Path $root 'compose.override.yaml'), "services:`n  app:`n    volumes:`n      - type: volume`n        source: backlog-data`n        target: /app/data`n        volume:`n          subpath: nested`nvolumes:`n  backlog-data:`n    name: $volume`n")
        $resolved = (& docker compose config --format json | Out-String) | ConvertFrom-Json
        Check ($resolved.services.app.volumes[0].volume.subpath -eq 'nested') 'Compose resolves production volume subpath'
        & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\application.ps1" -Action Start
        Check ($LASTEXITCODE -ne 0 -and (& docker inspect --format '{{.State.Running}}' $production).Trim() -eq 'true') 'unsafe subpath fails before production is stopped'
        [IO.File]::WriteAllText((Join-Path $root 'compose.override.yaml'), "services:`n  app:`n    volumes:`n      - type: tmpfs`n        target: /app/data/backlog.sqlite`nvolumes:`n  backlog-data:`n    name: $volume`n")
        & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\application.ps1" -Action Start
        Check ($LASTEXITCODE -ne 0 -and (& docker inspect --format '{{.State.Running}}' $production).Trim() -eq 'true') 'nested database mount fails before production is stopped'
        [IO.File]::WriteAllText((Join-Path $root 'compose.override.yaml'), "services:`n  app:`n    environment:`n      BACKLOG_DB_PATH: /tmp/other.sqlite`nvolumes:`n  backlog-data:`n    name: $volume`n")
        & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\application.ps1" -Action Start
        Check ($LASTEXITCODE -ne 0 -and (& docker inspect --format '{{.State.Running}}' $production).Trim() -eq 'true') 'unsafe database override fails before production is stopped'
        [IO.File]::WriteAllText((Join-Path $root 'compose.override.yaml'), "volumes:`n  backlog-data:`n    name: $volume`n")
        Task Start
        Check ((& docker inspect --format '{{.State.Running}}' $production).Trim() -eq 'false') 'Start stopped isolated production container'
        $env:BACKLOG_DEV_VOLUME = $volume
        $dev = (& docker compose -p $id -f compose.dev.yaml ps -q dev).Trim()
        Check ($dev.Length -gt 0) 'development container exists'
        Check ((& docker inspect --format '{{json .HostConfig.PortBindings}}' $dev) -match '127\.0\.0\.1') 'development port is loopback-only'
        $project = Invoke-RestMethod -Uri "$base/api/projects" -Method Post -ContentType 'application/json' -Headers @{ Origin = $base } -Body '{"name":"isolated persistence check"}'
        Check ($null -ne $project.project.id) 'same-origin API mutation works'
        try { Invoke-WebRequest -UseBasicParsing -Uri "$base/api/projects" -Method Post -ContentType 'application/json' -Headers @{ Origin = 'http://evil.example' } -Body '{"name":"bad"}' | Out-Null; throw 'foreign origin accepted' } catch { if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 403) { throw } }
        Check $true 'foreign origin rejected'
        try { Invoke-WebRequest -UseBasicParsing -Uri "$base/api/projects" -Headers @{ Host = 'evil.example' } | Out-Null; throw 'foreign host accepted' } catch { if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -notin @(400, 403)) { throw } }
        Check $true 'foreign host rejected'
        $socket = [Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.AddSubProtocol('vite-hmr')
        [void]$socket.ConnectAsync([Uri]"ws://127.0.0.1:$env:BACKLOG_DEV_HOST_PORT/", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        [void](Invoke-WebRequest -UseBasicParsing -Uri "$base/src/styles.css")
        $css = Join-Path $root 'apps\web\src\styles.css'
        [IO.File]::AppendAllText($css, "`n/* isolated-hmr-$id */`n")
        $buffer = New-Object byte[] 16384
        $found = $false
        $cancel = [Threading.CancellationTokenSource]::new(30000)
        try {
            while (-not $found) {
                $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
                $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count)
                if ($text -match '"type":"update"' -and $text -match 'styles\.css') { $found = $true }
            }
        } finally { $socket.Dispose(); $cancel.Dispose() }
        Check $found 'CSS change produces actual Vite HMR websocket update'
        $socket = [Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.AddSubProtocol('vite-hmr')
        [void]$socket.ConnectAsync([Uri]"ws://127.0.0.1:$env:BACKLOG_DEV_HOST_PORT/", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        [void](Invoke-WebRequest -UseBasicParsing -Uri "$base/src/App.tsx")
        [IO.File]::AppendAllText((Join-Path $root 'apps\web\src\App.tsx'), "`n// isolated-hmr-$id`n")
        $found = $false; $cancel = [Threading.CancellationTokenSource]::new(30000)
        try {
            while (-not $found) {
                $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
                $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count)
                if ($text -match '"type":"update"' -and $text -match 'App\.tsx') { $found = $true }
            }
        } finally { $socket.Dispose(); $cancel.Dispose() }
        Check $found 'frontend source change produces actual Vite HMR websocket update'
        [IO.File]::AppendAllText((Join-Path $root 'apps\api\src\server.ts'), "`n// isolated-reload-$id`n")
        WaitFor { (& docker logs $dev 2>&1 | Out-String) -match 'API source changed; restarting' } 'API reload log'
        WaitFor { try { (Invoke-RestMethod "$base/api/projects").projects.id -contains $project.project.id } catch { $false } } 'API ready after reload'
        Check $true 'API source change restarts and retains database'
        Task Restart
        Check ((Invoke-RestMethod "$base/api/projects").projects.id -contains $project.project.id) 'database persists across Restart'
        $writer = (& docker run -d --network none --mount "type=volume,source=$volume,target=/app/data" --entrypoint node "${id}-dev" -e 'setInterval(()=>{},1000)').Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Failed to start isolated extra writer fixture' }
        try {
            & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\database-maintenance.ps1" -Action Restore -Path $backup
            Check ($LASTEXITCODE -ne 0) 'restore refuses unrelated running volume mount'
        } finally { & docker rm -f $writer }
        Task Start
        Check ((Invoke-RestMethod "$base/api/projects").projects.id -contains $project.project.id) 'refused restore left database intact'
        Maintenance Restore $backup
        Check (@(& docker ps -aq --filter "volume=$volume").Count -eq 2) 'restore removes offline copy container'
        Task Start
        Check ((Invoke-RestMethod "$base/api/projects").projects.id -notcontains $project.project.id) 'offline restore recovers earlier isolated backup'
        $project = Invoke-RestMethod -Uri "$base/api/projects" -Method Post -ContentType 'application/json' -Headers @{ Origin = $base } -Body '{"name":"isolated persistence check"}'
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + "$root\scripts\application.ps1" + '" -Action Logs'
        $info.WorkingDirectory = $root; $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        $logProcess = [Diagnostics.Process]::Start($info)
        try {
            $line = $logProcess.StandardOutput.ReadLineAsync()
            Check ($line.Wait(15000) -and $line.Result -match 'dev-1') 'Logs task follows development service'
        } finally { if (-not $logProcess.HasExited) { $logProcess.Kill(); [void]$logProcess.WaitForExit(5000) }; $logProcess.Dispose() }
        Task Stop
        Check ((& docker inspect --format '{{.State.Running}}' $dev).Trim() -eq 'false') 'Stop stops development service'
        $busy = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$env:BACKLOG_DEV_HOST_PORT)
        $busy.Start()
        try {
            & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$root\scripts\application.ps1" -Action Start
            Check ($LASTEXITCODE -ne 0) 'occupied host port fails Start'
        } finally { $busy.Stop() }
        Task Start
        Check ((Invoke-RestMethod "$base/api/projects").projects.id -contains $project.project.id) 'database persists across Stop and Start'
    } finally { Pop-Location }
} finally {
    if (Test-Path -LiteralPath $root) {
        Push-Location $root
        try { $env:BACKLOG_DEV_VOLUME = "${id}_custom_data"; & docker compose -p $id -f compose.dev.yaml logs --tail 100 dev; & docker compose -p $id -f compose.dev.yaml down --remove-orphans; & docker volume rm "${id}_custom_data"; & docker image rm "${id}-app" "${id}-dev" } finally { Pop-Location }
        Remove-Item -LiteralPath $root -Recurse -Force
    }
    foreach ($key in $old.Keys) { [Environment]::SetEnvironmentVariable($key, $old[$key], 'Process') }
    if ($backup -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Recurse -Force }
    if ($shellBackup -and (Test-Path -LiteralPath $shellBackup)) { Remove-Item -LiteralPath $shellBackup -Recurse -Force }
    if ($shellProductionBackup -and (Test-Path -LiteralPath $shellProductionBackup)) { Remove-Item -LiteralPath $shellProductionBackup -Recurse -Force }
}
