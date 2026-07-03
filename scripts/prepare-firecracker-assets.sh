#!/usr/bin/env bash
set -euo pipefail

# Prepare Firecracker assets for the mymy sandbox runner.
#
# The runner expects a Firecracker binary, an uncompressed guest kernel, an ext4
# rootfs with SSH enabled for the configured user, and the matching private key.
# Firecracker does not bind-mount host directories into the guest, so mymy
# copies only the allowed Drive roots into the VM over SSH and copies writable
# roots back when the command or managed process exits.

OUT_DIR="${1:-./firecracker-assets}"
ROOTFS_SIZE="${ROOTFS_SIZE:-2G}"
ARCH="$(uname -m)"
RELEASE_URL="https://github.com/firecracker-microvm/firecracker/releases"
S3="https://s3.amazonaws.com/spec.ccfc.min"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

need curl
need tar
need grep
need sort
need tail
need basename
need ssh-keygen
need unsquashfs
need mkfs.ext4

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  need sudo
  SUDO="sudo"
fi

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

latest="$(basename "$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$RELEASE_URL/latest")")"
if [ ! -x ./firecracker ]; then
  curl -fsSL "$RELEASE_URL/download/$latest/firecracker-$latest-$ARCH.tgz" | tar -xz
  release_dir="release-$latest-$ARCH"
  install -m 0755 "$release_dir/firecracker-$latest-$ARCH" ./firecracker
fi

ci_prefix="$(
  curl -fsSL "$S3?list-type=2&prefix=firecracker-ci/&delimiter=/" \
    | grep -oP '(?<=<Prefix>)firecracker-ci/[0-9]{8}-[^/]+/(?=</Prefix>)' \
    | sort \
    | tail -1
)"

kernel_key="$(
  curl -fsSL "$S3?list-type=2&prefix=${ci_prefix}${ARCH}/vmlinux-" \
    | grep -oP "(?<=<Key>)(${ci_prefix}${ARCH}/vmlinux-[0-9]+\\.[0-9]+\\.[0-9]{1,3})(?=</Key>)" \
    | sort -V \
    | tail -1
)"
curl -fsSL -o vmlinux "$S3/$kernel_key"
chmod 0644 vmlinux

ubuntu_key="$(
  curl -fsSL "$S3?list-type=2&prefix=${ci_prefix}${ARCH}/ubuntu-" \
    | grep -oP "(?<=<Key>)(${ci_prefix}${ARCH}/ubuntu-[0-9]+\\.[0-9]+\\.squashfs)(?=</Key>)" \
    | sort -V \
    | tail -1
)"
curl -fsSL -o rootfs.squashfs.upstream "$S3/$ubuntu_key"

if [ ! -f id_rsa ]; then
  ssh-keygen -q -t rsa -b 4096 -f id_rsa -N ""
fi
chmod 0600 id_rsa

rm -rf squashfs-root rootfs.ext4
$SUDO unsquashfs -d squashfs-root rootfs.squashfs.upstream >/dev/null
$SUDO install -d -m 0700 -o root -g root squashfs-root/root/.ssh
$SUDO install -m 0600 -o root -g root id_rsa.pub squashfs-root/root/.ssh/authorized_keys
truncate -s "$ROOTFS_SIZE" rootfs.ext4
$SUDO mkfs.ext4 -q -d squashfs-root -F rootfs.ext4
$SUDO chown "$(id -u):$(id -g)" rootfs.ext4

if [ "${KEEP_FIRECRACKER_WORKDIR:-0}" != "1" ]; then
  rm -rf "release-$latest-$ARCH" squashfs-root rootfs.squashfs.upstream
fi

cat <<EOF
Firecracker assets are ready:
  FIRECRACKER_BIN=$(pwd)/firecracker
  FIRECRACKER_KERNEL_IMAGE=$(pwd)/vmlinux
  FIRECRACKER_ROOTFS_IMAGE=$(pwd)/rootfs.ext4
  FIRECRACKER_SSH_KEY_PATH=$(pwd)/id_rsa

For Docker Compose, place these files under the mymy data volume or bind-mount
this directory into the sandbox-runner container, then set MYMY_SANDBOX_MODE=firecracker.
EOF
