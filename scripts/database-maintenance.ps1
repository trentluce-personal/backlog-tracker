# Windows PowerShell 5.1: offline backup/restore of the resolved Compose volume.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Backup', 'Restore')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Path
)
$ErrorActionPreference = 'Stop'
$maintenanceAction = $Action
. "$PSScriptRoot\application.ps1"
$root = Split-Path -Parent $PSScriptRoot
$script:container = $null
function Docker([string[]]$Arguments) {
    $result = & docker.exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($Arguments -join ' ')" }
    return $result
}
function Assert-NoWriters([string]$Volume) {
    $running = @(Docker @('ps', '-q', '--filter', "volume=$Volume"))
    if ($running.Count -gt 0) { throw "Running containers still mount volume '$Volume': $($running -join ', '). Stop them before continuing." }
}
try {
    $destination = [IO.Path]::GetFullPath($Path)
    if ($maintenanceAction -eq 'Backup' -and (Test-Path -LiteralPath $destination)) { throw 'Backup destination must not already exist.' }
    if ($maintenanceAction -eq 'Restore' -and -not (Test-Path -LiteralPath (Join-Path $destination 'backlog.sqlite') -PathType Leaf)) { throw 'Restore directory must contain backlog.sqlite at its root.' }
    Invoke-GuardedApplicationLifecycle -Directory $root -Operation Maintenance -Body {
    param($runtime)
    & $runtime.Configure
    $volume = $env:BACKLOG_DEV_VOLUME
    $config = (Docker @('compose', 'config', '--format', 'json') | Out-String) | ConvertFrom-Json
    $project = [string]$config.name
    Write-Host "Project: $project; database volume: $volume"
    if ((& $runtime.DevCompose @('stop', 'dev')) -ne 0) { throw 'Stopping development failed.' }
    if ((& $runtime.Compose @('stop', 'app')) -ne 0) { throw 'Stopping production failed.' }
    Assert-NoWriters $volume
    # Reuse an existing stopped app/dev image, without requiring an app container.
    $ids = @()
    foreach ($service in @('app', 'dev')) { $ids += @(Docker @('ps', '-aq', '--filter', "label=com.docker.compose.project=$project", '--filter', "label=com.docker.compose.service=$service", '--filter', "volume=$volume")) }
    if ($ids.Count -eq 0) { throw 'No existing app or dev container mounts this volume. Start and stop the app first, then retry.' }
    $image = (Docker @('inspect', '--format', '{{.Config.Image}}', [string]$ids[0]) | Out-String).Trim()
    if (-not $image) { throw 'Could not determine an existing container image.' }
    $mount = "type=volume,source=$volume,target=/app/data"
    if ($maintenanceAction -eq 'Backup') { $mount += ',readonly' }
    $script:container = (Docker @('create', '--network', 'none', '--mount', $mount, '--entrypoint', 'node', $image, '--version') | Out-String).Trim()
    if (-not $script:container) { throw 'Could not create the offline copy container.' }
    if ($maintenanceAction -eq 'Backup') {
        Assert-NoWriters $volume
        [void](Docker @('cp', "$($script:container):/app/data/.", $destination))
        Write-Host "Backup copied to $destination"
    } else {
        Assert-NoWriters $volume
        [void](Docker @('run', '--rm', '--network', 'none', '--user', '0', '--mount', $mount, '--entrypoint', 'node', $image, '--input-type=module', '-e', "import {readdir,rm} from 'node:fs/promises'; for (const name of await readdir('/app/data')) await rm('/app/data/'+name,{recursive:true,force:true});"))
        Assert-NoWriters $volume
        [void](Docker @('cp', "$destination/.", "$($script:container):/app/data"))
        Assert-NoWriters $volume
        [void](Docker @('run', '--rm', '--network', 'none', '--user', '0', '--mount', $mount, '--entrypoint', 'chown', $image, '-R', '1000:1000', '/app/data'))
        Write-Host "Restore copied from $destination"
    }
    }
} catch {
    [Console]::Error.WriteLine('Database maintenance failed: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($script:container) { & docker.exe rm $script:container | Out-Null }
}
