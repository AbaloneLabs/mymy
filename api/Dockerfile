# ============================================================
# mymy API — Rust (axum) multi-stage Dockerfile
#
# Builder and runtime must share the same Debian suite so the
# compiled binary's glibc version matches the runtime image.
# We use bookworm for both (rust:bookworm + debian:bookworm-slim).
# ============================================================

# ---- Builder ----
FROM rust:1.95-bookworm AS builder

WORKDIR /app

# Install needed build deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Pre-create target dir for caching
COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src && echo "fn main() {}" > src/dummy.rs

# Build dependencies first (cache layer). We need a real main to resolve deps.
COPY src ./src
COPY migrations ./migrations

# Build release binaries.
# sqlx query! macros require DATABASE_URL at compile time for type checking.
# docker-compose builds with network:host, so localhost:33432 reaches the db.
ARG DATABASE_URL=postgres://mymy:mymy@localhost:33432/mymy
ENV DATABASE_URL=${DATABASE_URL}
RUN cargo build --release --bin mymy-api --bin mymy-sandbox-runner

# ---- Runtime ----
FROM debian:bookworm-slim AS runtime

WORKDIR /app

# Runtime deps:
#   ca-certificates — TLS for DB + outbound LLM calls
#   bash            — hermes wrapper script uses bash
#   gosu            — drop from root to the host UID after fixing /app/data ownership
#   curl, git, ssh, jq, xz-utils, file — required by the Hermes agent runtime.
#   python3, nodejs, npm — baseline sandbox runtimes for agent scripts and
#     development servers such as `python3 -m http.server` or `npm run dev`.
#   procps — lightweight process inspection inside the runner container.
#   iproute2 — tap network setup for the Firecracker backend.
#   bubblewrap — process isolation backend used by mymy-sandbox-runner when
#     Firecracker assets are not configured.
#     Hermes runs `hermes chat` as a subprocess, which invokes its own
#     install/bootstrap scripts that shell out to curl (download Node.js),
#     git (clone deps), ssh (remote ops), jq (JSON parsing), xz (extract
#     .tar.xz tarballs), file (binary detection). Without these the
#     subprocess exits with status 1 ("command not found").
# Runtime glibc matches builder (bookworm), so no version mismatch.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    bash \
    gosu \
    curl \
    git \
    openssh-client \
    jq \
    xz-utils \
    file \
    python3 \
    nodejs \
    npm \
    procps \
    iproute2 \
    bubblewrap \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/mymy-api /usr/local/bin/mymy-api
COPY --from=builder /app/target/release/mymy-sandbox-runner /usr/local/bin/mymy-sandbox-runner
COPY --from=builder /app/migrations ./migrations

# Entrypoint ensures the runtime HOME (set to the host user's home for the
# path-preserving Hermes mount) exists before the API starts.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 33697

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["mymy-api"]
