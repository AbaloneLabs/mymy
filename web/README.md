<div align="center">

<img src="../assets/logo.svg" alt="mymy" width="100" />

# mymy web

The frontend SPA for mymy. Built with Vite + React + TypeScript.

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

</div>

## Tech Stack

- **Vite 8** + **React 19** + **TypeScript**
- **Tailwind CSS v4** (Vite plugin, `@tailwindcss/vite`)
- **React Router** — PIN auth → protected routes
- **Zustand** — auth + settings state (with `persist`)
- **lucide-react** — icons
- **bun** — package manager / build tool

## Structure

```
web/
├── src/
│   ├── components/           # Reusable components
│   │   ├── settings/         # Settings UI (Toggle, SectionCard, etc.)
│   │   ├── AgentAvatar.tsx   # Agent avatar (first-letter fallback)
│   │   ├── AgentCard.tsx     # Agent card
│   │   ├── StatusDot.tsx     # Activity status dot
│   │   ├── ProtectedRoute.tsx# Auth guard
│   │   └── AppLayout.tsx     # Shared header + content wrapper
│   ├── routes/               # Page-level views
│   │   ├── PinScreen.tsx     # PIN authentication
│   │   ├── Dashboard.tsx     # Main dashboard
│   │   └── Settings.tsx      # Settings page
│   ├── store/
│   │   ├── auth.ts           # Zustand auth store (PIN)
│   │   └── settings.ts       # Zustand settings store
│   ├── features/             # Domain API hooks and feature components
│   ├── types/
│   │   └── *.ts              # Domain-specific types
│   ├── lib/
│   │   └── utils.ts          # cn() class merge util
│   ├── App.tsx               # Router definition
│   ├── main.tsx              # Entry point
│   └── index.css             # Design tokens + base styles
├── Dockerfile                # Multi-stage (bun build → nginx)
├── nginx.conf                # SPA routing fallback
└── vite.config.ts
```

## Development

```bash
bun install
bun run dev        # http://localhost:33696 (HMR)
```

## Build

```bash
bun run build      # outputs to dist/
bun run preview    # preview the production build
```

## Design System

A Linear-inspired dark theme. All colors are defined as CSS variables in `src/index.css`.

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#08090a` | Background |
| `--surface` | `#101113` | Cards / panels |
| `--accent` | `#5e6ad2` | Linear blue-violet |
| `--status-active` | `#26d07c` | Agent active dot |
| `--status-idle` | `#62666d` | Agent idle dot |

Components reference these via `var(--*)`.

## Authentication (PIN)

- Default PIN: `mymy`
- PIN verification is handled by the Rust API.
- Successful unlock sets the `mymy_session` HttpOnly cookie.
- The `/` route is guarded by `ProtectedRoute` and checks server session state.

## Settings

The `/settings` route provides:

- **General** — PIN change
- **Agent Systems** — Hermes/OpenClaw instances (local auto-detected, remote manual, multi-instance)
- **Git Integrations** — GitHub/GitLab/Gitea connection config
- **About** — Version & port info

Runtime settings are served by the Rust backend. Frontend storage only keeps UI
state that is safe to persist locally.
