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

Windows에서는 저장소의 스크립트로 실행한다. 아래 두 오류를 피하는 설정이 들어 있다.

```powershell
powershell -ExecutionPolicy Bypass -File tools\laya-serve.ps1
```

- 따로 있던 `laya-serve` PyPI 패키지는 아카이브됐다. 서버는 `laya` 본체에 들어 있으므로 `pip install "laya[serve]"`로 설치한다. 명령 이름(`laya-serve`)과 주소는 같다.
- 처음 실행하면 Hugging Face에서 모델(`convaiinnovations/laya`)을 내려받는다.
- 2026-09-29, 이 PC(Windows, GPU 없음, laya 0.3.21)에서 확인했다. 시작에 약 30초가 걸리고, 요청은 첫 번째가 0.9초, 이후 칸당 평균 55ms였다.

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
        "none.location": "학교·회사의 소재지나 지역 선택",
        "…": "이력이 아닌 흔한 칸 (NOT_PROFILE_CHOICES)",
        "unknown": "그 밖에 이력 항목이 아니거나 알 수 없음"
      }
    }
  }
}
```

- 선택지는 이력 항목 약 50개와 "이력 아님" 선택지 9개(`NOT_PROFILE_CHOICES`, `unknown` 포함)다. laya-serve는 질문 하나에 선택지를 최대 100개까지 받는다.
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
- **Laya가 더한 후보:** 규칙에 없던 후보도 Laya 확률이 5% 이상이면 들어간다. 다만 자동 선택은 하지 않는다. "이력 아님" 선택지는 후보로 넣지 않는다.
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

## 실제로 써 본 결과 (incruit.com 기록, 2026-09-29)

칸 135개를 보냈을 때의 결과다.

| 경우 | 칸 수 |
| --- | --- |
| 규칙에 답이 있고 Laya 1순위가 정확히 같음 | 11 |
| 그룹만 같음 (부서·직위·날짜를 모두 "회사명"으로 답하는 식) | 19 |
| 그룹부터 다름 | 42 |
| 규칙에 답이 없고 Laya도 "이력 아님" | 45 |
| 규칙에 답이 없는데 Laya가 이력 항목을 제안 | 18 |

- **판단:** Laya는 "이력 칸인지 아닌지"는 잘 가르지만, 세부 항목은 규칙보다 부정확하다. 가중치 0.5에서 최종 선택이 바뀐 칸은 없었다.
- **이력 아님 선택지:** 선택지에 소재지·본분교·주야·학적 상태·동의 체크·다른 사람 정보 같은 "이력 아님" 항목(`plan.js`의 `NOT_PROFILE_CHOICES`)을 넣는다. 이게 없으면 Laya는 소재지 목록도 "학교명"(99%)으로 답했다.
- **Laya만 제안한 항목:** 규칙에 없고 Laya만 제안한 항목은 추천 목록에 보여 주기만 하고 자동으로 고르지 않는다.

## 가중치 조정

진단 기록에는 칸마다 상위 후보 3개와 비율(`candidates`), 사용자가 실제로 고른 항목(`chosen`)이 남는다. 기록이 쌓이면 이것을 정답 데이터로 삼아 `WEIGHTS`와 `LAYA_WEIGHT`를 맞출 수 있다. 예를 들어 1순위가 틀렸을 때 정답이 몇 순위였는지, 그리고 Laya를 켰을 때와 껐을 때 정답률이 어떻게 다른지 비교한다.

## 문제 해결

- **`UnicodeDecodeError: 'cp949' codec can't decode …` (torch/_inductor):** 한국어 Windows의 기본 인코딩(cp949)으로 PyTorch 파일을 읽다가 난다. `PYTHONUTF8=1`로 실행한다. 스크립트에 들어 있다.
- **`OSError: [WinError 1314] 클라이언트가 필요한 권한을 가지고 있지 않습니다` (huggingface_hub, symlink):** 모델을 받는 중에 심볼릭 링크를 만들 권한이 없어서 난다. 한 번 더 실행하면 링크 대신 복사로 받는다. 계속 나면 Windows 개발자 모드를 켠다.
- **`this checkpoint ships invalid temperatures` 경고:** 모델 쪽 보정값 경고라 무시해도 된다. 대신 Laya가 알려 주는 confidence는 보정되지 않은 값으로 본다.

- **"Laya 연결 실패":** 서버가 떠 있는지, 포트가 8000인지 확인한다. 실패하면 그때까지 받은 칸만 Laya를 반영하고, 나머지는 규칙 순위를 표시한다.
- **401/403 응답:** `LAYA_API_KEY`를 설정했다면 끈다.
- **느림:** 칸마다 요청하므로 칸이 150개면 150번 요청한다. GPU(`LAYA_DEVICE=cuda`)와 `LAYA_PRELOAD=1`을 권장한다.
