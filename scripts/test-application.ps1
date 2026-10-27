# Dependency-free Windows PowerShell 5.1 tests. No real Docker/Desktop commands.
# Native fixtures use the installed .NET compiler, with redirected console handles.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\application.ps1"
$root = Split-Path -Parent $PSScriptRoot
$script:passed = 0

function Assert($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Test([string]$Name, [scriptblock]$Body) {
    & $Body
    $script:passed++
    Write-Host "PASS $Name"
}

function New-FakeRuntime {
    param([object[]]$Probes = @('linux'), [int]$ComposeCode = 0, [string]$LaunchError = '')
    $state = @{ Events = @(); Time = 0; Index = 0; Probes = $Probes; ComposeCode = $ComposeCode; LaunchError = $LaunchError; VersionCode = 0 }
    $runtime = @{
        Probe = {
            param($Arguments, $Timeout)
            $state.Events += 'probe:' + ($Arguments -join ' ')
            Assert ($Timeout -gt 0 -and $Timeout -le 10000) 'Probe timeout must be bounded.'
            if ($Arguments[0] -eq 'compose') {
                if ($Arguments[1] -eq 'version') { return [pscustomobject]@{ Code = $state.VersionCode; StdOut = 'Compose mock'; StdErr = '' } }
                return [pscustomobject]@{ Code = 0; StdOut = '127.0.0.1:43123'; StdErr = '' }
            }
            $index = [Math]::Min($state.Index, $state.Probes.Count - 1)
            $value = $state.Probes[$index]
            $state.Index++
            if ($value -eq 'hung') { $state.Time += $Timeout }
            if ($value -in @('offline', 'hung')) { return [pscustomobject]@{ Code = 1; StdOut = ''; StdErr = $value } }
            [pscustomobject]@{ Code = 0; StdOut = $value; StdErr = '' }
        }.GetNewClosure()
        Compose = { param($Arguments) $state.Events += 'compose:' + ($Arguments -join ' '); return $state.ComposeCode }.GetNewClosure()
        Launch = { $state.Events += 'launch'; if ($state.LaunchError) { throw $state.LaunchError } }.GetNewClosure()
        Now = { $state.Time }.GetNewClosure()
        Sleep = { param($Milliseconds) $state.Time += $Milliseconds }.GetNewClosure()
    }
    @{ Runtime = $runtime; State = $state }
}

function Assert-Fails([scriptblock]$Body, [string]$Pattern) {
    $message = ''
    try { & $Body | Out-Null } catch { $message = $_.Exception.Message }
    Assert ($message -match $Pattern) "Expected failure matching '$Pattern', got '$message'."
}

foreach ($warningStage in @('engine', 'binding')) {
Test "real $warningStage probe warning does not corrupt lifecycle parsing" {
    $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $engine = Invoke-DockerProbe $powershell @('-NoProfile', '-NonInteractive', '-Command', '[Console]::Write("linux"); [Console]::Error.Write("engine-warning")') 10000 $root
    $binding = Invoke-DockerProbe $powershell @('-NoProfile', '-NonInteractive', '-Command', '[Console]::Write("127.0.0.1:43123"); [Console]::Error.Write("binding-warning")') 10000 $root
    $fake = New-FakeRuntime
    $fallback = $fake.Runtime.Probe
    $fake.Runtime.Probe = {
        param($Arguments, $Timeout)
        if ($warningStage -eq 'engine' -and $Arguments[0] -eq 'info') { return $engine }
        if ($warningStage -eq 'binding' -and $Arguments[1] -eq 'port') { return $binding }
        & $fallback $Arguments $Timeout
    }.GetNewClosure()
    $messages = @(); $warnings = @()
    Assert ((Invoke-ApplicationLifecycle Start $fake.Runtime -InformationVariable messages -WarningVariable warnings) -eq 0) 'Warnings must not fail startup.'
    Assert (($messages -join "`n") -match 'http://127.0.0.1:43123') 'Parse only binding stdout.'
    Assert (($warnings -join "`n") -match "$warningStage-warning") 'Keep stderr warnings visible.'
}
}

Test 'ready engine: no Desktop launch, bounded health wait, actual alternate-port URL' {
    $fake = New-FakeRuntime
    $messages = @()
    $code = Invoke-ApplicationLifecycle Start $fake.Runtime 3 47 -InformationVariable messages
    Assert ($code -eq 0) 'Start must succeed.'
    Assert ($fake.State.Events -notcontains 'launch') 'Ready engine must not launch Desktop.'
    Assert ($fake.State.Events -contains 'compose:up --build -d --wait --wait-timeout 47') 'Expected bounded Compose health wait.'
    Assert (($messages -join "`n") -match 'http://127.0.0.1:43123') 'Must print actual Compose binding.'
}

Test 'nonzero real probes retain stderr diagnostics for version, engine timeout and binding failures' {
    $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $failure = Invoke-DockerProbe $powershell @('-NoProfile', '-NonInteractive', '-Command', '[Console]::Write("partial-output"); [Console]::Error.Write("diagnostic-marker"); exit 9') 10000 $root
    Assert ($failure.Code -eq 9 -and $failure.StdOut -eq 'partial-output' -and $failure.StdErr -eq 'diagnostic-marker') 'Separate streams and exit code must survive.'
    foreach ($stage in @('version', 'info', 'port')) {
        $fake = New-FakeRuntime
        $fallback = $fake.Runtime.Probe
        $fake.Runtime.Probe = {
            param($Arguments, $Timeout)
            if ($Arguments[0] -eq $stage -or $Arguments[1] -eq $stage) { return $failure }
            & $fallback $Arguments $Timeout
        }.GetNewClosure()
        Assert-Fails { Invoke-ApplicationLifecycle Start $fake.Runtime 1 -WarningAction SilentlyContinue } 'diagnostic-marker'
    }
}

Test 'cross-process workspace guard rejects overlapping Start/Stop, permits logs, and releases on completion/termination' {
    $fixture = Join-Path $root ('artifacts\lifecycle-lock-' + [guid]::NewGuid())
    [void][IO.Directory]::CreateDirectory($fixture)
    $name = 'Local\BacklogLifecycleTest-' + [guid]::NewGuid()
    $ready = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, ($name + '-ready'))
    $release = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, ($name + '-release'))
    $child = $null
    try {
        $runner = Join-Path $fixture 'pending start.ps1'
        [IO.File]::WriteAllText($runner, @'
param($Helper, $Workspace, $Name)
$ErrorActionPreference = 'Stop'
. $Helper
$ready = [Threading.EventWaitHandle]::OpenExisting($Name + '-ready')
$release = [Threading.EventWaitHandle]::OpenExisting($Name + '-release')
$runtime = @{
    Probe = {
        param($Arguments, $Timeout)
        $value = if ($Arguments[0] -eq 'info') { 'linux' } elseif ($Arguments[1] -eq 'port') { '127.0.0.1:43123' } else { 'mock Compose' }
        [pscustomobject]@{Code=0; StdOut=$value; StdErr=''}
    }
    Compose = { [void]$ready.Set(); if (-not $release.WaitOne(30000)) { throw 'Test release timed out' }; return 0 }
    Launch = { throw 'Must not launch Desktop' }
    Now = { 0 }
    Sleep = { throw 'Must not sleep' }
}
try { exit (Invoke-GuardedApplicationLifecycle $Workspace Start $runtime) }
catch { [Console]::Error.WriteLine($_); exit 1 }
'@)
        $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $childArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" "{1}" "{2}" "{3}"' -f $runner, "$PSScriptRoot\application.ps1", $fixture, $name
        foreach ($mode in @('complete', 'terminate')) {
            [void]$ready.Reset(); [void]$release.Reset()
            $child = Start-Process -FilePath $powershell -ArgumentList $childArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput "$fixture\stdout.log" -RedirectStandardError "$fixture\stderr.log"
            # Retain a process handle before exit (PS 5.1 Start-Process can otherwise
            # lose the native exit code after its asynchronous exit notification).
            $null = $child.Handle
            Assert ($ready.WaitOne(10000)) 'Child Start must reach pending fake Compose.'
            $watch = [Diagnostics.Stopwatch]::StartNew()
            foreach ($operation in @('Start', 'Stop')) {
                $fake = New-FakeRuntime
                Assert-Fails { Invoke-GuardedApplicationLifecycle ($fixture.ToUpperInvariant() + '\') $operation $fake.Runtime } 'Another lifecycle operation is in progress.*Retry.*terminate'
                Assert ($fake.State.Events.Count -eq 0) 'Rejected overlap must perform no Docker operations.'
            }
            Assert ($watch.Elapsed.TotalSeconds -lt 5) 'Overlap must fail fast, not wait for Start.'
            $fake = New-FakeRuntime
            Assert ((Invoke-GuardedApplicationLifecycle $fixture Logs $fake.Runtime) -eq 0) 'Logs must bypass lifecycle lock.'
            $fake = New-FakeRuntime
            Assert ((Invoke-GuardedApplicationLifecycle (Join-Path $fixture 'other-workspace') Stop $fake.Runtime) -eq 0) 'Independent workspace must not be blocked.'
            if ($mode -eq 'complete') { [void]$release.Set() } else { $child.Kill() }
            Assert ($child.WaitForExit(10000)) 'Child must exit within bound.'
            if ($mode -eq 'complete') { Assert ($child.ExitCode -eq 0) "Child start failed: $(Get-Content -LiteralPath "$fixture\stderr.log" -Raw)" }
            $child.Dispose(); $child = $null
            $fake = New-FakeRuntime
            Assert ((Invoke-GuardedApplicationLifecycle $fixture Stop $fake.Runtime) -eq 0) 'Guard must be available after completion/termination.'
        }
        $fake = New-FakeRuntime
        $fake.Runtime.Compose = { throw 'mock lifecycle failure' }
        Assert-Fails { Invoke-GuardedApplicationLifecycle $fixture Stop $fake.Runtime } 'mock lifecycle failure'
        $fake = New-FakeRuntime
        Assert ((Invoke-GuardedApplicationLifecycle $fixture Stop $fake.Runtime) -eq 0) 'Exceptions must release the guard.'
    }
    finally {
        if ($child) { if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(5000) }; $child.Dispose() }
        $ready.Dispose(); $release.Dispose()
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}

Test 'delayed readiness: launch exactly once, Compose only after Linux probe' {
    $fake = New-FakeRuntime @('offline', 'offline', 'linux')
    Assert ((Invoke-ApplicationLifecycle Start $fake.Runtime 10) -eq 0) 'Delayed start must succeed.'
    Assert (@($fake.State.Events | Where-Object { $_ -eq 'launch' }).Count -eq 1) 'Launch exactly once.'
    $expected = @('probe:compose version', 'probe:info --format {{.OSType}}', 'launch', 'probe:info --format {{.OSType}}', 'probe:info --format {{.OSType}}', 'compose:up --build -d --wait --wait-timeout 120', 'probe:compose port app 3001')
    Assert (($fake.State.Events -join '|') -eq ($expected -join '|')) 'No Compose before readiness.'
}

Test 'missing Desktop: actionable error, no Compose' {
    $fake = New-FakeRuntime @('offline') 0 'Docker Desktop was not found. Install Docker Desktop.'
    Assert-Fails { Invoke-ApplicationLifecycle Start $fake.Runtime } 'Desktop was not found'
    Assert (-not ($fake.State.Events -like 'compose:*')) 'No Compose after launch failure.'
}

Test 'wrong Windows engine: fail without Desktop launch or Compose' {
    $fake = New-FakeRuntime @('windows')
    Assert-Fails { Invoke-ApplicationLifecycle Start $fake.Runtime } 'requires Linux containers'
    Assert (-not ($fake.State.Events -like 'compose:*')) 'No Compose for Windows engine.'
    Assert ($fake.State.Events -notcontains 'launch') 'Do not relaunch or switch a responding engine.'
}

Test 'hung engine probes respect total deadline and never start Compose' {
    $fake = New-FakeRuntime @('hung')
    Assert-Fails { Invoke-ApplicationLifecycle Start $fake.Runtime 3 } 'Timed out after 3 seconds'
    Assert ($fake.State.Time -eq 3000) 'Probe must use remaining deadline.'
    Assert (-not ($fake.State.Events -like 'compose:*')) 'No Compose after timeout.'
}

Test 'polling deadline is bounded when Docker stays offline' {
    $fake = New-FakeRuntime @('offline')
    Assert-Fails { Invoke-ApplicationLifecycle Start $fake.Runtime 3 } 'Timed out after 3 seconds'
    Assert ($fake.State.Time -eq 3000) 'Sleep must not overshoot deadline.'
    Assert (@($fake.State.Events | Where-Object { $_ -eq 'launch' }).Count -eq 1) 'Launch only once on timeout.'
}

Test 'Compose startup failure propagates exact exit code' {
    $fake = New-FakeRuntime @('linux') 17
    Assert ((Invoke-ApplicationLifecycle Start $fake.Runtime) -eq 17) 'Preserve Compose failure code.'
    Assert ($fake.State.Events -notcontains 'probe:compose port app 3001') 'No success URL after failed startup.'
}

Test 'missing Compose fails before engine probe/Desktop/Compose' {
    $fake = New-FakeRuntime
    $fake.State.VersionCode = 1
    Assert-Fails { Invoke-ApplicationLifecycle Start $fake.Runtime } 'Compose is unavailable'
    Assert ($fake.State.Events.Count -eq 1) 'Fail before any engine action.'
}

Test 'stop uses only compose stop: preserves volumes and does not launch Desktop' {
    $fake = New-FakeRuntime @('offline')
    Assert ((Invoke-ApplicationLifecycle Stop $fake.Runtime) -eq 0) 'Stop succeeds.'
    Assert (($fake.State.Events -join '|') -eq 'probe:compose version|compose:stop') 'Only stop this project, no info/start/down/volume commands.'
}

Test 'stop failure propagates without launch; logs only follows project logs' {
    $fake = New-FakeRuntime @('offline') 23
    Assert ((Invoke-ApplicationLifecycle Stop $fake.Runtime) -eq 23) 'Preserve stop failure.'
    $fake = New-FakeRuntime
    Assert ((Invoke-ApplicationLifecycle Logs $fake.Runtime) -eq 0) 'Logs succeeds.'
    Assert (($fake.State.Events -join '|') -eq 'probe:compose version|compose:logs --follow --tail 100') 'Logs must not start engine or app.'
}

# Exercise production discovery in a local function scope, without altering PATH
# or exposing user-supplied executable overrides in the production CLI.
Test 'missing docker executable: actionable discovery failure' {
    function Get-Command { return $null }
    Assert-Fails { New-ApplicationRuntime $root } 'Docker CLI was not found'
}

Test 'Desktop discovery: missing install and standard installed location' {
    function Test-Path { return $false }
    Assert-Fails { Find-DockerDesktop } 'Docker Desktop was not found'
    function Test-Path { param($LiteralPath, $PathType) return $LiteralPath -eq "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" }
    Assert ((Find-DockerDesktop) -eq "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe") 'Discover Program Files install.'
}

Test 'production runtime closures resolve probe and Desktop discovery outside factory scope' {
    function Get-Command { [pscustomobject]@{ Source = 'mock-docker.exe' } }
    function Invoke-DockerProbe {
        param($Docker, $Arguments, $TimeoutMilliseconds, $Directory)
        Assert ($Docker -eq 'mock-docker.exe' -and $Directory -eq $root) 'Captured executable/cwd must survive factory scope.'
        [pscustomobject]@{ Code = 0; StdOut = $Arguments -join ' '; StdErr = '' }
    }
    function Find-DockerDesktop { throw 'mock Desktop discovery reached' }
    $runtime = New-ApplicationRuntime $root
    Assert ((& $runtime.Probe @('compose', 'version') 1000).StdOut -eq 'compose version') 'Runtime must resolve captured probe.'
    Assert-Fails { & $runtime.Launch } 'mock Desktop discovery reached'
}

Test 'production Compose invocation preserves the single stop argument' {
    $stub = Join-Path $root ('artifacts\compose-argv-' + [guid]::NewGuid() + '.ps1')
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $stub))
    [IO.File]::WriteAllText($stub, 'Write-Output ($args -join "|"); $global:LASTEXITCODE = 0')
    try {
        function Get-Command { [pscustomobject]@{ Source = $stub } }
        function Invoke-DockerProbe { [pscustomobject]@{ Code = 0; StdOut = 'mock Compose version'; StdErr = '' } }
        $runtime = New-ApplicationRuntime $root
        $messages = @()
        Assert ((Invoke-ApplicationLifecycle Stop $runtime -InformationVariable messages) -eq 0) 'Production stop succeeds.'
        Assert (($messages -join "`n") -match 'compose\|--ansi\|never\|--progress\|plain\|stop') 'Invocation must receive plain non-ANSI Compose options and the single stop argument.'
    }
    finally { Remove-Item -LiteralPath $stub -Force }
}

Test 'real native Compose under detached task argv streams stdout, tolerates stderr warnings and preserves exit codes' {
    $fixture = Join-Path $root ('artifacts\native-console-' + [guid]::NewGuid())
    [void][IO.Directory]::CreateDirectory($fixture)
    $child = $null
    $release = $null
    try {
        # A real console executable, not a mocked Runtime.Compose or PS script:
        # enforce non-console handles, exercise native stderr and native argv.
        $source = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class NativeComposeFixture {
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint mode);
    public static int Main(string[] args) {
        uint mode;
        if (GetConsoleMode(GetStdHandle(-11), out mode)) return 91;
        if (GetConsoleMode(GetStdHandle(-12), out mode)) return 91;
        if (GetConsoleMode(GetStdHandle(-10), out mode)) return 91;
        if (args.Length == 2 && args[0] == "compose" && args[1] == "version") { Console.WriteLine("Compose fixture"); return 0; }
        if (args.Length > 0 && args[0] == "info") { Console.WriteLine("linux"); return 0; }
        if (args.Length > 1 && args[0] == "compose" && args[1] == "port") { Console.WriteLine("127.0.0.1:43123"); return 0; }
        string argv = String.Join("|", args);
        // Same non-TTY failure shape as Compose; the real Docker reproduction
        // is recorded separately in artifacts/tooling/console-regression/.
        if (!argv.StartsWith("compose|--ansi|never|--progress|plain|")) {
            Console.Error.WriteLine("failed to get console: The handle is invalid."); return 1;
        }
        Console.WriteLine("argv=" + argv);
        Console.Error.WriteLine("warning-marker");
        Console.WriteLine("stdout-before-exit");
        Console.Out.Flush(); Console.Error.Flush();
        using (var release = EventWaitHandle.OpenExisting(Environment.GetEnvironmentVariable("BACKLOG_TEST_RELEASE"))) {
            if (!release.WaitOne(10000)) return 92;
        }
        Console.WriteLine("stdout-after-release");
        return Int32.Parse(Environment.GetEnvironmentVariable("BACKLOG_TEST_EXIT"));
    }
}
'@
        Add-Type -TypeDefinition $source -OutputAssembly "$fixture\docker.exe" -OutputType ConsoleApplication
        $tasks = Get-Content -LiteralPath "$root\.vscode\tasks.json" -Raw | ConvertFrom-Json
        foreach ($case in @(
            @{ Action='Start'; Code=0; Argv='up|--build|-d|--wait|--wait-timeout|120' },
            @{ Action='Start'; Code=17; Argv='up|--build|-d|--wait|--wait-timeout|120' },
            @{ Action='Stop'; Code=0; Argv='stop' },
            @{ Action='Stop'; Code=23; Argv='stop' },
            @{ Action='Logs'; Code=0; Argv='logs|--follow|--tail|100' }
        )) {
            $name = 'Local\BacklogNativeOutput-' + [guid]::NewGuid()
            $release = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, $name)
            $task = $tasks.tasks | Where-Object { $_.args[8] -eq $case.Action }
            $argv = @($task.args | ForEach-Object { $_.Replace('${workspaceFolder}', $root) })
            $info = New-Object Diagnostics.ProcessStartInfo
            $info.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
            $info.Arguments = ($argv | ForEach-Object { '"' + $_ + '"' }) -join ' '
            $info.WorkingDirectory = $root
            $info.UseShellExecute = $false
            $info.CreateNoWindow = $true
            $info.RedirectStandardInput = $true
            $info.RedirectStandardOutput = $true
            $info.RedirectStandardError = $true
            $info.EnvironmentVariables['PATH'] = $fixture + ';' + $env:PATH
            $info.EnvironmentVariables['BACKLOG_TEST_RELEASE'] = $name
            $info.EnvironmentVariables['BACKLOG_TEST_EXIT'] = [string]$case.Code
            $info.EnvironmentVariables['COMPOSE_PROGRESS'] = 'tty'
            $child = New-Object Diagnostics.Process
            $child.StartInfo = $info
            [void]$child.Start()
            $child.StandardInput.Close()
            $stderr = $child.StandardError.ReadToEndAsync()
            $lines = @()
            do {
                $line = $child.StandardOutput.ReadLineAsync()
                Assert ($line.Wait(15000)) "Output must stream before native exit, not wait for completion. Lines: $($lines -join '|'); stderr completed=$($stderr.IsCompleted)"
                if ($null -eq $line.Result) { throw "Child exited before streaming marker. Lines: $($lines -join '|'); stderr=$($stderr.Result)" }
                $lines += $line.Result
            } until ($line.Result -eq 'stdout-before-exit')
            Assert (-not $child.HasExited) 'Marker must arrive while native command is waiting.'
            [void]$release.Set()
            $stdout = $child.StandardOutput.ReadToEndAsync()
            Assert ($child.WaitForExit(10000)) 'Task process must exit within bound.'
            Assert ([Threading.Tasks.Task]::WaitAll(@($stdout, $stderr), 1000)) 'Output drain must complete.'
            Assert ($child.ExitCode -eq $case.Code) "Native $($case.Action) exit code must survive top-level task. Got $($child.ExitCode): $($stderr.Result)"
            Assert ($stderr.Result.Trim() -ceq 'warning-marker') 'Native stderr warning must remain visible verbatim, without NativeCommandError/termination.'
            Assert ($lines -ccontains ('argv=compose|--ansi|never|--progress|plain|' + $case.Argv)) 'Native argument boundaries/order must survive exact VS Code task argv.'
            Assert ($stdout.Result -match 'stdout-after-release') 'Keep final stdout after process exit.'
            if ($case.Action -eq 'Start') {
                Assert (($stdout.Result -match 'Application ready: http://127.0.0.1:43123') -eq ($case.Code -eq 0)) 'Only successful Start prints its URL.'
            }
            $child.Dispose(); $child = $null
            $release.Dispose(); $release = $null
        }
    }
    finally {
        if ($child) { if (-not $child.HasExited) { $child.Kill(); [void]$child.WaitForExit(5000) }; $child.Dispose() }
        if ($release) { $release.Dispose() }
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}

Test 'PowerShell syntax and JSON tasks map process args/cwd/actions without shell interpolation' {
    foreach ($file in @('application.ps1', 'test-application.ps1')) {
        $errors = $null; $tokens = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile("$PSScriptRoot\$file", [ref]$tokens, [ref]$errors)
        Assert ($errors.Count -eq 0) "Syntax errors in $file : $errors"
    }
    $tasks = Get-Content -LiteralPath "$root\.vscode\tasks.json" -Raw | ConvertFrom-Json
    Assert ($tasks.version -eq '2.0.0' -and $tasks.tasks.Count -eq 3) 'Expected three VS Code tasks.'
    $labels = @{ Start = 'Start application'; Stop = 'Stop application'; Logs = 'View application logs' }
    foreach ($task in $tasks.tasks) {
        Assert ($task.type -eq 'process') 'Must not use default shell.'
        Assert ($task.command -eq '${env:SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe') 'Explicit Windows PowerShell executable.'
        Assert ($task.options.cwd -eq '${workspaceFolder}') 'Explicit workspace cwd.'
        Assert ($task.runOptions.instanceLimit -eq 1) 'Prevent duplicate instances.'
        Assert ($task.args[5] -eq '-File' -and $task.args[6] -eq '${workspaceFolder}\scripts\application.ps1') 'Script path must be a distinct argument.'
        Assert ($task.args[7] -eq '-Action' -and $labels[$task.args[8]] -eq $task.label) 'Task must map to expected lifecycle action.'
    }
}

Test 'real child process: bounded hang, argument quoting and literal workspace paths with PS syntax' {
    $fixture = Join-Path $root ("artifacts\task checks [literal] `$value & ' ; " + [guid]::NewGuid())
    [void][IO.Directory]::CreateDirectory($fixture)
    try {
        $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        # Use a file for argv roundtrip, avoiding the special -Command parser.
        $echoScript = Join-Path $fixture 'argv check.ps1'
        [IO.File]::WriteAllText($echoScript, '[Console]::Write($args[0]); [Console]::Error.Write("stderr-marker")')
        $args = @('-NoProfile', '-NonInteractive', '-File', $echoScript, 'space "quote" trailing\')
        $probe = Invoke-DockerProbe $powershell $args 10000 $fixture
        Assert ($probe.Code -eq 0 -and $probe.StdOut -eq 'space "quote" trailing\' -and $probe.StdErr -eq 'stderr-marker') "Argument/stream roundtrip failed: $($probe.StdOut) $($probe.StdErr)"
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $probe = Invoke-DockerProbe $powershell @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') 200 $fixture
        Assert ($probe.Code -eq 124 -and $watch.Elapsed.TotalSeconds -lt 5) 'Real hanging child must be killed within bound.'
        # Execute the very same task argv against a copied helper with unavailable
        # Docker discovery. This validates -File paths and nonzero top-level exit.
        $scripts = Join-Path $fixture 'scripts'
        [void][IO.Directory]::CreateDirectory($scripts)
        Copy-Item -LiteralPath "$PSScriptRoot\application.ps1" -Destination $scripts
        $runner = Join-Path $fixture 'discovery test.ps1'
        [IO.File]::WriteAllText($runner, 'function Get-Command { return $null }; & (Join-Path $PSScriptRoot "scripts\application.ps1") -Action Start; exit $LASTEXITCODE')
        $probe = Invoke-DockerProbe $powershell @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $runner) 10000 $fixture
        Assert ($probe.Code -eq 1 -and $probe.StdErr -match 'Docker CLI was not found') "Top-level exit/path test failed: $($probe.StdOut) $($probe.StdErr)"
    }
    finally { Remove-Item -LiteralPath $fixture -Recurse -Force }
}

Write-Host "All $script:passed tooling tests passed (mocked Docker/Desktop; real native and PowerShell child-process checks)."
