# Laya 사용법

AutoFolio는 칸마다 "어느 이력 항목을 넣을지" 후보 순위를 만든다. Laya는 이 순위를 보정하는 **선택 사항**이다. 켜지 않아도 규칙 순위와 수동 선택은 그대로 작동한다.

## Laya란

[Laya](https://github.com/NandhaKishorM/laya)([PyPI](https://pypi.org/project/laya/))는 로컬에서 돌리는 분류 모델이다. 질문과 선택지를 주면 문장을 생성하지 않고, 한 번의 계산으로 **선택지마다 확률**을 돌려준다. `laya-serve`는 TypeSafe Jev API와 같은 형식의 HTTP 서버(`POST /v1/systemone`)를 연다([choice 형식](https://docs.typesafe.ai/primitives/choice)).

## 설치와 실행

```sh
pip install "laya[serve]"
laya-serve
```

기본 주소는 `0.0.0.0:8000`이다. AutoFolio는 `http://127.0.0.1:8000/v1/systemone`으로 요청한다. 서버 설정은 환경 변수로 한다.

| 변수 | 용도 |
| --- | --- |
| `LAYA_HOST`, `LAYA_PORT` | 주소와 포트 (기본 `0.0.0.0`, `8000`) |
| `LAYA_DEVICE` | `cuda`면 GPU 사용 (없으면 CPU, 더 느림) |
| `LAYA_PRELOAD` | `1`이면 시작할 때 모델을 미리 불러옴 |
| `LAYA_MODELS`, `LAYA_THREADS` | 사용할 모델, CPU 스레드 수 |
| `LAYA_API_KEY` | 요청에 키를 요구함. **AutoFolio는 키를 보내지 않으므로 설정하지 않는다** |

Windows PowerShell 예:

```powershell
$env:LAYA_DEVICE = "cuda"; $env:LAYA_PRELOAD = "1"; laya-serve
```

처음 실행하면 모델을 내려받는 데 시간이 걸릴 수 있다. 이 문서는 공개 문서를 바탕으로 정리했다. 이 PC에서 직접 설치해 돌려 보지는 않았다.

## AutoFolio에서 켜기

1. `laya-serve`를 실행한다.
2. 확장 팝업에서 **로컬 Laya로 후보 순위 보정**을 켠다.
3. **현재 페이지 분석**을 누른다. 상태 줄에 `Laya로 순위를 매기는 중 (n/전체)`가 표시되고, 끝나면 칸마다 추천 순위가 Laya를 반영해 다시 정렬된다.

- 이 사이트에서 이미 확인한 매핑이 있는 칸은 Laya에 묻지 않는다.
- 나뉜 칸(010 | 1234 | 5678)은 첫 칸만 묻는다.
- 주소를 바꾸려면 `extension/popup.js`의 `LAYA_URL`과 `extension/manifest.json`의 `host_permissions`를 함께 바꾼다. 확장 페이지는 `host_permissions`에 적힌 주소로만 요청할 수 있다.

## 보내는 내용

칸 하나에 요청 하나를 보낸다. **저장된 이력 값은 보내지 않고, 칸의 설명만 보낸다.**

```json
{
  "state": {
    "section": "금융보안원 입사지원서", "label": "* 현주소", "placeholder": "", "title": "",
    "name": "Zipcode2", "inputType": "text", "options": [],
    "nearby": ["* 생년월일", "* 현주소", "* 휴대폰"]
  },
  "questions": {
    "field": {
      "type": "choice",
      "instructions": "이 채용 지원서 입력칸에 넣을 지원자 이력 항목은?",
      "criteria": {
        "personal.name": "지원자 인적사항의 이름",
        "personal.zipCode": "지원자 인적사항의 우편번호",
        "…": "이력 항목마다 하나 (matcher.js의 PROFILE_SCHEMA)",
        "unknown": "이력 항목이 아님, 또는 알 수 없음"
      }
    }
  }
}
```

- 선택지는 이력 항목 약 50개와 `unknown`이다. laya-serve는 질문 하나에 선택지를 최대 100개까지 받는다.
- `options`는 선택창·라디오의 선택지 글자 최대 12개다. `nearby`는 앞뒤 칸의 라벨이다.

## 받는 내용과 쓰는 방법

```json
{ "answers": { "field": { "type": "choice", "choice": "personal.zipCode", "confidence": 0.9,
  "probabilities": { "personal.zipCode": 0.93, "personal.address": 0.05, "unknown": 0.01, "…": 0.0 } } } }
```

`probabilities`(합 1)를 규칙 점수와 가중치로 합쳐 순위를 다시 매긴다(`plan.js`의 `combineRanks`).

```
최종 점수 = (1 − w) × 규칙 점수 비율 + w × Laya 확률        (w = LAYA_WEIGHT, 기본 0.5)
```

- **규칙 점수 비율:** 칸의 후보 점수를 합이 1이 되게 나눈 값이다.
- **Laya가 더한 후보:** 규칙에 없던 후보도 Laya 확률이 5% 이상이면 들어간다. `unknown`은 후보로 넣지 않는다.
- **응답 형식이 다를 때:** `probabilities`가 없고 `choice`만 오면 그 항목을 확률 1로 본다.

## 규칙 점수 (Laya 없이도 쓰는 부분)

`matcher.js`의 `rank()`가 칸 주변의 단서마다 점수를 더한다. 가중치는 `WEIGHTS`에 있다.

| 단서 | 가중치 |
| --- | --- |
| 규칙의 최종 판단 (`classify`) | 10 |
| 라벨·행 제목, 입력 예시(`abc@xxx.com`) | 3 |
| 내부 이름의 마지막 부분 (`Ftest1Hscore` → `Ftest Hscore`) | 2 |
| 내부 이름 전체 | 1 |
| 같은 단서가 가리키는 2순위 이하 항목 | 위 가중치 × 0.4 |

- **단어 나누기와 합치기:** 내부 이름은 단어로 나누고(`NcsCareerEDate` → `Ncs Career E Date`), 이웃 단어를 합친 형태(`EDate`, `CareerE`)도 같이 본다.
- **이웃 칸 규칙:** `plan.js`의 `refineRanks`가 후보를 더한다.
  - 이름이 비슷한 앞 칸과 같은 그룹으로 본다(`Ftest11Hscore` → `Ftest11Number`는 어학 수험번호).
  - 라벨 없는 기간 칸은 바로 위 학력·경력·병역 블록의 날짜로 본다.
  - 같은 라벨의 두 번째 기간 칸은 종료일로, 두 번째 주소 칸은 상세주소로 본다.
- **추천 표시:** 팝업은 후보 상위 3개(`TOP_CANDIDATES`)의 저장 값을 "추천 순위"로 먼저 보여 준다. 저장 값이 있는 가장 높은 후보를 기본으로 고른다.

## 가중치 조정

진단 기록에는 칸마다 상위 후보 3개와 비율(`candidates`), 사용자가 실제로 고른 항목(`chosen`)이 남는다. 기록이 쌓이면 이것을 정답 데이터로 삼아 `WEIGHTS`와 `LAYA_WEIGHT`를 맞출 수 있다. 예를 들어 1순위가 틀렸을 때 정답이 몇 순위였는지, 그리고 Laya를 켰을 때와 껐을 때 정답률이 어떻게 다른지 비교한다.

## 문제 해결

- **"Laya 연결 실패":** 서버가 떠 있는지, 포트가 8000인지 확인한다. 실패하면 그때까지 받은 칸만 Laya를 반영하고, 나머지는 규칙 순위를 표시한다.
- **401/403 응답:** `LAYA_API_KEY`를 설정했다면 끈다.
- **느림:** 칸마다 요청하므로 칸이 150개면 150번 요청한다. GPU(`LAYA_DEVICE=cuda`)와 `LAYA_PRELOAD=1`을 권장한다.
