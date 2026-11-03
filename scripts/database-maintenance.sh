#!/bin/sh
# Offline Compose-volume backup/restore; requires Docker Compose and Perl JSON::PP.
set -eu

fail() { printf '%s\n' "Database maintenance failed: $*" >&2; exit 1; }
if [ "$#" -ne 2 ] || { [ "$1" != backup ] && [ "$1" != restore ]; }; then
  fail 'Usage: sh scripts/database-maintenance.sh backup|restore PATH'
fi
action=$1
path=$2
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"
command -v perl >/dev/null 2>&1 || fail 'Perl with JSON::PP is required to validate the resolved Compose configuration.'
if [ "$action" = backup ]; then
  [ ! -e "$path" ] && [ ! -L "$path" ] || fail 'Backup destination must not already exist.'
  parent=$(CDPATH= cd -- "$(dirname -- "$path")" && pwd -P) || fail 'Backup parent directory does not exist.'
  path=$parent/$(basename -- "$path")
else
  [ -f "$path/backlog.sqlite" ] || fail 'Restore directory must contain backlog.sqlite at its root.'
  path=$(CDPATH= cd -- "$path" && pwd -P)
fi
# Git Bash invokes a Windows Docker CLI, which needs a Windows host path.
case $(uname -s) in MINGW*|MSYS*) path=$(cygpath -w "$path"); export MSYS_NO_PATHCONV=1 ;; esac

# Only parse the resolved configuration: no assumptions about .env, overrides,
# project prefix, external volume names, or JSON formatting.
config=$(docker compose config --format json) || fail 'Cannot resolve production Compose configuration.'
identity=$(printf '%s' "$config" | perl -MJSON::PP -e '
use strict; use warnings;
local $/; my $c = decode_json(<STDIN>); my $app = $c->{services}{app} || die "Missing app\n";
my $project = $c->{name} || die "Missing project\n";
my $volume = $c->{volumes}{"backlog-data"}{name} || die "Missing volume\n";
$project =~ /\A[a-z0-9][a-z0-9_-]*\z/ && $volume =~ /\A[a-zA-Z0-9][a-zA-Z0-9_.-]*\z/ or die "Invalid identity\n";
my @mounts = @{$app->{volumes} || []};
my @data = grep { ($_->{target} // "") eq "/app/data" && ($_->{type} // "") eq "volume" && ($_->{source} // "") eq "backlog-data" } @mounts;
@data == 1 && !exists(($data[0]{volume} || {})->{subpath}) && ($app->{environment}{BACKLOG_DB_PATH} // "") eq "/app/data/backlog.sqlite" && !@{$app->{volumes_from} || []} or die "Unsafe database mount or path\n";
my @targets = map { $_->{target} // "" } @mounts;
push @targets, map { (split /:/, $_, 2)[0] } @{$app->{tmpfs} || []};
push @targets, map { ref($_) eq "HASH" ? ($_->{target} // "") : "" } @{$app->{secrets} || []}, @{$app->{configs} || []};
my $count = 0;
for my $target (@targets) {
    next unless length $target;
    my @parts; for my $part (split m{/}, $target) { next if $part eq "" || $part eq "."; if ($part eq "..") { pop @parts; } else { push @parts, $part; } }
    my $path = "/" . join("/", @parts);
    ++$count if $path eq "/app/data";
    index($path, "/app/data/") != 0 or die "Overlapping database mount\n";
}
$count == 1 or die "Overlapping database mount\n";
print "$project\n$volume\n";
') || fail 'Cannot safely resolve project and database volume.'
project=${identity%%'
'*}
volume=${identity#*'
'}
printf 'Project: %s; database volume: %s\n' "$project" "$volume"
if [ "$action" = restore ] && [ "${BACKLOG_MAINTENANCE_VOLUME:-}" != "$volume" ]; then
  fail 'Set BACKLOG_MAINTENANCE_VOLUME to the displayed volume name to confirm the restore target.'
fi

# Address only the two Compose services; independent containers must be reported
# as remaining volume users, not silently stopped.
BACKLOG_DEV_VOLUME=$volume
export BACKLOG_DEV_VOLUME
docker compose --project-directory "$root" -p "$project" -f "$root/compose.dev.yaml" stop dev || fail 'Could not stop dev.'
docker compose stop app || fail 'Could not stop app.'
no_writers() {
  running=$(docker ps -q --filter "volume=$volume") || fail 'Cannot check volume users.'
  [ -z "$running" ] || fail "Running containers still mount volume '$volume': $running"
}
no_writers
ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=dev" --filter "volume=$volume") || fail 'Cannot inspect dev containers.'
if [ -z "$ids" ]; then
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=app" --filter "volume=$volume") || fail 'Cannot inspect app containers.'
fi
[ -n "$ids" ] || fail 'No stopped app/dev container mounts the volume. Start and stop the app first.'
set -- $ids
image=$(docker inspect --format '{{.Config.Image}}' "$1") || fail 'Cannot identify the container image.'
[ -n "$image" ] || fail 'The container image is missing.'

container=
cleanup() { if [ -n "$container" ]; then docker rm "$container" >/dev/null || printf '%s\n' "Could not remove temporary container $container" >&2; fi; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mount="type=volume,source=$volume,target=/app/data"
if [ "$action" = backup ]; then mount=$mount,readonly; fi
container=$(docker create --network none --mount "$mount" --entrypoint node "$image" --version) || fail 'Cannot create offline copy container.'
[ -n "$container" ] || fail 'Cannot create offline copy container.'
if [ "$action" = backup ]; then
  no_writers
  docker cp "$container:/app/data/." "$path" || fail 'Backup copy failed.'
  printf 'Backup copied to %s\n' "$path"
else
  no_writers
  docker run --rm --network none --user 0 --mount "$mount" --entrypoint node "$image" --input-type=module -e "import {readdir,rm} from 'node:fs/promises'; for (const name of await readdir('/app/data')) await rm('/app/data/'+name,{recursive:true,force:true});" || fail 'Restore clear failed.'
  no_writers
  docker cp "$path/." "$container:/app/data" || fail 'Restore copy failed.'
  no_writers
  docker run --rm --network none --user 0 --mount "$mount" --entrypoint chown "$image" -R 1000:1000 /app/data || fail 'Restore ownership fix failed.'
  printf 'Restore copied from %s\n' "$path"
fi
