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

# Build release binary.
# sqlx query! macros require DATABASE_URL at compile time for type checking.
# docker-compose builds with network:host, so localhost:33432 reaches the db.
ARG DATABASE_URL=postgres://mymy:mymy@localhost:33432/mymy
ENV DATABASE_URL=${DATABASE_URL}
RUN cargo build --release --bin mymy-api

# ---- Runtime ----
FROM debian:bookworm-slim AS runtime

WORKDIR /app

# Runtime deps:
#   ca-certificates — TLS for DB + outbound LLM calls
#   bash            — hermes wrapper script uses bash
# Runtime glibc matches builder (bookworm), so no version mismatch.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    bash \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/mymy-api /usr/local/bin/mymy-api
COPY --from=builder /app/migrations ./migrations

EXPOSE 33697

CMD ["mymy-api"]
