# ============================================================
# mymy web — multi-stage build
# 1) Install dependencies with bun and build production assets.
# 2) Serve static files with nginx, including SPA routing.
# ============================================================

# --- 1) Build stage ---
FROM oven/bun:1.3@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /app

# Copy lockfile first for dependency-layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build.
COPY . .
RUN bun run build

# --- 2) Serve stage ---
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS serve

# nginx config for SPA routing.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
