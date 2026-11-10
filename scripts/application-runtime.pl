#!/usr/bin/perl
# Internal implementation of application.sh; only core Perl modules are used.
use strict;
use warnings;
use FindBin;
use Cwd qw(realpath);
use JSON::PP qw(decode_json);
use Digest::SHA qw(sha256_hex);
use Fcntl qw(:DEFAULT :flock :mode);
use POSIX qw(setpgid WNOHANG);
use IO::Select;
use Time::HiRes qw(time sleep);
$| = 1;

my ($action, $docker_timeout, $health_timeout) = @ARGV;
$action //= 'Start';
$docker_timeout //= 180;
$health_timeout //= 120;
my ($child, $lock);
sub fail { die "$_[0]\n" }
# Children close the lock descriptor: even SIGKILL releases the workspace lock.
# Compose work may survive task termination, as on Windows.
for my $signal (qw(HUP INT TERM)) {
    $SIG{$signal} = sub { kill 'TERM', -$child if $child; exit 1 };
}

sub run {
    my ($timeout, $capture, @args) = @_;
    pipe(my $out_r, my $out_w) or fail "pipe: $!";
    pipe(my $err_r, my $err_w) or fail "pipe: $!";
    $child = fork();
    defined $child or fail "fork: $!";
    if (!$child) {
        close $lock if $lock;
        setpgid(0, 0) == 0 or POSIX::_exit(1);
        close $out_r; close $err_r;
        open STDIN, '<', '/dev/null' or POSIX::_exit(1);
        open STDOUT, '>&', $out_w or POSIX::_exit(1);
        open STDERR, '>&', $err_w or POSIX::_exit(1);
        close $out_w; close $err_w;
        exec { $args[0] } @args or POSIX::_exit(127);
    }
    setpgid($child, $child);
    close $out_w; close $err_w;
    my $select = IO::Select->new($out_r, $err_r);
    my ($stdout, $stderr, $status) = ('', '', undef);
    my $deadline = defined($timeout) ? time + $timeout : undef;
    while ($select->count || !defined $status) {
        if (defined($deadline) && time >= $deadline) {
            kill 'KILL', -$child;
            waitpid($child, 0) unless defined $status;
            close $out_r; close $err_r;
            $child = undef;
            return (124, $stdout, "$stderr Docker command timed out.");
        }
        for my $fh ($select->can_read(0.05)) {
            my $length = sysread($fh, my $buffer, 65536);
            if (!defined($length)) { next if $!{EINTR}; fail "Docker output: $!" }
            if (!$length) { $select->remove($fh); next }
            if ($capture) {
                if (fileno($fh) == fileno($out_r)) { $stdout .= $buffer }
                else { $stderr .= $buffer }
            } else {
                if (fileno($fh) == fileno($out_r)) { print STDOUT $buffer }
                else { print STDERR $buffer }
            }
        }
        sleep 0.01 unless $select->count;
        if (!defined($status) && waitpid($child, WNOHANG) == $child) { $status = $? }
    }
    close $out_r; close $err_r;
    $child = undef;
    return ($status & 127 ? 128 + ($status & 127) : $status >> 8, $stdout, $stderr);
}

sub acquire_lock {
    my ($root) = @_;
    # Stable private per-user namespace; never unlink flock files on release.
    my $directory = '/tmp/backlog-tracker-lifecycle-' . $<;
    mkdir $directory, 0700 unless -e $directory;
    my @dir = lstat $directory;
    @dir && S_ISDIR($dir[2]) && $dir[4] == $< && ($dir[2] & 077) == 0
        or fail 'Cannot safely open the workspace lifecycle lock directory.';
    my $file = "$directory/" . sha256_hex($root) . '.lock';
    sysopen($lock, $file, O_RDWR | O_CREAT | O_NOFOLLOW, 0600) or fail "Cannot open lifecycle lock: $!";
    my @stat = stat $lock;
    S_ISREG($stat[2]) && $stat[4] == $< && $stat[3] == 1 && ($stat[2] & 077) == 0
        or fail 'Unsafe workspace lifecycle lock file.';
    flock($lock, LOCK_EX | LOCK_NB)
        or fail 'Another lifecycle operation is in progress for this workspace. Retry after it finishes or terminate its task. Pending Compose work may still need a subsequent Stop.';
}

sub configure {
    my ($docker) = @_;
    my ($code, $json, $error) = run(15, 1, $docker, 'compose', 'config', '--format', 'json');
    fail "Could not resolve production Compose configuration: $error" if $code;
    my $config = eval { decode_json($json) };
    fail 'Could not parse production Compose configuration.' unless ref($config) eq 'HASH';
    my $app = $config->{services}{app} || fail 'Production Compose is missing app.';
    my $project = $config->{name} || fail 'Production Compose is missing project name.';
    my $volume = $config->{volumes}{'backlog-data'} || fail 'Production Compose is missing backlog-data.';
    my $name = $volume->{name} || fail 'Production Compose is missing the resolved volume name.';
    $project =~ /\A[a-z0-9][a-z0-9_-]*\z/ && $name =~ /\A[a-zA-Z0-9][a-zA-Z0-9_.-]*\z/
        or fail 'Invalid resolved project or volume identity.';
    my @mounts = @{$app->{volumes} || []};
    my @data = grep { ($_->{target} // '') eq '/app/data' && ($_->{type} // '') eq 'volume' && ($_->{source} // '') eq 'backlog-data' } @mounts;
    @data == 1 && !exists(($data[0]{volume} || {})->{subpath}) &&
        ($app->{environment}{BACKLOG_DB_PATH} // '') eq '/app/data/backlog.sqlite' && !@{$app->{volumes_from} || []}
        or fail 'Production Compose overrides change the database mount or path.';
    my @targets = map { $_->{target} // '' } @mounts;
    push @targets, map { (split /:/, $_, 2)[0] } @{$app->{tmpfs} || []};
    push @targets, map { ref($_) eq 'HASH' ? ($_->{target} // '') : '' } @{$app->{secrets} || []}, @{$app->{configs} || []};
    my $matching = 0;
    for my $target (@targets) {
        next unless length $target;
        my @parts;
        for my $part (split m{/}, $target) {
            next if $part eq '' || $part eq '.';
            if ($part eq '..') { pop @parts } else { push @parts, $part }
        }
        my $path = '/' . join('/', @parts);
        ++$matching if $path eq '/app/data';
        index($path, '/app/data/') != 0 or fail 'Production Compose has an overlapping mount under /app/data.';
    }
    $matching == 1 or fail 'Production Compose has overlapping mounts at /app/data.';
    $ENV{BACKLOG_DEV_VOLUME} = $name;
    return ($project, $name, $volume->{external}, $volume->{driver} || $volume->{driver_opts});
}

sub lifecycle {
    my ($operation, $docker, $os, $root) = @_;
    if ($operation eq 'Restart') {
        my $code = lifecycle('Stop', $docker, $os, $root);
        return $code if $code;
        return lifecycle('Start', $docker, $os, $root);
    }
    my ($code, $out, $error) = run(10, 1, $docker, 'compose', 'version');
    fail "Docker Compose is unavailable. Install/update Docker Desktop with Compose v2+. $out $error" if $code;
    print STDERR $error if length $error;
    if ($operation eq 'Start') {
        my $deadline = time + $docker_timeout;
        my ($launched, $last) = (0, '');
        while (1) {
            my $remaining = $deadline - time;
            fail "Timed out after $docker_timeout seconds waiting for a Linux Docker engine. Check Docker startup and the selected context; no context was changed. Last probe: $last" if $remaining <= 0;
            ($code, $out, $error) = run($remaining < 5 ? $remaining : 5, 1, $docker, 'info', '--format', '{{.OSType}}');
            if (!$code) {
                print STDERR $error if length $error;
                $out =~ s/^\s+|\s+$//g;
                fail "Docker reports engine '$out'; this app requires Linux containers. Check the selected Docker context, then retry." unless $out eq 'linux';
                last;
            }
            $last = "$out $error";
            $remaining = $deadline - time;
            next if $remaining <= 0;
            if (!$launched) {
                if ($os eq 'Darwin') {
                    print "Docker engine is unavailable. Starting Docker Desktop...\n";
                    my ($launch_code, undef, $launch_error) = run($remaining < 10 ? $remaining : 10, 1, 'open', '-a', 'Docker');
                    fail "Could not open Docker Desktop. Install/start it manually, then retry. $launch_error" if $launch_code;
                } else {
                    print "Docker engine is unavailable. Start your Linux Docker daemon manually; waiting for readiness...\n";
                }
                $launched = 1;
            }
            $remaining = $deadline - time;
            sleep($remaining < 2 ? $remaining : 2) if $remaining > 0;
        }
    }
    my ($project, $volume, $external, $custom) = configure($docker);
    my @compose = ($docker, 'compose', '--ansi', 'never', '--progress', 'plain');
    my @dev = (@compose, '--project-directory', $root, '-p', $project, '-f', "$root/compose.dev.yaml");
    if ($operation eq 'Start') {
        print "Stopping the production app in this Compose project before starting development (data volume is preserved)...\n";
        ($code) = run(undef, 0, @compose, 'stop', 'app');
        return $code if $code;
        if (!$external) {
            if ($custom) {
                ($code) = run(15, 1, $docker, 'volume', 'inspect', $volume);
                fail 'The configured production volume uses a custom driver or options and does not exist. Create it using production Compose first.' if $code;
            } else {
                ($code, undef, $error) = run(15, 1, $docker, 'volume', 'create', '--label', "com.docker.compose.project=$project", '--label', 'com.docker.compose.volume=backlog-data', $volume);
                fail "Could not create development data volume: $error" if $code;
            }
        }
        print "Linux Docker engine ready. Building and starting the development application...\n";
        ($code) = run(undef, 0, @dev, 'up', '--build', '-d', '--wait', '--wait-timeout', $health_timeout, 'dev');
        return $code if $code;
        ($code, $out, $error) = run(10, 1, @dev, 'port', 'dev', '5173');
        print STDERR $error if length $error;
        $out =~ s/^\s+|\s+$//g;
        fail "Application started, but its loopback URL could not be determined: $out $error. Check docker compose ps." if $code || $out !~ /\A127\.0\.0\.1:([0-9]+)\z/;
        print "Application ready: http://127.0.0.1:$1\n";
        return 0;
    }
    ($code) = run(undef, 0, @dev, $operation eq 'Stop' ? ('stop', 'dev') : ('logs', '--follow', '--tail', '100', 'dev'));
    print "Application stopped. Its data volume and Docker Desktop are preserved.\n" if $operation eq 'Stop' && !$code;
    return $code;
}

my $result = eval {
    @ARGV <= 3 && $action =~ /\A(?:Start|Stop|Restart|Logs)\z/ or fail 'Usage: sh scripts/application.sh Start|Stop|Restart|Logs [DockerTimeoutSeconds [HealthTimeoutSeconds]]';
    for ($docker_timeout, $health_timeout) {
        /\A[0-9]+\z/ && $_ >= 1 && $_ <= 1800 or fail 'Timeouts must be integers from 1 to 1800 seconds.';
    }
    my $root = realpath("$FindBin::Bin/..") or fail 'Cannot resolve workspace.';
    chdir $root or fail "Cannot enter workspace: $!";
    my ($os_code, $os) = run(5, 1, 'uname', '-s');
    $os =~ s/\s+$//;
    !$os_code && ($os eq 'Darwin' || $os eq 'Linux') or fail 'This shell launcher supports macOS and Linux; use application.ps1 on Windows.';
    my $docker;
    for my $directory (split /:/, $ENV{PATH} // '') {
        my $path = (length($directory) ? $directory : '.') . '/docker';
        if (-f $path && -x $path) { $docker = realpath($path); last }
    }
    $docker or fail 'Docker CLI was not found. Install Docker Desktop/Compose and restart VS Code so docker is on PATH.';
    acquire_lock($root) unless $action eq 'Logs';
    lifecycle($action, $docker, $os, $root);
};
if ($@) { print STDERR "Application task failed: $@"; exit 1 }
exit $result;
