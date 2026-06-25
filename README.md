<div align="center">

<img src="assets/logo.svg" alt="mymy" width="120" />

# mymy

**An AI Agent Management Platform for Solo Entrepreneurs**

Manage AI agents (Hermes, OpenClaw) and run projects connected to your Git systems — all from one focused workspace built for the solo business owner.

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

---

![Status](https://img.shields.io/badge/status-WIP-orange) ![License](https://img.shields.io/badge/license-Apache%202.0-blue) ![Frontend](https://img.shields.io/badge/frontend-React%2019-61dafb) ![Backend](https://img.shields.io/badge/backend-Rust%20(axum)-dea584)

</div>

---

## ✨ Overview

**mymy** brings your AI agents and code projects together into a single, calm interface. Instead of juggling terminals, browser tabs, and config files, you get one dashboard to:

- **See your agents at a glance** — who's active, who's idle, what they're running
- **Enter projects** connected to GitHub, GitLab, or Gitea
- **Chat with agents**, take notes, and manage your calendar — all in one place
- **Stay locked & private** with PIN-based access (no cloud accounts, no login flows)

It's designed for the **one-person business** — the developer-founder who wears every hat and delegates the rest to agents.

## 🚀 Features

| | Feature | Description |
|---|---------|-------------|
| 🔐 | **PIN Authentication** | Server-side PIN sessions with an HttpOnly cookie. Default PIN `mymy`, changeable in settings. |
| 🤖 | **Agent Management** | View all your Hermes / OpenClaw agents with live status, avatars, and roles. |
| 📁 | **Project Workspace** | Projects linked to Git remotes — enter, organize, and assign agents. |
| 💬 | **Chat** | Chat with agents, organized into sessions tied to projects or general topics. |
| 📅 | **Calendar** | Schedule and manage events, linked to projects. |
| 📝 | **Notes** | Markdown notes with full-text search (PostgreSQL FTS), tags, and pinning. |
| ⚙️ | **Settings** | Configure agent systems (multi-instance: local + remote) and Git integrations. |
| 🌐 | **i18n** | Full UI in English, Korean, Chinese, and Japanese. |
| 🎨 | **Linear-style UI** | A focused dark theme inspired by Linear — easy on the eyes for all-day use. |

## 🏗️ Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Vite · React 19 · TypeScript | SPA, no SSR needed |
| **Styling** | Tailwind CSS v4 | CSS-variable design tokens |
| **State** | Zustand · TanStack Query · React Router | Auth + settings (localStorage), server state (React Query) |
| **Backend** | Rust · axum | REST API, server-side auth sessions, domain services, local agent CLI adapters |
| **Database** | PostgreSQL 16 + pgvector | Full-text + semantic search in one DB |
| **Infra** | Docker Compose | One command to run everything |

```
┌─────────────────────────────────────────────┐
│  Browser (:33696)                           │
│  ┌───────────────┐  ┌──────────────────┐    │
│  │  PIN Screen   │→ │  Dashboard       │    │
│  └───────────────┘  │  • Agents        │    │
│                     │  • Projects      │    │
│                     │  • Chat 💬       │    │
│                     │  • Calendar 📅   │    │
│                     │  • Notes 📝      │    │
│                     │  • Settings ⚙️   │    │
│                     └────────┬─────────┘    │
└──────────────────────────────┼──────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Rust API (:33697)  │
                    │  • Auth sessions    │
                    │  • Agent systems    │
                    │  • Projects CRUD    │
                    │  • Chat (Hermes)    │
                    │  • Calendar         │
                    │  • Notes + FTS      │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
       │ PostgreSQL  │  │   Hermes    │  │  OpenClaw   │
       │ + pgvector  │  │   CLI       │  │  (planned)  │
       │ (:33432)    │  │             │  │             │
       └─────────────┘  └─────────────┘  └─────────────┘
```

## 📸 Screenshots

> _Screenshots coming soon — PIN screen, dashboard, chat, calendar, and notes views._

## ⚡ Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- (For local dev) [bun](https://bun.sh/) ≥ 1.3 and [Rust](https://www.rust-lang.org/) toolchain

### Run with Docker

```bash
# 1. Clone
git clone <your-repo-url> mymy && cd mymy

# 2. Configure environment
cp .env.example .env

# 3. Launch
docker compose up -d --build
```

Open **http://localhost:33696** and enter PIN: **`mymy`**

### Local Development

```bash
# Database
docker compose up -d db

# Frontend
cd web
bun install
bun run dev      # http://localhost:5173 (HMR)

# Backend (in another terminal)
cd api
DATABASE_URL=postgres://mymy:mymy@localhost:33432/mymy cargo run
```

`sqlx::query!` checks require a live PostgreSQL schema during local backend
builds, clippy, and tests:

```bash
cd api
DATABASE_URL=postgres://mymy:mymy@localhost:33432/mymy cargo build
DATABASE_URL=postgres://mymy:mymy@localhost:33432/mymy cargo clippy -- -D warnings
DATABASE_URL=postgres://mymy:mymy@localhost:33432/mymy cargo test
```

## 🔧 Configuration

App configuration is split between environment variables and the in-app
**Settings** page (`/settings`):

| Section | What you configure |
|---------|-------------------|
| **General** | Change your PIN |
| **Agent Systems** | Add Hermes/OpenClaw instances (local auto-detected, remote manual) |
| **Git Integrations** | Connect GitHub, GitLab, Gitea (host, port, SSH alias) |
| **About** | Version & port info |

Runtime settings are served by the Rust backend. Stored Git API tokens are never
returned by the settings API.

### Auth

- `GET /api/health` is public.
- Protected API routes require the `mymy_session` HttpOnly cookie.
- Repeated invalid PIN attempts are rate-limited with a short lockout.
- Set `AUTH_COOKIE_SECURE=true` only when the API is served over HTTPS.

### Docker and Hermes

Docker Compose starts without host-specific Hermes paths. By default it mounts
empty ignored directories under `.local/hermes/*`. To enable Hermes CLI
integration inside Docker, set these in `.env`:

```bash
HERMES_HOME=/absolute/host/path/to/hermes/home
HERMES_BIN_DIR=/absolute/host/path/to/hermes/bin
UV_PYTHON_DIR=/absolute/host/path/to/uv/python/cache
HERMES_CLI_PATH=/home/mymy/.local/bin/hermes
```

### CI

GitLab CI is configured in `.gitlab-ci.yml` for the shell runner tagged
`Ubuntu Runner`. The pipeline runs:

- Repository whitespace and Docker Compose config checks
- Rust format, clippy (`-D warnings`), build, tests, and RustSec audit
- Secret scanning with gitleaks
- Web ESLint, Bun audit, and production build
- API and web Docker image builds with smoke checks

Rust jobs start an isolated `pgvector/pgvector:pg16` container, apply the SQL
migrations, and then run `cargo` with `DATABASE_URL` set for `sqlx::query!`
compile-time checks.

The RustSec audit ignores `RUSTSEC-2023-0071` because it is pulled in through
`sqlx-mysql`'s optional RSA authentication dependency while this project enables
only PostgreSQL `sqlx` features.

Registry publishing, deployment automation, and hosted monitoring are not
configured in this repository. Those require a separate external infrastructure
decision.

### Ports

mymy uses the **33xxx** range to avoid conflicts with common services:

| Service | Port |
|---------|------|
| Web (frontend) | `33696` |
| API (Rust) | `33697` |
| PostgreSQL | `33432` |

## 🗺️ Roadmap

### Done
- [x] PIN authentication + protected routes
- [x] Dashboard (agents + projects)
- [x] Settings page (PIN change, agent systems, Git integrations)
- [x] Rust backend (axum) — auth, projects, agent systems, settings
- [x] Chat with Hermes agents (sessions + messages)
- [x] Calendar (events CRUD)
- [x] Notes (CRUD + PostgreSQL full-text search)
- [x] Tasks (custom statuses, list and board views)
- [x] Knowledge base (hierarchical markdown articles)
- [x] Finance (transactions and period summaries)
- [x] Goals / OKR tracking
- [x] i18n (English, Korean, Chinese, Japanese)

### Planned
- [ ] Home dashboard overview (widgets, activity feed, stats)
- [ ] CRM / client management (contacts & relationships)
- [ ] Time tracking
- [ ] Agent automation routines (presets)
- [ ] Workflow automation engine
- [ ] Notification center
- [ ] OpenClaw agent integration
- [ ] Git system integration UI (clone, browse, commit)
- [ ] Notes semantic search (pgvector embeddings, pending LLM setup)

## 📄 License

This project is licensed under the **Apache License 2.0** — see the
[LICENSE](LICENSE) file for the full text.

You are free to use, modify, and distribute this software, including for
commercial purposes, subject to the terms of the Apache 2.0 license.

## 🤝 Contributing

**Pull requests are not accepted.**

Issues are welcome — every report is reviewed, and feedback or fixes are
applied as appropriate:

- **Bug reports** and **feature suggestions** via [GitHub Issues](https://github.com/ByungHyun21/mymy/issues).
- **Security analysis and improvement suggestions generated with AI tools**
  are especially welcome — share findings via an issue and they will be
  reviewed and incorporated where valuable.

---

<div align="center">

Built for the solo builder.

</div>
