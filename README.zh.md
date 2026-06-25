<div align="center">

# mymy

**面向个体经营者的 AI 智能体管理平台**

管理 AI 智能体（Hermes、OpenClaw），运行连接到 Git 系统的项目——一切尽在一个为个体经营者打造的专注工作区中。

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

---

![Status](https://img.shields.io/badge/status-WIP-orange) ![License](https://img.shields.io/badge/license-Apache%202.0-blue) ![Frontend](https://img.shields.io/badge/frontend-React%2019-61dafb) ![Backend](https://img.shields.io/badge/backend-Rust%20(axum)-dea584)

</div>

---

## ✨ 概述

**mymy** 将你的 AI 智能体和代码项目整合到一个简洁的界面中。无需在终端、浏览器标签页和配置文件之间来回切换，一个仪表盘即可：

- **一目了然查看智能体** — 谁在活跃、谁在空闲、正在运行什么
- **进入项目** — 连接到 GitHub、GitLab 或 Gitea 的项目
- **与智能体聊天**、记录笔记、管理日程 — 全在一处
- **锁定与隐私** — 基于 PIN 的访问（无云账户、无登录流程）

专为**一人企业**设计 —— 身兼数职的开发者创始人，把其余事务交给智能体。

## 🚀 功能

| | 功能 | 说明 |
|---|---------|-------------|
| 🔐 | **PIN 认证** | 本地优先访问。默认 PIN `mymy`，可在设置中更改。无账户、无邮箱。 |
| 🤖 | **智能体管理** | 查看所有 Hermes / OpenClaw 智能体的实时状态、头像和角色。 |
| 📁 | **项目工作区** | 连接到 Git 远程的项目 — 进入、组织、分配智能体。 |
| 💬 | **聊天** | 与智能体聊天，按会话组织，关联项目或通用话题。 |
| 📅 | **日历** | 安排和管理事件，关联到项目。 |
| 📝 | **笔记** | Markdown 笔记，支持 PostgreSQL 全文搜索（FTS）、标签和置顶。 |
| ⚙️ | **设置** | 配置智能体系统（多实例：本地 + 远程）和 Git 集成。 |
| 🌐 | **国际化** | 完整支持英语、韩语、中文、日语界面。 |
| 🎨 | **Linear 风格 UI** | 受 Linear 启发的专注暗色主题 — 全天使用也舒适。 |

## 🏗️ 架构

| 层 | 技术 | 说明 |
|-------|-----------|-------|
| **前端** | Vite · React 19 · TypeScript | SPA，无需 SSR |
| **样式** | Tailwind CSS v4 | CSS 变量设计令牌 |
| **状态** | Zustand · TanStack Query · React Router | 认证 + 设置（localStorage），服务器状态（React Query） |
| **后端** | Rust · axum | REST API，连接智能体 CLI |
| **数据库** | PostgreSQL 16 + pgvector | 一个数据库实现全文 + 语义搜索 |
| **基础设施** | Docker Compose | 一条命令运行全部 |

```
┌─────────────────────────────────────────────┐
│  浏览器 (:33696)                            │
│  ┌───────────────┐  ┌──────────────────┐    │
│  │  PIN 界面     │→ │  仪表盘          │    │
│  └───────────────┘  │  • 智能体        │    │
│                     │  • 项目          │    │
│                     │  • 聊天 💬       │    │
│                     │  • 日历 📅       │    │
│                     │  • 笔记 📝       │    │
│                     │  • 设置 ⚙️       │    │
│                     └────────┬─────────┘    │
└──────────────────────────────┼──────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Rust API (:33697)  │
                    │  • 认证 (PIN)       │
                    │  • 智能体系统       │
                    │  • 项目 CRUD        │
                    │  • 聊天 (Hermes)    │
                    │  • 日历             │
                    │  • 笔记 + FTS       │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
       │ PostgreSQL  │  │   Hermes    │  │  OpenClaw   │
       │ + pgvector  │  │   CLI       │  │  (计划中)   │
       │ (:33432)    │  │             │  │             │
       └─────────────┘  └─────────────┘  └─────────────┘
```

## 📸 截图

> _截图即将上线 — PIN 界面、仪表盘、聊天、日历和笔记视图。_

## ⚡ 快速开始

### 前置条件

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- （本地开发用）[bun](https://bun.sh/) ≥ 1.3 及 [Rust](https://www.rust-lang.org/) 工具链

### 使用 Docker 运行

```bash
# 1. 克隆
git clone <仓库-URL> mymy && cd mymy

# 2. 配置环境
cp .env.example .env

# 3. 启动
docker compose up -d --build
```

打开 **http://localhost:33696** 并输入 PIN：**`mymy`**

### 本地开发

```bash
# 前端
cd web
bun install
bun run dev      # http://localhost:5173 (HMR)

# 后端（另一个终端）
cd api
cargo run        # http://localhost:33697
```

## 🔧 配置

所有配置都在应用内的**设置**页面（`/settings`）：

| 部分 | 配置内容 |
|---------|-------------------|
| **通用** | 更改 PIN |
| **智能体系统** | 添加 Hermes/OpenClaw 实例（本地自动检测、远程手动） |
| **Git 集成** | 连接 GitHub、GitLab、Gitea（主机、端口、SSH 别名） |
| **关于** | 版本和端口信息 |

设置保存在浏览器的 `localStorage` 中，并与 Rust 后端同步。

### 端口

mymy 使用 **33xxx** 范围以避免与常见服务冲突：

| 服务 | 端口 |
|---------|------|
| Web（前端） | `33696` |
| API（Rust） | `33697` |
| PostgreSQL | `33432` |

## 🗺️ 路线图

### 已完成
- [x] PIN 认证 + 受保护路由
- [x] 仪表盘（智能体 + 项目）
- [x] 设置页面（PIN 更改、智能体系统、Git 集成）
- [x] Rust 后端（axum）— 认证、项目、智能体系统、设置
- [x] 与 Hermes 智能体聊天（会话 + 消息）
- [x] 日历（事件 CRUD）
- [x] 笔记（CRUD + PostgreSQL 全文搜索）
- [x] 国际化（英语、韩语、中文、日语）

### 计划中
- [ ] 首页仪表盘增强（小部件、活动流、统计）
- [ ] CRM / 客户管理（联系人及关系）
- [ ] 财务 — 收入与支出追踪
- [ ] 时间追踪
- [ ] 智能体自动化例程（预设）
- [ ] 工作流自动化引擎
- [ ] 通知中心
- [ ] OpenClaw 智能体集成
- [ ] Git 系统集成 UI（克隆、浏览、提交）
- [ ] 笔记语义搜索（pgvector 嵌入，待 LLM 配置）
- [ ] 任务管理

## 📄 许可证

本项目基于 **Apache License 2.0** 授权 — 完整文本请见
[LICENSE](LICENSE) 文件。

你可以自由使用、修改和分发本软件（包括商业用途），
只需遵守 Apache 2.0 许可证的条款。

## 🤝 贡献

**不接受拉取请求。**

欢迎提交 Issue — 每一份报告都会被查看，并根据情况给予反馈或在代码中采纳：

- **Bug 报告**和**功能建议**请通过 [GitHub Issues](https://github.com/ByungHyun21/mymy/issues) 提交。
- **特别欢迎使用 AI 工具进行的安全分析和改进建议** — 请将发现通过 Issue 分享，我们会进行审查并在有价值的地方采纳。

---

<div align="center">

为独立开发者而生。

</div>
