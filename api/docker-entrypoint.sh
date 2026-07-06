#!/bin/sh
# mymy API entrypoint.
#
# Prepares the persistent app data volume and then drops from root to the
# configured host UID/GID. HOME points inside /app/data so API-side caches and
# temporary files stay inside the container volume instead of the host home.

set -e

HOST_UID="${HOST_UID:-1000}"
HOST_GID="${HOST_GID:-1000}"

if [ -n "$HOME" ] && [ ! -d "$HOME" ]; then
    mkdir -p "$HOME"
fi

if [ "$(id -u)" = "0" ]; then
    mkdir -p /app/data
    chown -R "$HOST_UID:$HOST_GID" /app/data
    exec gosu "$HOST_UID:$HOST_GID" "$@"
fi

exec "$@"
