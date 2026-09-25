# 사이트 분석: recruiter.co.kr (마이다스 계열 채용 솔루션)

> 조사일: 2026-09-25
> 조사 대상: HD현대 26년 하반기 신입사원 채용 (`hd.recruiter.co.kr/mrs2/applicant/resume/writeResume`)
> 방법: `pnpm dump` 필드 덤프 (읽기 전용). 원본 덤프는 `data/dumps/`(gitignore)에 있음.

같은 솔루션을 쓰는 다른 회사(`<회사>.recruiter.co.kr`)에도 구조가 비슷할 것으로 예상 — 검증 필요.

---

## 지원서 구성

한 URL(`writeResume`) 안에서 단계가 바뀌는 구조. 상단 탭 `button[data-step=1..5]`.

1. 기본정보
2. 학력/연구/경력/NCS
3. 어학/자격/기타
4. 자기소개서/역량기술서
5. 최종제출

- **현재 단계의 필수 항목을 채워야 다음 단계로 이동 가능.**
- 하단 버튼: `임시저장`, `다음`.
- 봇 방지: invisible reCAPTCHA 존재.

## 공통 특징

- **`name` 속성이 의미를 그대로 담고 있음** → 대부분 규칙 기반 매핑 가능.
  예: `birthday`, `currentAddress.zipCode`, `military.militaryStartDate`, `college[0].score`
- **반복 그룹은 인덱스 표기**: `college[0]`, `college[0].collegeMajor[0]`, `career[0]`, `applySector[1]`.
  행 추가는 "추가" 버튼.
- **날짜**: `input[type=text].date.start` / `.date.end` (달력 선택기).
  - 형식 힌트 속성 `data-dates="<필드>:YMD"` 또는 `:YM`. **칸마다 형식이 다름** — 복무기간은 `YYYY.MM`(7자), 생년월일/취득일은 연월일.
  - 구분자는 `.` (채워진 값 모양 `9999.99`로 확인).
- **제목 구조가 평평함**: "연락처" 제목 아래에 장애여부·보훈여부·병역사항 섹션이 이어짐 → 상위 제목을 그대로 쓰면 오분류
  (라디오 그룹은 가장 가까운 섹션 제목만 보도록 처리).
- 주소 칸 앞 텍스트에 입력된 우편번호 값이 텍스트로 표시됨 → 필드 주변 텍스트에 개인정보가 섞일 수 있음 (덤프는 로컬 전용).
- **`required` 표시를 신뢰할 수 없음**: 대학원 필드도 모두 required로 표시됨 (조건부 필수로 추정).
- **라디오 값은 코드**: 예) 졸업구분 `01=졸업, 02=졸업예정, 03=수료, 04=중퇴, 05=휴학, 07=재학, 08=검정고시`.

## 1단계: 기본정보

- 이름: 입력 필드 아님 (계정 정보로 표시).
- `genderFlag` (M/F), `birthday`
- 지원분야 1·2지망 `applySector[n].depth0~3`: **연쇄 select** (회사 → 직무 대분류 → 소분류 → 지역). 앞 선택 후 뒤 옵션이 로드됨.
  → 프로필 값이 아니라 **지원마다 사용자에게 확인**.
- 지원경로 `applyChannel.applyChannelCodeSn` (+ 기타 선택 시 `applyChannel.textInput`) → 지원마다 확인.
- 사진: file 업로드 + `pictureFile`.
- 국적 `nationality` (select, 246개).
- 주소: `currentAddress.zipCode`, `currentAddress.address`(readonly), `currentAddress.detailAddress` → **우편번호 검색 팝업** 경유.
- 장애 `handicap.*`, 보훈 `patriot.*`, 병역 `military.*` (조건부 필드: 면제사유, 제대 직접입력 사유).

## 2단계: 학력/연구/경력/NCS

- 고등학교 `highschool.*`, 대학교 `college[n].*`, 대학원 `graduateSchool[n].*`
- **학교/전공은 검색형 UI** (아래 참조). 실제 값은 hidden 코드 필드:
  - `college[0].academyCode` (학교 코드)
  - `college[0].collegeMajor[0].majorCode` (전공 코드)
- 학위구분, 입학구분(입학/편입), 졸업구분, 본교/분교, 주간/야간 라디오.
- 학과계열 `collegeCategoryCode`, 전공계열 `majorCategoryCode` select.
- 학점: `college[0].score` (number) + `college[0].perfectScore` (select: 3.0 ~ 100).
- 성적증명서 file 첨부.
- 연구실적 예/아니오: `paper.existYn`, `researchPaper.existYn`, `researchPresent.existYn`, `researchInvolve.existYn`, `researchWriting.existYn`.
- 경력 `career[n].*`: 고용형태, 회사명, 직원수, 재직/퇴사, 기간, 부서, 직급, 담당업무, 매출액, 퇴직사유.
- 경험 및 경력기술서 `experienceBuilder.textInput` (textarea).

### 검색형 UI (학교·전공)

```text
input[placeholder='키워드 입력 후 "Enter"로 검색']  ← 키워드 입력 후 Enter
        ↓
div.search.searched
  └ div.searchResult (position:absolute 레이어)
      └ ul.searchResultList
          └ li > button[data-code][title]
              예) data-code="572"  title="숭실대학교"
                  data-code="9744" title="숭실대학교 대학원"
```

검색 입력칸 속성: `input[type=search][data-type=college][data-rel-target="college[0]"]`
→ `data-rel-target`으로 어느 반복 그룹에 속한 검색칸인지 알 수 있음.

선택 후 확인된 동작 (2026-09-25, 실제 선택으로 검증):

- 결과 버튼 클릭 → hidden `college[0].academyCode`에 해당 `data-code` 값이 들어감 ✅
- 검색 입력칸에는 **입력한 키워드("숭실대")가 그대로 남음** (학교 전체 이름으로 바뀌지 않음)
  → 검증은 검색칸 텍스트가 아니라 **hidden 코드 필드 값**으로 해야 함
- 결과 레이어는 선택 후 숨겨짐
- 학교소재지(`locationCode`)는 자동 선택되지 않음 → 별도 입력 필요

자동 입력 전략:

1. 검색어 입력 + Enter
2. `button[title]`이 프로필 값과 **정확히 일치**하면 클릭 → hidden 코드 필드 채워짐(검증 필요)
3. 정확히 일치 없음 / 복수 후보 → Laya choice 또는 사용자 확인

## 3단계: 어학/자격/기타

- **공인외국어시험**: 검색형 UI → hidden `languageExam[0].languageExamCode`
  - 섹션 제목에 유효 조건: "공인외국어시험 **24.09.27 이후 점수만 인정**"
    → 프로필에 성적이 여러 개면 취득일로 필터링 필요 (README 6.4 "조건에 맞는 이력 선택" 사례)
- **외국어활용능력** `languageSkill[0].*`: 언어 select(35개) + 회화/작문/독해 수준 select
  (Authentic / Advanced / Intermediate / Basic / Beginner)
- **자격증/면허증**: 검색형 UI → hidden `license[0].licenseCode`
  - 추가 입력: `license[0].organization`(발급기관), `license[0].registNumber`(**등록번호**), `license[0].acquireDate`(취득일)
- **수상경력** `award[0].*`: awardName, organization, awardDate, comment(수상내역)
- **학내외 활동** `activity[0].*`: activityCategorySn(select: 동아리활동/연구회/팀 프로젝트/온라인 커뮤니티/재능기부 활동/기타사회활동), organization, startDate, endDate, role, contents
- 자격증 검색 결과도 학교와 **동일한 구조** 확인 (`input[type=search][data-type=license]`, 어학은 `data-type=foreignExam`)
  - 결과 버튼 추가 속성: `data-usescore`, `data-privateinfo` (true/false)
    → 선택 시 점수/등록번호 입력 필드 노출 여부를 결정하는 것으로 추정 (확인 필요)
  - "정보처리" 검색 결과 순서: 정보처리**기능사**, 기능장, **기사**, 기술사, 산업기사, …
    → **첫 번째 결과나 부분 일치로 고르면 틀린 자격증이 선택됨.** 반드시 title 정확 일치 우선.
- 이 단계에서는 텍스트가 있는 "추가" 버튼이 수집되지 않음 → 아이콘형 버튼일 가능성 (확인 필요)

### 이력 스키마에 반영할 점 (README 6.1 대비)

- Certificates: **등록번호** 추가
- Languages: 취득일 필수 (유효기간 필터링용)
- Awards: 상세 내역(comment) 추가
- Activities: 활동 구분(category), 역할(role) 추가
- 신규: Military(병역), Patriot(보훈), Handicap(장애), Nationality, Research(논문/연구 실적 유무), Career(경력)

## 4단계 이후

- (미조사)
