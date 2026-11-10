#!/usr/bin/perl
# Run the actual shell launcher against executable fixtures, never real Docker.
use strict;
use warnings;
use Test::More;
use JSON::PP qw(encode_json decode_json);
use File::Temp qw(tempdir);
use File::Path qw(make_path);
use File::Copy qw(copy);
use FindBin;
use Cwd qw(realpath);
use POSIX qw(WNOHANG);
use Time::HiRes qw(time sleep);

my $source = realpath("$FindBin::Bin/..");
my $approved = '/var/folders/pl/7wq0x62910n1p9mnw2wlsbzw0000gn/T/opencode';
my $evidence = tempdir('application-fixtures-XXXXXX', DIR => -d $approved ? $approved : '/tmp', CLEANUP => 0);
my $workspace = "$evidence/workspace with spaces ' quoted";
make_path("$workspace/scripts", "$evidence/bin");
$workspace = realpath($workspace);
copy("$source/scripts/$_", "$workspace/scripts/$_") or die $! for qw(application.sh application-runtime.pl);
sub write_file { my ($path, $text) = @_; open my $fh, '>', $path or die "$path: $!"; print {$fh} $text; close $fh }
sub read_file { open my $fh, '<', $_[0] or return ''; local $/; return <$fh> }
write_file("$workspace/compose.dev.yaml", read_file("$source/compose.dev.yaml"));
my $fake = <<'FAKE';
#!/usr/bin/perl
use strict; use warnings; use JSON::PP; use Fcntl qw(:flock); use Cwd qw(getcwd); use Time::HiRes qw(sleep);
my $tool = $0; $tool =~ s{.*/}{};
open my $log, '>>', "$ENV{FIXTURE}/commands.jsonl" or die $!;
flock($log, LOCK_EX);
print {$log} encode_json({tool=>$tool, args=>\@ARGV, cwd=>getcwd(), pid=>$$,
 env=>{map {$_=> $ENV{$_}} qw(COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROGRESS BACKLOG_DEV_HOST_PORT BACKLOG_DEV_VOLUME DOCKER_CONTEXT)}}), "\n";
close $log;
open my $sf, '<', "$ENV{FIXTURE}/settings.json" or die $!; local $/; my $s = decode_json(<$sf>); close $sf;
if ($tool eq 'uname') { print($s->{os} // 'Darwin', "\n"); exit 0 }
if ($tool eq 'open') { sleep 20 if $s->{open_hung}; exit($s->{open_code} // 0) }
my $args = join ' ', @ARGV;
if ($args eq 'compose version') { sleep 20 if $s->{version_hung}; exit($s->{version_code} // 0) }
if ($ARGV[0] eq 'info') {
 if ($s->{held_pipe}) { my $pid=fork(); if (!$pid) { sleep 20; exit 0 } exit 1 }
 sleep 20 if $s->{hung};
 if ($s->{delayed}) {
  my $count = "$ENV{FIXTURE}/probes";
  if (!-e $count) { open my $f, '>', $count; close $f; exit 1 }
 }
 if ($s->{missing}) { print STDERR "fixture daemon unavailable\n"; exit 1 }
 print($s->{engine} // 'linux', "\n"); exit 0;
}
if ($args eq 'compose config --format json') {
 exit($s->{config_code}) if $s->{config_code};
 print($s->{invalid_json} ? '{broken' : $s->{config}); exit 0;
}
if ($args =~ /\bstop app$/) { exit($s->{app_stop_code} // 0) }
if ($args =~ /\bstop dev$/) { exit($s->{dev_stop_code} // 0) }
if ($args =~ /\bup --build -d --wait --wait-timeout \d+ dev$/) { sleep 2 if $s->{slow_up}; exit($s->{up_code} // 0) }
if ($args =~ /\bport dev 5173$/) { print($s->{binding} // '127.0.0.1:5273', "\n"); exit($s->{port_code} // 0) }
if ($args =~ /\blogs --follow --tail 100 dev$/) { print "fixture log line\n"; exit($s->{logs_code} // 0) }
if ($args =~ /^volume create /) { exit($s->{create_code} // 0) }
if ($args =~ /^volume inspect /) { exit($s->{inspect_code} // 0) }
die "Unexpected fixture command: $args\n";
FAKE
for (qw(docker open uname)) { write_file("$evidence/bin/$_", $fake); chmod 0755, "$evidence/bin/$_" }
# A restricted PATH proves local Node/npm/mise/PowerShell cannot be involved.
for (qw(perl dirname)) { symlink("/usr/bin/$_", "$evidence/bin/$_") or die $! }
local $ENV{PATH} = "$evidence/bin";
local $ENV{FIXTURE};
local $ENV{COMPOSE_PROJECT_NAME} = 'environment-project';
local $ENV{COMPOSE_FILE} = 'custom compose.yaml:override.yaml';
local $ENV{COMPOSE_ENV_FILES} = '.env:alternate.env';
local $ENV{COMPOSE_PROGRESS} = 'tty';
local $ENV{BACKLOG_DEV_HOST_PORT} = '5273';
local $ENV{BACKLOG_DEV_VOLUME} = 'incorrect-inherited-volume';
local $ENV{DOCKER_CONTEXT} = 'selected-fixture-context';

sub config {
 return {name=>'resolved-project', volumes=>{'backlog-data'=>{name=>'actual.production-data'}}, services=>{app=>{
 environment=>{BACKLOG_DB_PATH=>'/app/data/backlog.sqlite'},
 volumes=>[{type=>'volume', source=>'backlog-data', target=>'/app/data'}]}}};
}
my $number = 0;
sub prepare {
 my ($settings) = @_;
 my $directory = "$evidence/" . ++$number;
 make_path($directory);
 $settings->{config} //= encode_json(config());
 write_file("$directory/settings.json", encode_json($settings));
 return $directory;
}
sub launch {
 my ($directory, $action, $docker, $health) = @_;
 my $pid = fork(); defined $pid or die $!;
 if (!$pid) {
  $ENV{FIXTURE} = $directory;
  open STDOUT, '>', "$directory/stdout.log" or die $!;
  open STDERR, '>', "$directory/stderr.log" or die $!;
  exec '/bin/sh', "$workspace/scripts/application.sh", $action // 'Start', $docker // 1, $health // 7;
  die $!;
 }
 return $pid;
}
sub finish {
 my ($pid) = @_;
 my $deadline = time + 18;
 while (waitpid($pid, WNOHANG) == 0) {
  if (time > $deadline) { kill 'KILL', $pid; waitpid($pid, 0); die 'Fixture launcher exceeded watchdog' }
  sleep 0.02;
 }
 return $? & 127 ? 128 + ($? & 127) : $? >> 8;
}
sub commands {
 return [map {decode_json($_)} split /\n/, read_file("$_[0]/commands.jsonl")];
}
sub execute {
 my ($settings, $action, $timeout) = @_;
 my $directory = prepare($settings);
 my $start = time;
 my $code = finish(launch($directory, $action, $timeout));
 return ($code, read_file("$directory/stdout.log") . read_file("$directory/stderr.log"), commands($directory), time - $start, $directory);
}
sub args { return join ' ', @{$_[0]{args}} }
my ($code, $output, $commands) = execute({});
is($code, 0, 'ready engine starts');
like($output, qr{Application ready: http://127\.0\.0\.1:5273}, 'actual alternate loopback URL');
is_deeply([map {args($_)} @$commands], [
 '-s', 'compose version', 'info --format {{.OSType}}', 'compose config --format json',
 'compose --ansi never --progress plain stop app',
 'volume create --label com.docker.compose.project=resolved-project --label com.docker.compose.volume=backlog-data actual.production-data',
 "compose --ansi never --progress plain --project-directory $workspace -p resolved-project -f $workspace/compose.dev.yaml up --build -d --wait --wait-timeout 7 dev",
 "compose --ansi never --progress plain --project-directory $workspace -p resolved-project -f $workspace/compose.dev.yaml port dev 5173"
], 'exact ordering, resolved identity, health wait and data preservation');
for my $command (@$commands) {
 is($command->{cwd}, $workspace, 'command uses canonical workspace');
}
my $dev = $commands->[-1];
is($dev->{env}{BACKLOG_DEV_VOLUME}, 'actual.production-data', 'resolved volume replaces inherited value');
for (qw(COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROGRESS BACKLOG_DEV_HOST_PORT DOCKER_CONTEXT)) {
 is($dev->{env}{$_}, $ENV{$_}, "preserves $_");
}
($code, $output, $commands) = execute({delayed=>1}, 'Start', 4);
is($code, 0, 'delayed daemon becomes ready');
is(scalar(grep {$_->{tool} eq 'open'} @$commands), 1, 'Desktop opened once');
is_deeply((grep {$_->{tool} eq 'open'} @$commands)[0]{args}, ['-a','Docker'], 'Desktop launch argv');
for my $scenario (
 ['missing engine',{missing=>1},qr/Timed out/],
 ['hung engine',{hung=>1},qr/Timed out/],
 ['engine descendant retains pipe',{held_pipe=>1},qr/Timed out/],
 ['wrong engine',{engine=>'windows'},qr/requires Linux/],
 ['missing Compose',{version_code=>27},qr/Compose is unavailable/],
 ['hung Compose',{version_hung=>1},qr/Compose is unavailable/],
 ['missing Desktop',{missing=>1,open_code=>1},qr/Could not open Docker Desktop/],
 ['hung Desktop launch',{missing=>1,open_hung=>1},qr/Could not open Docker Desktop/],
 ['wrong host OS',{os=>'MINGW64_NT'},qr/use application.ps1/],
 ['production resolution failure',{config_code=>9},qr/Could not resolve/],
 ['invalid JSON',{invalid_json=>1},qr/Could not parse/]
) {
 my ($label,$settings,$message) = @$scenario;
 my ($c,$o,$calls,$elapsed) = execute($settings);
 isnt($c, 0, "$label fails"); like($o,$message,"$label diagnosis");
 cmp_ok($elapsed,'<', $settings->{version_hung} ? 12 : 4, "$label bounded");
 ok(!grep(/\b(?:stop|up|create)\b/, map {args($_)} @$calls), "$label has no mutations");
}
rename "$evidence/bin/docker", "$evidence/bin/docker-hidden" or die $!;
($code, $output) = execute({});
isnt($code,0,'missing Docker CLI fails'); like($output,qr/Docker CLI was not found/,'missing CLI diagnosis');
rename "$evidence/bin/docker-hidden", "$evidence/bin/docker" or die $!;
rename "$evidence/bin/perl", "$evidence/bin/perl-hidden" or die $!;
($code,$output) = execute({});
isnt($code,0,'missing Perl fails'); like($output,qr/Perl with JSON::PP is required/,'missing Perl diagnosis');
rename "$evidence/bin/perl-hidden", "$evidence/bin/perl" or die $!;

for my $mutation (
 ['database path', sub {$_[0]{environment}{BACKLOG_DB_PATH}='/elsewhere.sqlite'}],
 ['bind mount', sub {$_[0]{volumes}[0]{type}='bind'}],
 ['different source', sub {$_[0]{volumes}[0]{source}='other'}],
 ['subpath', sub {$_[0]{volumes}[0]{volume}{subpath}=''}],
 ['volumes_from', sub {$_[0]{volumes_from}=['other']}],
 ['nested sidecar mount', sub {push @{$_[0]{volumes}}, {target=>'/app/data/backlog.sqlite-wal'}}],
 ['normalized overlap', sub {push @{$_[0]{volumes}}, {target=>'/app/other/../data/./backlog.sqlite'}}],
 ['duplicate normalized mount', sub {push @{$_[0]{volumes}}, {target=>'/app/./data'}}],
 ['tmpfs overlap', sub {$_[0]{tmpfs}=['/app/data/cache:rw']}],
 ['secret overlap', sub {$_[0]{secrets}=[{target=>'/app/data/secret'}]}],
 ['config overlap', sub {$_[0]{configs}=[{target=>'/app/data/config'}]}]
) {
 my $c = config(); $mutation->[1]->($c->{services}{app});
 my ($status,$text,$calls) = execute({config=>encode_json($c)});
 isnt($status,0,"rejects $mutation->[0]"); like($text,qr/(mount|path)/,"$mutation->[0] safety error");
 ok(!grep(/\b(?:stop|up|create)\b/,map {args($_)} @$calls),"$mutation->[0] rejected before mutation");
}
for my $kind (qw(external driver driver_opts)) {
 my $c = config(); $c->{volumes}{'backlog-data'}{$kind} = $kind eq 'driver_opts' ? {device=>'/custom'} : $kind eq 'external' ? JSON::PP::true : 'custom';
 ($code,$output,$commands) = execute({config=>encode_json($c)});
 is($code,0,"$kind volume accepted");
 ok(!grep(/^volume create /,map {args($_)} @$commands),"$kind volume never recreated");
 is(scalar(grep(/^volume inspect /,map {args($_)} @$commands)), $kind eq 'external' ? 0 : 1, "$kind inspection semantics");
 if ($kind ne 'external') {
  ($code,$output,$commands) = execute({config=>encode_json($c),inspect_code=>1});
  isnt($code,0,"missing $kind volume fails");
  ok(!grep(/\bup\b/,map {args($_)} @$commands),"missing $kind volume prevents startup");
 }
}
for my $missing (qw(name app volume volume_name)) {
 my $c=config();
 delete $c->{name} if $missing eq 'name';
 delete $c->{services}{app} if $missing eq 'app';
 delete $c->{volumes}{'backlog-data'} if $missing eq 'volume';
 delete $c->{volumes}{'backlog-data'}{name} if $missing eq 'volume_name';
 ($code,$output,$commands)=execute({config=>encode_json($c)});
 isnt($code,0,"missing $missing fails");
 ok(!grep(/\b(?:stop|up|create)\b/,map {args($_)} @$commands),"missing $missing prevents mutations");
}
my $benign=config();
push @{$benign->{services}{app}{volumes}}, {target=>'/app/data-other'}, {target=>'/app/data/../elsewhere'};
($code)=execute({config=>encode_json($benign)});
is($code,0,'non-overlapping and normalized-away mounts accepted');
for my $failure (qw(app_stop_code create_code up_code port_code)) {
 ($code,$output,$commands) = execute({$failure=>23});
 is($code,$failure eq 'app_stop_code' || $failure eq 'up_code' ? 23 : 1,"$failure propagated");
 ok(!grep(/\bup\b/,map {args($_)} @$commands),"$failure prevents up") if $failure eq 'app_stop_code' || $failure eq 'create_code';
}
for ('0.0.0.0:5273','[::]:5273',"127.0.0.1:5273\n0.0.0.0:5273") {
 ($code,$output) = execute({binding=>$_}); isnt($code,0,"rejects non-exclusive loopback binding $_");
}
for my $action (qw(Stop Logs Restart)) {
 ($code,$output,$commands) = execute({},$action);
 is($code,0,"$action succeeds");
 my @calls = map {args($_)} @$commands;
 like(join("\n",@calls),$action eq 'Logs' ? qr/logs --follow --tail 100 dev/ : qr/stop dev/,"$action command semantics");
 ok(!(grep {$_->{tool} eq 'open'} @$commands),"$action does not open Desktop with ready daemon");
 if ($action eq 'Restart') {
  my $joined = join "\n", @calls;
  like($joined,qr/stop dev.*stop app.*up --build/s,'Restart stops dev before production/start');
 }
}
for my $action (qw(Stop Logs Restart)) {
 ($code,$output,$commands) = execute({config_code=>19,missing=>1},$action);
 isnt($code,0,"$action unavailable daemon fails");
 ok(!(grep {$_->{tool} eq 'open'} @$commands),"$action failure does not launch Desktop");
 ok(!grep(/\bup\b/,map {args($_)} @$commands),"$action failure prevents start");
}
for my $action (qw(Stop Logs Restart)) {
 ($code,$output,$commands) = execute({dev_stop_code=>29,logs_code=>29},$action);
 is($code,29,"$action Compose failure exit preserved");
}
($code,$output,$commands) = execute({os=>'Linux',delayed=>1},'Start',4);
is($code,0,'Linux waits for manually started daemon');
like($output,qr/Start your Linux Docker daemon manually/,'Linux manual daemon instruction');
ok(!(grep {$_->{tool} eq 'open'} @$commands),'Linux never opens Desktop');
($code,$output) = execute({},'Start',0); isnt($code,0,'invalid timeout rejected');
($code,$output) = execute({},'Invalid'); isnt($code,0,'invalid action rejected');

# Concurrent lifecycle exclusion, Logs availability, and release after TERM/KILL.
for my $signal (qw(TERM KILL)) {
 my $directory = prepare({slow_up=>1});
 my $pid = launch($directory,'Start');
 my $deadline = time + 5;
 my $up;
 until ($up) {
  ($up) = grep {args($_) =~ /\bup\b/} @{commands($directory)};
  die 'Slow fixture never entered up' if time > $deadline;
  sleep 0.02 unless $up;
 }
 ($code,$output) = execute({},'Stop');
 isnt($code,0,"$signal concurrent lifecycle rejected");
 like($output,qr/Another lifecycle operation/,'workspace lock diagnosis');
 ($code,$output) = execute({},'Logs'); is($code,0,'Logs available while locked');
 kill $signal, $pid; finish($pid);
 ($code,$output) = execute({},'Stop'); is($code,0,"lock released after $signal with child still possible");
 # Only the recorded fixture child is cleaned up, never a real Docker process.
 kill 'KILL', $up->{pid};
}

my $tasks = decode_json(read_file("$source/.vscode/tasks.json"));
is(scalar(@{$tasks->{tasks}}),4,'four lifecycle tasks');
my @actions = qw(Start Stop Restart Logs);
my @labels = ('Start application','Stop application','Restart application','View application logs');
for my $task (@{$tasks->{tasks}}) {
 my $action = shift @actions;
 is($task->{label},shift @labels,'task label retained');
 is($task->{type},'process','process task independent of terminal quoting');
 is($task->{windows}{command}, '${env:SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe','exact Windows PS5.1 executable');
 is_deeply($task->{windows}{args},['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${workspaceFolder}\\scripts\\application.ps1','-Action',$action],'exact Windows argv');
 for my $platform ($task,$task->{osx}) {
  is($platform->{command},'/bin/sh','shell executable');
  is_deeply($platform->{args},['${workspaceFolder}/scripts/application.sh',$action],'shell script/action separate argv');
 }
 is($task->{options}{cwd},'${workspaceFolder}','task workspace cwd');
 is($task->{runOptions}{instanceLimit},1,'task instance limit retained');
}
my $settings = decode_json(read_file("$source/.vscode/settings.json"));
is($settings->{'terminal.integrated.defaultProfile.windows'},'Git Bash','Windows default terminal retained');
diag("Evidence (settings, command argv/environment JSONL, stdout/stderr): $evidence");
done_testing();
