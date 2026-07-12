# mymy web

mymy 的前端 SPA。使用 Vite + React + TypeScript 构建。

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

## 技术栈

- **Vite 8** + **React 19** + **TypeScript**
- **Tailwind CSS v4**（Vite 插件，`@tailwindcss/vite`）
- **React Router** — PIN 认证 → 受保护路由
- **Zustand** — 认证 + 设置状态（含 `persist`）
- **lucide-react** — 图标
- **bun** — 包管理器 / 构建工具

## 结构

```
web/
├── src/
│   ├── components/           # 可复用组件
│   │   ├── settings/         # 设置 UI（Toggle、SectionCard 等）
│   │   ├── AgentAvatar.tsx   # 智能体头像（首字母回退）
│   │   ├── AgentCard.tsx     # 智能体卡片
│   │   ├── StatusDot.tsx     # 活动状态点
│   │   ├── ProtectedRoute.tsx# 认证守卫
│   │   └── AppLayout.tsx     # 共享头部 + 内容包装器
│   ├── routes/               # 页面级视图
│   │   ├── PinScreen.tsx     # PIN 认证
│   │   ├── Dashboard.tsx     # 主仪表盘
│   │   └── Settings.tsx      # 设置页面
│   ├── store/
│   │   ├── auth.ts           # Zustand 认证存储（PIN）
│   │   └── settings.ts       # Zustand 设置存储
│   ├── features/             # 领域 API hooks 和功能组件
│   ├── types/
│   │   └── *.ts              # 领域类型
│   ├── lib/
│   │   └── utils.ts          # cn() 类合并工具
│   ├── App.tsx               # 路由定义
│   ├── main.tsx              # 入口点
│   └── index.css             # 设计令牌 + 基础样式
├── Dockerfile                # 多阶段（bun 构建 → nginx）
├── nginx.conf                # SPA 路由回退
└── vite.config.ts
```

## 开发

```bash
bun install
bun run dev        # http://localhost:33696 (HMR)
```

## 构建

```bash
bun run build      # 输出到 dist/
bun run preview    # 预览生产构建
```

## 设计系统

受 Linear 启发的深色主题。所有颜色定义为 `src/index.css` 中的 CSS 变量。

| 变量 | 值 | 用途 |
|----------|-------|-------|
| `--bg` | `#08090a` | 背景 |
| `--surface` | `#101113` | 卡片 / 面板 |
| `--accent` | `#5e6ad2` | Linear 蓝紫色 |
| `--status-active` | `#26d07c` | 智能体活跃点 |
| `--status-idle` | `#62666d` | 智能体空闲点 |

组件通过 `var(--*)` 引用这些变量。

## 认证（PIN）

- 首次 PIN：启动前设置一次 `MYMY_INITIAL_PIN`，不接受默认 PIN。
- PIN 验证由 Rust API 处理。
- 解锁成功后会设置 `mymy_session` HttpOnly cookie。
- `/` 路由由 `ProtectedRoute` 保护，并检查服务端会话状态。

## 设置

`/settings` 路由提供：

- **通用** — PIN 更改
- **模型 / LLM Provider** — provider 注册与连接检查
- **智能体** — 每个智能体的应用数据权限
- **Git 集成** — GitHub/GitLab/Gitea 连接配置
- **关于** — 版本和端口信息

运行时设置由 Rust 后端提供。前端存储只保留可安全本地持久化的 UI 状态。
