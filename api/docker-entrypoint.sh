#!/bin/sh
# mymy API entrypoint.
#
# Ensures the runtime HOME directory exists and is writable before exec'ing
# the API binary. With the path-preserving mount strategy, HOME is set to the
# host user's home (e.g. /home/yoon, /Users/alice), which may not exist in the
# base image. Bind mounts populate sub-paths (HOME/.hermes, HOME/.local/bin)
# but not HOME itself or intermediate dirs like HOME/.local, so we create them
# here. The container runs as the host UID/GID, so ownership is correct.

set -e

HOST_UID="${HOST_UID:-1000}"
HOST_GID="${HOST_GID:-1000}"

if [ -n "$HOME" ] && [ ! -d "$HOME" ]; then
    mkdir -p "$HOME"
fi
# Intermediate dir for ~/.local/bin and ~/.local/share/uv mounts.
if [ -n "$HOME" ] && [ ! -d "$HOME/.local" ]; then
    mkdir -p "$HOME/.local"
fi

if [ "$(id -u)" = "0" ]; then
    mkdir -p /app/data
    chown -R "$HOST_UID:$HOST_GID" /app/data
    exec gosu "$HOST_UID:$HOST_GID" "$@"
fi

exec "$@"
