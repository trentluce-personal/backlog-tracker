#!/bin/sh
set -e

mkdir -p /home/coder/.local/share/opencode /home/coder/.local/share/code-server /workspace
chown -R coder:coder /home/coder/.local/share/opencode /home/coder/.local/share/code-server /workspace

run_as_coder() {
  runuser -u coder -- env HOME=/home/coder PATH="/home/coder/.opencode/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" "$@"
}

if ! run_as_coder code-server --list-extensions 2>/dev/null | grep -qx 'sst-dev.opencode'; then
  run_as_coder code-server --install-extension sst-dev.opencode >/dev/null 2>&1 || echo "forge-ide: could not install the OpenCode extension" >&2
fi

exec runuser -u coder -- env HOME=/home/coder PATH="/home/coder/.opencode/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" code-server "$@"
