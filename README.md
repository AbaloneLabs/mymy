<div align="center">

<img src="assets/logo.svg" alt="mymy" width="120" />

# mymy

**A local AI agent workspace for solo operators**

Manage native LLM agents, their project workspaces, prompts, files, previews, notes, tasks, finance, and goals from one focused local app.

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

---

![Status](https://img.shields.io/badge/status-WIP-orange) ![License](https://img.shields.io/badge/license-Apache%202.0-blue) ![Frontend](https://img.shields.io/badge/frontend-React%2019-61dafb) ![Backend](https://img.shields.io/badge/backend-Rust%20(axum)-dea584)

</div>

---

## ✨ Overview

**mymy** brings your AI agents, project files, and operating data into a single local interface. Instead of juggling terminals, browser tabs, prompts, and scattered files, you get one workspace to:

- **Create native agents** backed by registered LLM providers
- **Keep agent work inside Drive** under `/drive/agents`, `/drive/projects`, and `/drive/shared`
- **Edit prompts** (`AGENTS.md`, `SOUL.md`) from the agent UI and the Drive tab
- **Open files and previews** for generated markdown, images, media, PDFs, docx text, and local dev servers
- **Run agent commands through a sandbox runner** with private agent roots plus shared/project mounts
- **Chat with agents**, take notes, track tasks/goals/finance, and manage your calendar
- **Stay locked & private** with PIN-based access (no cloud accounts, no login flows)

It's designed for the **one-person business** — the developer-founder who wears every hat and delegates the rest to agents.

## 🚀 Features

| | Feature | Description |
|---|---------|-------------|
| 🔐 | **PIN Authentication** | Server-side PIN sessions with an HttpOnly cookie. Default PIN `mymy`, changeable in settings. |
| 🤖 | **Native Agent Management** | Create/delete agents, edit prompts, select the active agent globally, and run chat sessions against registered LLM providers. |
| 📁 | **Drive Workspace** | Browse, edit, upload, delete, restore, and purge files under `/drive/projects`, `/drive/agents`, and `/drive/shared`; view md, docx text, images, audio, video, and PDFs. |
| 🧱 | **Sandbox Runner** | Agent terminal/code tools and long-running jobs execute through a dedicated runner with bubblewrap isolation by default. |
| 🖥️ | **Preview Proxy** | Agents can register dev-server ports with `register_preview`; the UI opens tokenized preview URLs through the API. |
| 📁 | **Project Workspace** | Projects get stable Drive folders and can be linked to chats and work sessions. |
| 💬 | **Chat** | Chat with native agents, organized into sessions tied to projects or general topics. |
| 📅 | **Calendar** | Schedule and manage events, linked to projects. |
| 📝 | **Notes** | Markdown notes with full-text search (PostgreSQL FTS), tags, and pinning. |
| ⚙️ | **Settings** | Configure PIN, LLM providers, agent systems, extensions, skills, and Git integrations. |
| 🌐 | **i18n** | Full UI in English, Korean, Chinese, and Japanese. |
| 🎨 | **Linear-style UI** | A focused dark theme inspired by Linear — easy on the eyes for all-day use. |

## 🏗️ Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Vite · React 19 · TypeScript | SPA, no SSR needed |
| **Styling** | Tailwind CSS v4 | CSS-variable design tokens |
| **State** | Zustand · TanStack Query · React Router | Auth + settings (localStorage), server state (React Query) |
| **Backend** | Rust · axum | REST API, server-side auth sessions, native agent runtime, Drive, preview proxy |
| **Sandbox runner** | Rust · axum · bubblewrap | Isolated command/process execution with optional Firecracker configuration surface |
| **Database** | PostgreSQL 16 + pgvector | Full-text + semantic search in one DB |
| **Infra** | Docker Compose | One command to run the app, DB, API data volume, Drive storage, and sandbox runner |

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
                    │  • Native agents    │
                    │  • LLM chat runtime │
                    │  • Drive + previews │
                    │  • Notes + FTS      │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
   │ PostgreSQL  │      │ Local Drive │      │ Sandbox     │
   │ + pgvector  │      │ volume      │      │ runner      │
   │ (:33432)    │      │             │      │ (:33698)    │
   └─────────────┘      └──────┬──────┘      └──────┬──────┘
                               │                    │
                        ┌──────▼──────┐      ┌──────▼──────┐
                        │   S3 sync   │      │ bubblewrap  │
                        │  provider   │      │ isolation   │
                        └─────────────┘      └─────────────┘
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
| **Models / LLM Providers** | Register OpenAI-compatible, Anthropic, Ollama, or local provider endpoints |
| **Agent Systems** | Manage legacy Hermes/OpenClaw instances when needed |
| **Git Integrations** | Connect GitHub, GitLab, Gitea (host, port, SSH alias) |
| **About** | Version & port info |

Runtime settings are served by the Rust backend. Stored Git API tokens are never
returned by the settings API.

### Auth

- `GET /api/health` is public.
- Protected API routes require the `mymy_session` HttpOnly cookie.
- Repeated invalid PIN attempts are rate-limited with a short lockout.
- Set `AUTH_COOKIE_SECURE=true` only when the API is served over HTTPS.

### Drive, Sandbox, and Previews

The API stores Drive data under `MYMY_AGENT_DATA_DIR`:

```text
/drive
  /projects/<project-slug>     project workspaces
  /agents/<agent-profile>      private agent workspace with AGENTS.md and SOUL.md
  /shared                      cross-agent shared files
```

Drive supports create/edit/upload/delete, a trash workflow with restore and
purge, and optional background S3 synchronization jobs. Native agent file tools
resolve paths only inside the current agent workspace plus explicitly granted
shared/project roots. Other agents' private folders are not granted as tool
roots.

The Docker stack starts a separate `sandbox-runner` service on port `33698`.
The API sends terminal commands, code execution, and long-running sandbox
processes to this runner when `MYMY_SANDBOX_RUNNER_URL` is configured. In the
default Compose setup, the runner uses bubblewrap to create PID, IPC, UTS, and
mount isolation, mounts the selected agent workspace plus shared/project roots,
and keeps process logs under the Drive data volume. User namespaces can be
enabled separately when the deployment provides an idmapped/rootfs setup that
can write Drive data.

Firecracker mode is exposed through configuration for deployments that provide
VM assets and host orchestration, but the default local stack uses bubblewrap:

```bash
MYMY_SANDBOX_MODE=bubblewrap
MYMY_SANDBOX_UNSHARE_USER=false
MYMY_SANDBOX_RUNNER_URL=http://sandbox-runner:33698
MYMY_SANDBOX_PREVIEW_HOST=sandbox-runner
```

Development servers started by an agent can be exposed through preview
endpoints. The runtime tool `register_preview` accepts a local forwarded port
and creates a tokenized `/api/previews/<token>` URL. The proxy accepts loopback
targets for local development and the configured sandbox preview host used by
the Docker runner, while rejecting arbitrary hosts to avoid becoming an open
proxy.

Optional S3 provider settings:

```bash
MYMY_DRIVE_S3_BUCKET=
MYMY_DRIVE_S3_REGION=
MYMY_DRIVE_S3_ENDPOINT=
```

When these are unset, Drive uses only the local Docker volume.

### Docker and Hermes

Docker Compose still supports optional legacy Hermes paths. To enable Hermes CLI
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
| Sandbox runner | `33698` |
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
- [x] Native LLM provider-backed agents
- [x] Drive tab with file browsing/editing/upload, trash, sync jobs, and media viewers
- [x] Agent prompt files in Drive (`AGENTS.md`, `SOUL.md`)
- [x] Tokenized preview proxy for agent-started local servers
- [x] Bubblewrap-backed sandbox runner for agent commands and long-running processes
- [x] S3 object synchronization worker for Drive sync jobs
- [x] i18n (English, Korean, Chinese, Japanese)

### Planned
- [ ] Home dashboard overview (widgets, activity feed, stats)
- [ ] Firecracker microVM host assets and lifecycle orchestration for stronger VM-backed isolation
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
