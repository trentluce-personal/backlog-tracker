# Windows PowerShell 5.1. Dot-sourcing defines functions only (used by the tests).
[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Logs')]
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
        Launch = { $desktop = & $findDesktop; Start-Process -FilePath $desktop -ErrorAction Stop | Out-Null }.GetNewClosure()
        Now = { $clock.Elapsed.TotalMilliseconds }.GetNewClosure()
        Sleep = { param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    }
}

function Invoke-ApplicationLifecycle {
    [CmdletBinding()]
    param([string]$Operation, [hashtable]$Runtime, [int]$DockerTimeout = 180, [int]$HealthTimeout = 120)
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
        Write-Host 'Linux Docker engine ready. Building and starting the application...'
        $code = & $Runtime.Compose @('up', '--build', '-d', '--wait', '--wait-timeout', "$HealthTimeout")
        if ($code -ne 0) { return $code }
        # Ask Compose for the actual binding (also honors .env and BACKLOG_HOST_PORT).
        $binding = & $Runtime.Probe @('compose', 'port', 'app', '3001') 10000
        if ($binding.StdErr) { Write-Warning $binding.StdErr }
        if ($binding.Code -ne 0 -or $binding.StdOut -notmatch '^127\.0\.0\.1:(\d+)$') {
            throw "Application started, but its loopback URL could not be determined: $($binding.StdOut) $($binding.StdErr). Check docker compose ps."
        }
        Write-Host "Application ready: http://127.0.0.1:$($Matches[1])"
        return 0
    }
    [string[]]$composeArguments = if ($Operation -eq 'Stop') { @('stop') } else { @('logs', '--follow', '--tail', '100') }
    $code = & $Runtime.Compose $composeArguments
    if ($Operation -eq 'Stop' -and $code -eq 0) { Write-Host 'Application stopped. Its data volume and Docker Desktop are preserved.' }
    return $code
}

function Invoke-GuardedApplicationLifecycle {
    [CmdletBinding()]
    param([string]$Directory, [string]$Operation, [hashtable]$Runtime, [int]$DockerTimeout = 180, [int]$HealthTimeout = 120)
    $mutex = $null
    $owned = $false
    try {
        if ($Operation -in @('Start', 'Stop')) {
            # A stable Windows workspace identity, independent of project/port env.
            $path = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/').ToUpperInvariant()
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($path))).Replace('-', '') }
            finally { $hash.Dispose() }
            $mutex = New-Object Threading.Mutex($false, "Local\BacklogTrackerLifecycle-$key")
            try { $owned = $mutex.WaitOne(0) }
            catch [Threading.AbandonedMutexException] { $owned = $true }
            if (-not $owned) {
                throw 'Another lifecycle operation is in progress for this workspace. Retry after it finishes, or terminate the active Start/Stop task and retry. Termination does not guarantee Compose cancellation; stop the app again once any pending build/start finishes.'
            }
        }
        if (-not $Runtime) { $Runtime = New-ApplicationRuntime $Directory }
        Invoke-ApplicationLifecycle $Operation $Runtime $DockerTimeout $HealthTimeout
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
