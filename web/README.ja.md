# mymy web

mymy のフロントエンド SPA。Vite + React + TypeScript で構築。

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

## 技術スタック

- **Vite 8** + **React 19** + **TypeScript**
- **Tailwind CSS v4**（Vite プラグイン、`@tailwindcss/vite`）
- **React Router** — PIN 認証 → 保護ルート
- **Zustand** — 認証 + 設定状態（`persist` 付き）
- **lucide-react** — アイコン
- **bun** — パッケージマネージャー / ビルドツール

## 構成

```
web/
├── src/
│   ├── components/           # 再利用可能コンポーネント
│   │   ├── settings/         # 設定 UI（Toggle、SectionCard 等）
│   │   ├── AgentAvatar.tsx   # エージェントアバター（一文字フォールバック）
│   │   ├── AgentCard.tsx     # エージェントカード
│   │   ├── StatusDot.tsx     # 活動ステータスドット
│   │   ├── ProtectedRoute.tsx# 認証ガード
│   │   └── AppLayout.tsx     # 共有ヘッダー + コンテンツラッパー
│   ├── routes/               # ページレベルビュー
│   │   ├── PinScreen.tsx     # PIN 認証
│   │   ├── Dashboard.tsx     # メインダッシュボード
│   │   └── Settings.tsx      # 設定ページ
│   ├── store/
│   │   ├── auth.ts           # Zustand 認証ストア（PIN）
│   │   └── settings.ts       # Zustand 設定ストア
│   ├── features/             # ドメイン API hooks と feature コンポーネント
│   ├── types/
│   │   └── *.ts              # ドメイン別の型
│   ├── lib/
│   │   └── utils.ts          # cn() クラスマージユーティリティ
│   ├── App.tsx               # ルーター定義
│   ├── main.tsx              # エントリーポイント
│   └── index.css             # デザイントークン + ベーススタイル
├── Dockerfile                # マルチステージ（bun ビルド → nginx）
├── nginx.conf                # SPA ルーティングフォールバック
└── vite.config.ts
```

## 開発

```bash
bun install
bun run dev        # http://localhost:33696 (HMR)
```

## ビルド

```bash
bun run build      # dist/ に出力
bun run preview    # プロダクションビルドのプレビュー
```

## デザインシステム

Linear にインスパイアされたダークテーマ。すべての色は `src/index.css` の CSS 変数として定義されます。

| 変数 | 値 | 用途 |
|----------|-------|-------|
| `--bg` | `#08090a` | 背景 |
| `--surface` | `#101113` | カード / パネル |
| `--accent` | `#5e6ad2` | Linear ブルーバイオレット |
| `--status-active` | `#26d07c` | エージェントアクティブドット |
| `--status-idle` | `#62666d` | エージェント待機ドット |

コンポーネントは `var(--*)` で参照します。

## 認証（PIN）

- デフォルト PIN：`mymy`
- PIN 検証は Rust API が処理します。
- ロック解除に成功すると `mymy_session` HttpOnly cookie が設定されます。
- `/` ルートは `ProtectedRoute` がサーバーセッション状態を確認して保護します。

## 設定

`/settings` ルートが提供するもの：

- **一般** — PIN 変更
- **モデル / LLM プロバイダー** — provider 登録と接続確認
- **エージェント** — エージェントごとのアプリデータ権限
- **Git 連動** — GitHub/GitLab/Gitea 接続設定
- **情報** — バージョン & ポート情報

ランタイム設定は Rust バックエンドから提供されます。フロントエンドの保存領域には、
ローカル永続化しても安全な UI 状態のみを保持します。
