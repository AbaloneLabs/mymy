# QA 체크리스트

이 체크리스트는 native agent 구현 페이즈와 최근 LLM provider 표시 수정의 동작 확인용이다. 실제 API 키, 실제 등록된 provider, 실제 파일/도구 결과만 사용하고 샘플 데이터는 만들지 않는다.

## 1. 기본 환경

- [ ] `docker compose ps`에서 `db`, `api`, `web` 서비스가 실행 중이다.
- [ ] `GET /api/health`가 `ok`를 반환한다.
- [ ] 웹 앱이 `http://localhost:33696`에서 열린다.
- [ ] PIN 잠금/해제가 정상 동작한다.
- [ ] 브라우저 콘솔에 반복되는 401/500 오류가 없다.

## 2. LLM Provider

- [ ] Settings의 Models 탭에서 등록된 provider 목록이 보인다.
- [ ] 새 provider를 실제 API 키로 등록할 수 있다.
- [ ] API 키는 전체 값이 다시 노출되지 않고 masked hint만 보인다.
- [ ] provider 테스트 성공 시 `OK · Nms`처럼 실제 latency 숫자가 표시된다.
- [ ] provider 테스트 실패 시 실제 오류 메시지가 한국어 prefix와 함께 표시된다.
- [ ] 기본 provider 지정이 저장되고 새로고침 후에도 유지된다.
- [ ] provider enable/disable 상태가 저장되고 agent 실행에 반영된다.
- [ ] 모델 목록 조회가 가능한 provider에서는 실제 모델 목록이 표시된다.

## 3. Chat / Agent Loop / Streaming

- [ ] 새 chat session을 생성할 수 있다.
- [ ] 메시지를 보내면 native agent가 Hermes 없이 응답한다.
- [ ] 응답 text delta가 streaming으로 점진 표시된다.
- [ ] 최종 assistant message가 DB에 저장되고 새로고침 후에도 보인다.
- [ ] tool call이 발생하면 UI에 tool 실행 상태와 결과가 표시된다.
- [ ] provider가 없거나 disabled 상태일 때 사용자가 이해 가능한 오류가 표시된다.
- [ ] 긴 대화에서도 context 관리가 동작하고 서버가 panic 없이 응답한다.

## 4. Core Tools

- [ ] terminal tool이 허용된 안전 명령을 실행하고 stdout/stderr/exit code를 반환한다.
- [ ] file read가 허용된 파일 내용을 읽는다.
- [ ] file write/edit/patch가 허용된 경로에만 적용된다.
- [ ] search files가 실제 workspace 파일을 검색한다.
- [ ] web extract/search 계열이 설정된 backend 조건에서 실패 없이 결과 또는 명확한 오류를 반환한다.

## 5. Approval / Security

- [ ] 위험한 shell command는 즉시 실행되지 않고 approval 요청으로 멈춘다.
- [ ] approval 승인 후 해당 tool call이 계속 진행된다.
- [ ] approval 거절 후 agent가 거절 결과를 인식하고 다음 응답을 만든다.
- [ ] 민감 경로 읽기/쓰기 시도가 차단되거나 audit trail에 남는다.
- [ ] terminal 출력, HTTP 결과, 오류 메시지에 API key/token 원문이 노출되지 않는다.
- [ ] audit log에서 보안 관련 action을 확인할 수 있다.

## 6. Skills

- [ ] Settings의 Skills 섹션에서 native skill 목록을 조회할 수 있다.
- [ ] skill 상세 내용을 열람할 수 있다.
- [ ] skill 저장/수정/삭제가 실제 backend에 반영된다.
- [ ] agent prompt 또는 tool 호출에서 skill 목록이 사용 가능하다.
- [ ] 잘못된 skill 파일/metadata는 서버 오류 대신 사용자에게 명확한 실패로 표시된다.

## 7. Cron / Scheduler

- [ ] cron job을 생성할 수 있다.
- [ ] once schedule이 지정 시간 이후 한 번만 실행된다.
- [ ] interval schedule이 반복 실행된다.
- [ ] 실행 결과가 저장되고 UI/API에서 조회된다.
- [ ] 실패한 job은 오류 내용을 남기고 scheduler 전체를 중단시키지 않는다.
- [ ] no-agent/script 성격의 job은 LLM 없이 실행 결과를 저장한다.

## 8. Additional Agent Tools

- [ ] todo tool이 현재 session 안에서 checklist 상태를 유지한다.
- [ ] clarify flow가 agent 응답을 멈추고 사용자 입력을 기다린다.
- [ ] clarify 답변 후 agent가 같은 흐름을 이어간다.
- [ ] session search가 기존 chat message에서 실제 결과를 찾는다.
- [ ] delegate 성격의 tool 호출이 격리된 실행 결과 요약을 반환한다.

## 9. MCP

- [ ] MCP server 설정을 추가할 수 있다.
- [ ] stdio MCP server가 시작되고 tool discovery가 수행된다.
- [ ] 등록된 MCP tool이 agent tool registry에 노출된다.
- [ ] MCP tool 호출 결과가 agent 응답에 반영된다.
- [ ] 실패한 MCP server는 명확한 상태/오류를 표시하고 앱 전체를 중단시키지 않는다.

## 10. Code Execution / Sandbox

- [ ] code execution tool이 간단한 실제 코드를 실행한다.
- [ ] 실행 stdout/stderr/exit code가 agent에 반환된다.
- [ ] timeout이 걸리는 코드는 제한 시간 후 중단된다.
- [ ] sandbox RPC를 통해 builtin tool 호출이 가능하다.
- [ ] 실행 결과에 민감정보가 포함되면 redaction이 적용된다.
- [ ] agent file tool은 `/drive/agents/<profile>`, `/drive/shared`, 연결된 `/drive/projects/<project>` 밖의 경로를 거부한다.
- [ ] 다른 agent의 private workspace 경로 읽기/쓰기 시도가 차단된다.
- [ ] agent 생성 시 Drive workspace와 `AGENTS.md`, `SOUL.md`가 생성된다.
- [ ] agent 삭제 시 workspace가 즉시 영구 삭제되지 않고 복구 가능한 위치로 이동된다.

## 10-1. Drive / Preview

- [ ] Drive 탭이 재무 탭 아래에 표시된다.
- [ ] `/drive` 루트에 `agents`, `projects`, `shared` 폴더가 표시된다.
- [ ] Drive에서 폴더 생성, 텍스트 파일 저장, 삭제가 실제 backend에 반영된다.
- [ ] markdown 파일은 편집기와 preview가 함께 동작한다.
- [ ] docx 파일은 텍스트 preview로 열람된다.
- [ ] jpg/png/webp 이미지가 뷰어에서 열린다.
- [ ] mp4/webm 영상과 mp3/wav/ogg 오디오가 브라우저 컨트롤로 재생된다.
- [ ] PDF가 iframe 뷰어에서 열린다.
- [ ] `/drive/../...` 같은 path traversal 시도는 400으로 거부된다.
- [ ] preview endpoint는 loopback target만 등록된다.
- [ ] `register_preview` tool이 현재 agent/profile에 preview를 등록한다.
- [ ] 등록된 preview URL이 새 창에서 열린다.

## 11. Runtime Optimizations

- [ ] provider rate-limit/cooldown 상태가 저장되고 UI에 표시된다.
- [ ] cooldown 상태의 credential/provider는 즉시 재사용되지 않는다.
- [ ] 사용 가능한 credential/provider가 있으면 agent가 계속 진행한다.
- [ ] MoA preset을 생성/수정/삭제할 수 있다.
- [ ] MoA preset 실행 시 실제 등록된 provider만 사용된다.

## 12. Journey / Advanced Skills

- [ ] Journey 페이지가 열린다.
- [ ] skill/memory 관련 node 또는 항목이 실제 backend 데이터 기준으로 표시된다.
- [ ] 항목 수정/삭제가 backend에 반영된다.
- [ ] 데이터가 없으면 빈 상태가 표시되고 fake/sample 항목은 보이지 않는다.

## 13. Extensions / Plugin System

- [ ] Settings의 Extensions 섹션에서 extension 목록을 조회할 수 있다.
- [ ] webhook extension을 실제 endpoint 정보로 등록할 수 있다.
- [ ] script extension을 실제 local script 기준으로 등록할 수 있다.
- [ ] extension 설정값은 민감정보 원문을 다시 노출하지 않는다.
- [ ] extension test가 성공/실패 상태와 오류를 명확히 표시한다.
- [ ] enabled extension만 agent tool registry에 노출된다.

## 14. i18n / 표시 회귀

- [ ] 한국어 UI에서 `{ms}`, `{count}`, `{name}` 같은 placeholder가 그대로 보이지 않는다.
- [ ] 영어/일본어/중국어로 전환해도 placeholder가 그대로 보이지 않는다.
- [ ] LLM provider test 성공 메시지가 모든 언어에서 실제 숫자를 표시한다.
- [ ] 삭제 확인 메시지에 실제 provider/skill/항목 이름이 들어간다.
- [ ] 검색 결과 수, audit pagination, message count가 실제 숫자로 표시된다.

## 15. 빌드 / 정적 검증

- [ ] `git diff --check`가 통과한다.
- [ ] `docker compose config --quiet`가 통과한다.
- [ ] `web/`에서 `bun install --frozen-lockfile`이 통과한다.
- [ ] `web/`에서 `bun audit`이 통과한다.
- [ ] `web/`에서 `bun run lint`가 통과한다.
- [ ] `web/`에서 `bun run build`가 통과한다.
- [ ] `api/`에서 `cargo fmt --all -- --check`가 통과한다.
- [ ] `api/`에서 `cargo clippy -- -D warnings`가 통과한다.
- [ ] `api/`에서 `cargo test`가 통과한다.
- [ ] push 후 GitLab CI pipeline이 success로 끝난다.

## 16. 제외된 페이즈 확인

- [ ] Phase 14 Browser Automation 기능은 아직 구현 완료 범위로 표시하지 않는다.
- [ ] Phase 16 Multimodal 기능은 아직 구현 완료 범위로 표시하지 않는다.
- [ ] Phase 18 Tool Providers 기능은 아직 구현 완료 범위로 표시하지 않는다.
- [ ] Phase 21 Messenger Channels 기능은 아직 구현 완료 범위로 표시하지 않는다.
