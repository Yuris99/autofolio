# [제안] Laya 기반 Field Classifier / Profile Matcher

> 상태: **검토 중인 의견 (미확정)**
> 작성일: 2026-09-25
> 관련: README 7장 "AI 사용 원칙", 8장 "로컬 AI"(후보: Laya 계열), 13장 "검증 및 안전장치"

필드 의미 추론과 이력 선택에 생성형 LLM 대신 **Laya(비생성형 결정 모델)** 를 사용하는 안.

---

## 배경

AutoFolio의 AI 작업은 대부분 "이 빈칸에 어떤 이력을 넣을지" 고르는 **분류/선택** 문제다.
텍스트를 생성할 필요가 없으므로 생성형 LLM은 과하다.

- 출력 토큰이 없어 비용·지연이 낮다.
- 출력이 "주어진 후보 중 하나 + 확률"이므로 **존재하지 않는 이력을 만들어낼 수 없다** (13장 원칙 1, 2).
- 보정된(calibrated) 확률로 "확신 낮으면 사용자 확인"(13장 원칙 3)을 임계값으로 구현할 수 있다.

## Laya 요약 (2026-09 기준)

- Convai Innovations의 오픈 웨이트 **비자기회귀 결정 모델**. LLM이 아님.
  양방향 인코더 + 결정 헤드, 한 번의 forward pass로 답을 냄 (텍스트 생성 없음).
- 2026-09-18 Hugging Face 공개, **Apache 2.0**.
- 입력: state(텍스트/JSON) + 타입이 있는 질문
  - `choice`: 후보 중 하나 선택 + 전체 확률 분포 + 보정된 confidence
  - `score`: 서열 척도 점수
  - boolean: P(true)
- **후보(`criteria`)를 추론 시점에 매번 지정 가능** → 스키마 키, 보유 자격증 목록 등을 그때그때 전달.
- 속도: 단일 GPU 기준 약 33ms (배치 시 질문당 약 7ms).
- 체크포인트 (한 HF 저장소, `allow_patterns`로 선택 다운로드)

| 체크포인트 | 백본 | 파라미터 | 비고 |
|---|---|---|---|
| `convaiinnovations/laya` | ModernBERT-large | 421M | 영어 |
| `convaiinnovations/laya-multilingual` | mmBERT-base | 322M | 100+ 언어 → **한국어 후보** |
| `convaiinnovations/laya-typed-decisions` | ModernBERT-large | 421M | 타입 결정 특화 |

- 사용 예 (Python):

```python
# pip install "laya>=0.3.3"
from laya import Router

router = Router(preload=True)
res = router.predict(state, questions)
```

## AutoFolio 적용 방식

```text
state   = 필드 컨텍스트 (label, placeholder, section title, 주변 텍스트, name/id, 필드 타입)
question = choice
criteria = { "Education.school": "최종 학교명, 대학교명, 출신학교",
             "Education.major":  "전공, 학과",
             "Personal.phone":   "휴대전화, 연락처",
             ...,
             "none": "해당 없음 / 입력하지 않음" }
        ↓
top-1 확률 ≥ 임계값 → 자동 매핑
그 외               → 사용자 확인 (또는 생성형 LLM / Stagehand observe 폴백)
```

이력 선택(6.4)도 같은 방식: "자격사항 1" 필드 컨텍스트 + 보유 자격증 목록을 `criteria`로.

## AI 전략 세분화

```text
규칙 기반
  ↓ 실패
사이트 캐시
  ↓ 실패
Laya choice (로컬, 저비용, 환각 없음)
  ↓ 확률 낮음
생성형 LLM / Stagehand observe  또는  사용자 확인
```

## 주의할 점

- **제로샷 성능이 낮고 도메인 파인튜닝이 필요하다고 명시됨.**
  → 타깃 사이트 필드 덤프로 소량 라벨 데이터(필드 컨텍스트 → 스키마 키)를 만들어 파인튜닝/평가 필요.
- **후보 20개 이상에서 성능 저하.**
  → 스키마 키 전체를 한 번에 넣지 말고, 섹션(인적사항/학력/자격증...)으로 먼저 좁힌 뒤 선택하는 2단계 구조 고려.
- **Python 전용** (ONNX/JS 지원 언급 없음).
  → Stagehand(TS)와 함께 쓰려면 로컬 Python 추론 서버(예: localhost HTTP)로 분리.
- 한국어 채용 용어 품질은 multilingual 체크포인트로 직접 검증 필요.
- 공개된 지 얼마 안 된 모델이라 API/패키지 변경 가능성 있음.

## 검증할 것

1. `laya-multilingual` 로컬 실행 (Mac, CPU/MPS 속도)
2. 타깃 사이트 필드 덤프로 라벨 데이터셋 소량 구성
3. 제로샷 정확도 → 파인튜닝 후 정확도 비교, 임계값 설정
4. 섹션 선분류 → 키 선택 2단계 구조 효과
5. 한국어 용어(최종학교, 졸업(예정)일, 공인어학시험 등) 처리 품질

## 참고

- [Laya 공식 페이지](https://laya.convaiinnovations.com/)
- [Laya Explained: A Decision Model With Zero Output Tokens](https://www.orcarouter.ai/blog/laya-decision-model-explained)
- [Laya AI: the open 33ms decision model that can't hallucinate](https://www.eesel.ai/blog/laya-ai)
- 관련 제안: [stagehand-v4.md](stagehand-v4.md)
