# [제안] Stagehand v4 기반 구조

> 상태: **검토 중인 의견 (미확정)**
> 작성일: 2026-09-25
> 관련: README 9장 "브라우저 자동화 방식", 18장 "아직 결정하지 않은 것"

Playwright 대신 Stagehand v4를 브라우저 계층으로 사용하는 안.
확정된 결정이 아니며, MVP 스파이크 결과를 보고 판단한다.

---

## Stagehand v4 요약 (2026-09 기준)

- Browserbase의 AI 브라우저 자동화 SDK. MIT 라이선스. TS / Python / Go SDK.
- 최신 안정 버전 4.1.0 (4.2는 알파). 변경이 잦으므로 도입 시 버전 고정 필요.
- 코어가 브라우저 확장으로 동작 (브라우저를 소유하지 않고 옆에서 실행).
- 로컬 Chrome 실행 지원. 쿠키가 `./browser-data`에 유지되어 로그인 재사용 가능.
  기존 브라우저 연결은 `localBrowser.connect()`.
- Playwright 스타일 API 제공: `goto`, `click`, `type`, `locator`, `screenshot`.
- AI 기능: `act()`, `observe()`, `extract()`.
- `observe()`는 selector가 포함된 `Action` 객체를 반환하며, `act(action)`으로 넘기면 **LLM 호출 없이 재실행**된다.
- 커스텀 LLM 콜백 지원: `model: { generate: fn }` → Ollama 등 로컬 모델 연결 가능, Browserbase 키 불필요.

## README 원칙과의 적합성

| 원칙 | 평가 |
|---|---|
| Rule First, AI When Needed | ✅ Playwright 스타일 API로 규칙 기반 입력 가능 |
| 사이트 캐시 (15장) | ✅ `observe()` → `Action` 저장 → `act(action)` 재실행 |
| | ⚠️ 내장 `cache: true`는 Browserbase 클라우드 전용. 로컬에서는 직접 캐시를 구현해야 함 |
| Local First | ✅ 로컬 브라우저 + 커스텀 로컬 LLM으로 외부 전송 없이 구성 가능 |
| | ⚠️ 로컬 소형 모델이 Stagehand의 JSON schema 출력을 안정적으로 내는지 검증 필요 |
| Chrome Extension 방향 | ✅ v4 자체가 확장 기반이라 전환이 자연스러움 |

## 제안 구조

```text
Page Analyzer    ← Stagehand page/locator로 DOM·label 수집 (LLM 없음)
Field Classifier ← 규칙 → 사이트 캐시 → observe() (로컬 LLM)
Form Filler      ← 규칙 매핑은 page API, 캐시된 Action은 act(action) 재실행
Validator        ← DOM 값 재확인
Site Cache       ← observe로 얻은 Action을 사이트별 JSON으로 저장
```

- 언어: TypeScript (Stagehand 1순위 SDK, Chrome Extension 전환 시 재사용)

## 검증할 것 (스파이크)

1. `@browserbasehq/stagehand@4.1` 로컬 실행 확인
2. 타깃 지원서 페이지에서 비교
   - 직접 수집한 필드 덤프 (LLM 없음)
   - `observe()` 결과 — Claude vs 로컬 Qwen(Ollama)
3. 저장한 `Action`을 다음 방문에서 LLM 없이 재실행할 수 있는지

## 참고

- [Introducing Stagehand v4](https://www.browserbase.com/changelog/stagehand-v4)
- [GitHub: browserbase/stagehand](https://github.com/browserbase/stagehand)
- [Docs: Models](https://docs.stagehand.dev/v4/configuration/models)
- [Docs: Caching](https://docs.stagehand.dev/v4/best-practices/caching)
- [Docs: Observe](https://docs.stagehand.dev/v4/basics/observe)
