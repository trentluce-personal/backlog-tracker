#!/bin/sh
# Docker lifecycle tasks: stock macOS shell/Perl, no native Node or PowerShell.
set -eu
command -v perl >/dev/null 2>&1 || { printf '%s\n' 'Application task failed: Perl with JSON::PP is required.' >&2; exit 1; }
scripts=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec perl "$scripts/application-runtime.pl" "$@"
