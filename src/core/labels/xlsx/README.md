# 전문가 엑셀 읽기 (core/labels/xlsx)

전문가가 OmniPC 로 판독해 적은 엑셀(기록양식 v1)을 라벨 기록으로 바꿉니다. 순수 Node 이고 새 의존성이 없습니다(ZIP 은 `node:zlib`). 저장은 하지 않습니다.

## 쓰는 법

```ts
import { makeFileFinder, parseLabelWorkbook } from '@core/labels/xlsx'

const finder = makeFileFinder(files.map((f) => ({ names: [f.fileName, f.deviceFileName], file: f.info })))
const r = parseLabelWorkbook(buffer, { findFiles: finder.findFiles, findFileBySha256: finder.findFileBySha256, pcId, now: new Date() })
if (r.ok) save(r) // r.records · r.reviews · r.events · r.alignments · r.physicalDefects
else show(r.errors, r.warnings, r.groupQuestions)
```

- `ok` 가 거짓이면 저장하지 않습니다. 나머지 값은 미리보기용입니다.
- 오류·경고에는 시트·행·칸 위치가 붙습니다. 예: `'지시' 시트 7행 M열 '실제 깊이 아래 (mm)': 그 파일 두께(12 mm)보다 클 수 없습니다`.
- 같은 기법·스큐 그룹이 한 파일에 둘 이상이면 `groupQuestions` 에 물음이 남습니다. 답을 `groupChoices`(`'sha256|sect-90'` → 그룹 id)로 넣어 다시 부릅니다.
- 엑셀 파일명이 앱 파일 둘 이상과 맞고 SHA-256 칸이 비면 `fileQuestions` 에 물음이 남습니다. 답은 `fileChoices`(`fileNameKey(파일명)` → sha256)입니다. 물음에서 난 오류 수는 `questionErrors` 입니다(화면은 이 오류를 '고를 것'으로 따로 보입니다). 어떻게 맞췄는지는 `fileMatch`(sha256 / name / choice).
- 파일의 그룹을 읽지 못했으면(`LabelWorkbookFile.groupsError`, 저장된 사본 없음 등) '그룹' 칸 줄은 '그룹이 없음' 대신 그 이유로 오류가 됩니다.
- `versionSlot` 을 주면 versions 의 칸을 그 값('PC ID:복제본 ID')으로 씁니다. 기록의 pcId 는 `pcId` 그대로입니다.
- 손상된 파일도 던지지 않고 `errors` 에 담습니다.

## 규칙

칸의 뜻은 `src/shared/labels/columns.ts` 한 곳에서 옵니다(target·via·requiredWhen·rule·appFilled·emptyValue). 그 파일 머리 주석의 '1a 가져오기 규칙'을 따릅니다.

| 무엇 | 어떻게 |
|---|---|
| 시트·머리글 | 양식과 이름·순서가 다르면 오류. 뒤에 더 붙은 칸은 경고하고 버림. 문서 속성의 칸 지문이 다르면 경고 |
| 판독자 시트 | 한 줄이 모든 줄에 붙음. 라벨러 ID·판독 단계가 비거나 두 줄이면 막음 |
| 파일명 | '파일' 시트 → 없으면 앱(`findFiles`)에서 찾고 경고. 원본 파일명·장비 원본 파일명 둘 다 됨. 같은 이름이 둘이면 'SHA-256' 칸으로 가림 |
| 그룹 칸 | 기법·스큐가 같은 그룹 id. 없으면 오류, 둘 이상이면 물음 + 오류 |
| 조건부 필수 | 비면 대체값이 있으면 그 값 + 경고, 없으면 경고(스키마 검사가 오류로 볼 수도 있음) |
| 범위 | 최소·최대·정수·끝 ≥ 시작·두께 이하(실제 깊이)·두께 4배 이하(펼친 깊이) → 오류 |
| Ref 대비 dB | 앱이 `levels.ts` 로 계산. 엑셀 값은 쓰지 않음. `refDbVerified = false`(대조 전) |
| 판독 단계 | 대조·확정이면 '설계값 봤음' = 참 |
| 작업시간 | 한 줄 → 이벤트: 파일 열기(메모)·닫기, 보고서·라벨 추가 작업·쉰 시간(`{ minutes }`, 시각 = 판독 끝) |
| 시각 | 한국 시간 `+09:00`. 날짜 일련번호(1904 체계 포함)·글자 둘 다 |
| UUID | (sha256, 라벨러, 지침서 버전, 판독 단계, 지시 번호)에서 만든 UUID v5. 다시 가져와도 같음. 지시 번호가 비면 행 번호(경고) |
| 버전 | `versions = [{ pcId, edits: 1 }]`, `revision = 1` |
| 검사 | 모든 결과는 `validate.ts` 를 통과한 값. 오류 줄은 결과에 넣지 않음 |

검토구간 UUID 는 (구간 종류, 그룹, 스캔 시작·끝)으로 만듭니다. 작업 이벤트는 (파일, 판독 시작 시각, 종류)입니다.

## 파일

| 파일 | 내용 |
|---|---|
| `convert.ts` | `parseLabelWorkbook` 본체 |
| `cells.ts` | 셀 → 칸 형식(글자·숫자·목록·예/아니오·시각) |
| `workbook.ts` | xlsx 읽기: 관계, 공유 문자열, 셀 형식, 날짜 서식, 문서 속성. 병합 셀은 무시 |
| `zip.ts` | ZIP 읽기: 중앙 디렉터리, 저장·deflate, CRC. zip64·암호·여러 디스크는 오류. 항목 64 MB·합계 256 MB 상한 |
| `xml.ts` | 작은 XML 읽기 (DTD 거부) |
| `time.ts` | 엑셀 시각 → 한국 시간 ISO |
| `files.ts` | 파일명 찾기(`makeFileFinder`), 그룹 기법·스큐 비교 |
| `fingerprint.ts` | 양식 칸 지문 (생성기 `make_template.py` 와 같은 계산) |
| `uuid.ts` | 결정적 UUID |

테스트: `tests/core/labels/xlsx*.test.ts`. 픽스처: `tests/fixtures/labels/` (`make_fixtures.py` 로 다시 만듦).
