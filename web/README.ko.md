# mymy web

mymy의 프론트엔드 SPA. Vite + React + TypeScript로 구축.

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

## 기술 스택

- **Vite 8** + **React 19** + **TypeScript**
- **Tailwind CSS v4** (Vite 플러그인, `@tailwindcss/vite`)
- **React Router** — PIN 인증 → 보호된 라우트
- **Zustand** — 인증 + 설정 상태 (`persist` 포함)
- **lucide-react** — 아이콘
- **bun** — 패키지 매니저 / 빌드 도구

## 구조

```
web/
├── src/
│   ├── components/           # 재사용 컴포넌트
│   │   ├── settings/         # 설정 UI (Toggle, SectionCard 등)
│   │   ├── AgentAvatar.tsx   # 에이전트 아바타 (첫글자 폴백)
│   │   ├── AgentCard.tsx     # 에이전트 카드
│   │   ├── StatusDot.tsx     # 활동 상태 점
│   │   ├── ProtectedRoute.tsx# 인증 가드
│   │   └── AppLayout.tsx     # 공유 헤더 + 콘텐츠 래퍼
│   ├── routes/               # 화면 단위 뷰
│   │   ├── PinScreen.tsx     # PIN 인증
│   │   ├── Dashboard.tsx     # 메인 대시보드
│   │   └── Settings.tsx      # 설정 페이지
│   ├── store/
│   │   ├── auth.ts           # Zustand 인증 스토어 (PIN)
│   │   └── settings.ts       # Zustand 설정 스토어
│   ├── features/             # 도메인 API 훅과 feature 컴포넌트
│   ├── types/
│   │   └── *.ts              # 도메인별 타입
│   ├── lib/
│   │   └── utils.ts          # cn() 클래스 병합 유틸
│   ├── App.tsx               # 라우터 정의
│   ├── main.tsx              # 진입점
│   └── index.css             # 디자인 토큰 + 베이스 스타일
├── Dockerfile                # 멀티스테이지 (bun 빌드 → nginx)
├── nginx.conf                # SPA 라우팅 폴백
└── vite.config.ts
```

## 개발

```bash
bun install
bun run dev        # http://localhost:33696 (HMR)
```

## 빌드

```bash
bun run build      # dist/에 출력
bun run preview    # 프로덕션 빌드 미리보기
```

## 디자인 시스템

Linear에서 영감받은 다크 테마. 모든 색상은 `src/index.css`의 CSS 변수로 정의됩니다.

| 변수 | 값 | 용도 |
|----------|-------|-------|
| `--bg` | `#08090a` | 배경 |
| `--surface` | `#101113` | 카드 / 패널 |
| `--accent` | `#5e6ad2` | Linear 블루-바이올렛 |
| `--status-active` | `#26d07c` | 에이전트 활성 점 |
| `--status-idle` | `#62666d` | 에이전트 대기 점 |

컴포넌트는 `var(--*)`로 참조합니다.

## 인증 (PIN)

- 최초 PIN: 시작 전에 `MYMY_INITIAL_PIN`을 한 번 설정하며, 기본 PIN은 허용되지 않습니다.
- PIN 검증은 Rust API가 처리합니다.
- 인증 성공 시 `mymy_session` HttpOnly 쿠키가 설정됩니다.
- `/` 라우트는 `ProtectedRoute`가 서버 세션 상태를 확인해 보호합니다.

## 설정

`/settings` 라우트에서 제공:

- **일반** — PIN 변경
- **모델 / LLM 프로바이더** — provider 등록과 연결 확인
- **에이전트** — 에이전트별 앱 데이터 권한
- **Git 연동** — GitHub/GitLab/Gitea 연결 설정
- **정보** — 버전 & 포트 정보

런타임 설정은 Rust 백엔드에서 제공합니다. 프론트엔드 저장소에는 로컬에
저장해도 안전한 UI 상태만 보관합니다.
