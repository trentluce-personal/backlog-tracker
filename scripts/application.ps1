# Windows PowerShell 5.1. Dot-sourcing defines functions only (used by the tests).
[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Restart', 'Logs')]
    [string]$Action = 'Start',
    [ValidateRange(1, 1800)]
    [int]$DockerTimeoutSeconds = 180,
    [ValidateRange(1, 1800)]
    [int]$HealthTimeoutSeconds = 120
)

function Invoke-DockerProbe {
    param([string]$Docker, [string[]]$Arguments, [int]$TimeoutMilliseconds, [string]$Directory)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Docker
    # Windows argv quoting, including embedded quotes and trailing backslashes.
    $info.Arguments = ($Arguments | ForEach-Object {
        '"' + ([regex]::Replace([regex]::Replace($_, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
    }) -join ' '
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMilliseconds)) {
            $process.Kill()
            return [pscustomobject]@{ Code = 124; StdOut = ''; StdErr = 'Docker command timed out.' }
        }
        # Bound even pipe draining (e.g. a child retaining a redirected handle).
        if (-not [System.Threading.Tasks.Task]::WaitAll(@($stdout, $stderr), 1000)) {
            return [pscustomobject]@{ Code = 124; StdOut = ''; StdErr = 'Docker output timed out.' }
        }
        [pscustomobject]@{ Code = $process.ExitCode; StdOut = $stdout.Result.Trim(); StdErr = $stderr.Result.Trim() }
    }
    finally { $process.Dispose() }
}

function Find-DockerDesktop {
    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
    )
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
    throw 'Docker engine is unavailable and Docker Desktop was not found. Install Docker Desktop, configure its Linux/WSL2 backend, then retry (or start your Linux Docker engine manually).'
}

function Assert-SafeDatabaseMount {
    param($App)
    if ($App.volumes_from) { throw 'Production Compose uses volumes_from; database mount safety cannot be established.' }
    $data = '/app/data'
    $mounts = @($App.volumes | Where-Object { $_.target -ceq $data -and $_.type -ceq 'volume' -and $_.source -ceq 'backlog-data' })
    if ($mounts.Count -ne 1 -or $App.environment.BACKLOG_DB_PATH -cne '/app/data/backlog.sqlite' -or
        ($mounts[0].volume -and $mounts[0].volume.PSObject.Properties['subpath'])) {
        throw 'Production Compose overrides change the database mount or path. Development cannot safely select the same database.'
    }
    # Docker targets are Linux paths. Normalize dot segments and reject every
    # nested mount, including sidecars and targets supplied by tmpfs/secrets/configs.
    $targets = @($App.volumes | ForEach-Object { $_.target }) + @($App.tmpfs | ForEach-Object { ([string]$_).Split(':')[0] }) +
        @($App.secrets | ForEach-Object { $_.target }) + @($App.configs | ForEach-Object { $_.target })
    $matching = 0
    foreach ($target in $targets) {
        if (-not $target) { continue }
        $parts = New-Object 'System.Collections.Generic.List[string]'
        foreach ($part in ([string]$target).Split('/')) {
            if (-not $part -or $part -ceq '.') { continue }
            if ($part -ceq '..') { if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }; continue }
            $parts.Add($part)
        }
        $path = '/' + ($parts -join '/')
        if ($path -ceq $data) { $matching++ }
        elseif ($path.StartsWith($data + '/', [StringComparison]::Ordinal)) {
            throw 'Production Compose has an overlapping mount under /app/data. Development cannot safely select the same database.'
        }
    }
    if ($matching -ne 1) { throw 'Production Compose has overlapping mounts at /app/data. Development cannot safely select the same database.' }
}

function New-ApplicationRuntime {
    param([string]$Directory)
    $command = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        throw 'Docker CLI was not found. Install Docker Desktop and restart VS Code so docker.exe is on PATH.'
    }
    $docker = $command.Source
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $probeCommand = ${function:Invoke-DockerProbe}
    $findDesktop = ${function:Find-DockerDesktop}
    $validateMount = ${function:Assert-SafeDatabaseMount}
    $settings = @{}
    # Injection is internal only: the CLI accepts no executable or command overrides.
    @{
        Probe = { param($Arguments, $Timeout) & $probeCommand $docker $Arguments $Timeout $Directory }.GetNewClosure()
        Compose = {
            param($Arguments)
            Push-Location -LiteralPath $Directory
            # TTY progress can request an invalid console in noninteractive tasks.
            # ANSI alone does not override COMPOSE_PROGRESS=tty.
            try { & $docker compose --ansi never --progress plain @Arguments | ForEach-Object { Write-Host $_ }; return $LASTEXITCODE }
            finally { Pop-Location }
        }.GetNewClosure()
        Configure = {
            $result = & $probeCommand $docker @('compose', 'config', '--format', 'json') 15000 $Directory
            if ($result.Code -ne 0) { throw "Could not resolve production Compose configuration: $($result.StdErr)" }
            try { $config = $result.StdOut | ConvertFrom-Json }
            catch { throw 'Could not parse production Compose configuration.' }
            $volume = $config.volumes.'backlog-data'
            if (-not $config.name -or -not $volume.name -or -not $config.services.app) {
                throw 'Production Compose configuration must contain the app service and backlog-data volume.'
            }
            & $validateMount $config.services.app
            $settings.Project = [string]$config.name
            $settings.Volume = [string]$volume.name
            $settings.External = [bool]$volume.external
            $settings.CustomVolume = [bool]($volume.driver -or $volume.driver_opts)
            $env:BACKLOG_DEV_VOLUME = $settings.Volume
        }.GetNewClosure()
        EnsureVolume = {
            if ($settings.External) { return 0 }
            if ($settings.CustomVolume) {
                $existing = & $probeCommand $docker @('volume', 'inspect', $settings.Volume) 15000 $Directory
                if ($existing.Code -ne 0) { throw 'The configured production volume uses a custom driver or options and does not exist. Create it using production Compose before starting development.' }
                return 0
            }
            $result = & $probeCommand $docker @('volume', 'create', '--label', "com.docker.compose.project=$($settings.Project)", '--label', 'com.docker.compose.volume=backlog-data', $settings.Volume) 15000 $Directory
            if ($result.Code -ne 0) { throw "Could not create development data volume: $($result.StdErr)" }
            return 0
        }.GetNewClosure()
        DevCompose = {
            param($Arguments)
            Push-Location -LiteralPath $Directory
            try { & $docker compose --ansi never --progress plain --project-directory $Directory -p $settings.Project -f (Join-Path $Directory 'compose.dev.yaml') @Arguments | ForEach-Object { Write-Host $_ }; return $LASTEXITCODE }
            finally { Pop-Location }
        }.GetNewClosure()
        DevProbe = {
            param($Arguments, $Timeout)
            $prefix = @('compose', '--project-directory', $Directory, '-p', $settings.Project, '-f', (Join-Path $Directory 'compose.dev.yaml'))
            & $probeCommand $docker ($prefix + $Arguments) $Timeout $Directory
        }.GetNewClosure()
        Launch = { $desktop = & $findDesktop; Start-Process -FilePath $desktop -ErrorAction Stop | Out-Null }.GetNewClosure()
        Now = { $clock.Elapsed.TotalMilliseconds }.GetNewClosure()
        Sleep = { param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    }
}

function Invoke-ApplicationLifecycle {
    [CmdletBinding()]
    param([string]$Operation, [hashtable]$Runtime, [int]$DockerTimeout = 180, [int]$HealthTimeout = 120)
    if ($Operation -eq 'Restart') {
        $code = Invoke-ApplicationLifecycle Stop $Runtime $DockerTimeout $HealthTimeout
        if ($code -ne 0) { return $code }
        return (Invoke-ApplicationLifecycle Start $Runtime $DockerTimeout $HealthTimeout)
    }
    $version = & $Runtime.Probe @('compose', 'version') 10000
    if ($version.Code -ne 0) {
        throw "Docker Compose is unavailable. Install/update Docker Desktop with Compose v2+. $($version.StdOut) $($version.StdErr)"
    }
    if ($version.StdErr) { Write-Warning $version.StdErr }
    if ($Operation -eq 'Start') {
        $deadline = (& $Runtime.Now) + $DockerTimeout * 1000
        $launched = $false
        $lastFailure = ''
        while ($true) {
            $remaining = $deadline - (& $Runtime.Now)
            if ($remaining -le 0) {
                throw "Timed out after $DockerTimeout seconds waiting for a Linux Docker engine. Check Docker Desktop startup/WSL2 and the selected Docker context; no context or container mode was changed. Last probe: $lastFailure"
            }
            $probe = & $Runtime.Probe @('info', '--format', '{{.OSType}}') ([int][Math]::Min(5000, [Math]::Ceiling($remaining)))
            if ($probe.Code -eq 0) {
                if ($probe.StdErr) { Write-Warning $probe.StdErr }
                $engine = $probe.StdOut.Trim()
                if ($engine -ne 'linux') {
                    throw "Docker reports engine '$engine'; this app requires Linux containers. Select Linux containers in Docker Desktop/check your Docker context, then retry."
                }
                break
            }
            $lastFailure = "$($probe.StdOut) $($probe.StdErr)".Trim()
            if (-not $launched) {
                Write-Host 'Docker engine is unavailable. Starting Docker Desktop...'
                & $Runtime.Launch
                $launched = $true
            }
            $remaining = $deadline - (& $Runtime.Now)
            if ($remaining -gt 0) {
                Write-Host ("Waiting for the Linux Docker engine ({0}s remaining)..." -f [Math]::Ceiling($remaining / 1000))
                & $Runtime.Sleep ([int][Math]::Min(2000, [Math]::Ceiling($remaining)))
            }
        }
        & $Runtime.Configure
        Write-Host 'Stopping the production app in this Compose project before starting development (data volume is preserved)...'
        $code = & $Runtime.Compose @('stop', 'app')
        if ($code -ne 0) { return $code }
        $code = & $Runtime.EnsureVolume
        if ($code -ne 0) { return $code }
        Write-Host 'Linux Docker engine ready. Building and starting the development application...'
        $code = & $Runtime.DevCompose @('up', '--build', '-d', '--wait', '--wait-timeout', "$HealthTimeout", 'dev')
        if ($code -ne 0) { return $code }
        $binding = & $Runtime.DevProbe @('port', 'dev', '5173') 10000
        if ($binding.StdErr) { Write-Warning $binding.StdErr }
        if ($binding.Code -ne 0 -or $binding.StdOut -notmatch '^127\.0\.0\.1:(\d+)$') {
            throw "Application started, but its loopback URL could not be determined: $($binding.StdOut) $($binding.StdErr). Check docker compose ps."
        }
        Write-Host "Application ready: http://127.0.0.1:$($Matches[1])"
        return 0
    }
    & $Runtime.Configure
    [string[]]$composeArguments = if ($Operation -eq 'Stop') { @('stop', 'dev') } else { @('logs', '--follow', '--tail', '100', 'dev') }
    $code = & $Runtime.DevCompose $composeArguments
    if ($Operation -eq 'Stop' -and $code -eq 0) { Write-Host 'Application stopped. Its data volume and Docker Desktop are preserved.' }
    return $code
}

function Invoke-GuardedApplicationLifecycle {
    [CmdletBinding()]
    param([string]$Directory, [string]$Operation, [hashtable]$Runtime, [int]$DockerTimeout = 180, [int]$HealthTimeout = 120, [scriptblock]$Body)
    $mutex = $null
    $owned = $false
    try {
        if ($Operation -in @('Start', 'Stop', 'Restart', 'Maintenance')) {
            # A stable Windows workspace identity, independent of project/port env.
            $path = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/').ToUpperInvariant()
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($path))).Replace('-', '') }
            finally { $hash.Dispose() }
            $mutex = New-Object Threading.Mutex($false, "Local\BacklogTrackerLifecycle-$key")
            try { $owned = $mutex.WaitOne(0) }
            catch [Threading.AbandonedMutexException] { $owned = $true }
            if (-not $owned) {
                throw 'Another lifecycle operation is in progress for this workspace. Retry after it finishes, or terminate the active Start/Stop/Restart or maintenance task and retry. Termination does not guarantee Compose cancellation; stop the app again once any pending build/start finishes.'
            }
        }
        if (-not $Runtime) { $Runtime = New-ApplicationRuntime $Directory }
        if ($Body) { & $Body $Runtime } else { Invoke-ApplicationLifecycle $Operation $Runtime $DockerTimeout $HealthTimeout }
    }
    finally {
        if ($owned) { $mutex.ReleaseMutex() }
        if ($mutex) { $mutex.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    try {
        $root = Split-Path -Parent $PSScriptRoot
        exit (Invoke-GuardedApplicationLifecycle -Directory $root -Operation $Action -DockerTimeout $DockerTimeoutSeconds -HealthTimeout $HealthTimeoutSeconds)
    }
    catch {
        [Console]::Error.WriteLine("Application task failed: " + $_.Exception.Message)
        exit 1
    }
}
