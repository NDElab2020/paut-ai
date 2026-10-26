# core/opd — OmniScan MX2 `.opd` 구조 읽기

OmniScan MX2 가 저장한 `.opd` 를 **읽기 전용**으로 읽어 머리·셋업·빔(집속법칙)·래스터 배치를 꺼내고, 앱의 기존 계약(`ScanPlanSpec`·`NdeFileMeta`·`ViewerFileInfo`)에 맞춘다. Electron 에 의존하지 않는 순수 Node 코드이고 새 의존성은 없다(`node:fs/promises` 만 씀). 계획은 `../../../../OPD_조사/판단.md` 7절이며 1~7단계를 마쳤다(2026-10-07). 8단계(OmniPC 캡처 대조 → `VERIFIED` 올리기)는 사용자 캡처를 받은 뒤 한다.

| 파일 | 하는 일 | 판단.md 단계 |
| --- | --- | --- |
| `index.ts` · `parse.ts` · `container.ts` · `strings.ts` · `setup.ts` · `beams.ts` · `raster.ts` · `bytes.ts` · `errors.ts` · `types.ts` | 구조 읽기 (`OpdFile`) | 2 |
| `selfcheck.ts` | 자체 점검 (게이트 A 재계산 ↔ 장비 값, 스넬, 두께, 빈·손상 의심 프레임) | 2 |
| `normalize.ts` | `OpdFile` → `ScanPlanSpec`·지문·기록용 수집 요약·요약 줄·경고 | 4 |
| `meta.ts` | `OpdFile` → `NdeFileMeta`·셋업 원문(구조 JSON)·미리보기 경고 | 4·5 |
| `viewer.ts` | `OpdFile` + 자체 점검 → `ViewerFileInfo`, 래스터 조각 → `ViewerVolumeChunk`, 저장 사본 경로로 형식 고르기 | 6·7 |

## 근거 (clean-room)

읽기 규칙은 다음 자료만 근거로 만들었다.

- 우리 데이터 파일(`06_원시데이터/**.opd` 162개)의 바이트
- SEC20 `conv/*.r01` (OmniscanConverter XML 리포트, 36개)
- OmniPC 측정 화면 캡처 2장(`OPD_조사/3_화면대조.md`) 및 2026-10-07 PL23861-ROOT-L-01.opd 개선 화면(사용자 첨부·실행 화면 대조)
- `OPD_조사/1_파서실험.md`·`3_화면대조.md`

OmniPC 설치본을 풀어 본 결과(내부 구조 분석 문서 포함)와 `OPD_조사/2_공식경로.md` 는 보지도 쓰지도 않았다. 기존 Python 프로토타입(`opd_*.py`)도 옮기지 않았다(진폭 시작 위치·두께 칸·시간축이 틀림 — `1_파서실험.md` 2절). 실험 스크립트와 전수 결과는 `OPD_조사/실험기록/` 에 보관했다(프로토타입 복사본은 넣지 않음). 아래 위치표의 '근거' 칸이 칸마다 어떤 자료·몇 개로 확인했는지다.

이 앱은 고객이 만든 데이터 파일의 형식을 읽는다. **내부 연구용**으로 진행하고, 상용화 전에는 법률 검토를 받으며 Evident 에 공식 질의한다(`OPD_조사/판단.md` 6·8절). 화면 글자에는 '역설계'라는 말을 쓰지 않고 'OPD · 자체 해석 · 대조 전'으로 표시한다.

## 공개 함수

`index.ts` (`'@core/opd'`):

| 함수 | 하는 일 |
| --- | --- |
| `readOpdFile(path \| bytes)` | 구조 읽기 → `OpdFile` { `reader`, `container`, `header`, `setup`, `beams[]`, `raster`, `warnings[]` }. 진폭은 읽지 않는다 |
| `parseOpdBuffer(bytes)` | 파일 전체 바이트에서 같은 일 (동기) |
| `readOpdAmplitude(src, scanStart, scanCount, { file?, format? })` | 진폭 조각 `[scanCount, 빔, 샘플]`. 기본 `Uint8Array`, `format: 'int16'` 이면 `Int16Array`. 범위 밖은 `INVALID_ARGUMENT` |
| `readOpdGatePeaks(src, scanStart, scanCount, { file? })` | 장비가 저장한 게이트 결과의 최대 진폭 `[scanCount, 빔, 게이트 I·A·B]` |
| `selfCheckOpd(src, { file? })` | 자체 점검 (아래 절) |
| `gateSampleWindow`, `snellExitXMm`, `SELF_CHECK_LIMITS` | 자체 점검 계산·기준 |
| `isOpdFileName`, `hasOpdMagic`, `oleDateToIso`, `parseMxuVersion`, `OPD_ANCHOR` | 도우미 |

`normalize.ts` (`'@core/opd/normalize'`): `normalizeOpd(file)` → { spec, fingerprint 'fp2:…', acquisition, summary, warnings }, `opdPlanSpec`, `opdAcquisition`, `opdSetupWarnings`, `opdReferenceGainDb`(기준 이득 0 → null), `opdSummary`·`opdNameParts`(요약·이름의 집속·개선 높이), `opdThicknessSuspect`, `OPD_SPEC_RULE`·`OPD_SPEC_RULE_FOR_READER`, `OPD_UNKNOWN_FIELDS`·`OPD_ASSUMED_FIELDS`.

`meta.ts`: `opdFileMeta(file)`(형식 'opd'·읽기 규칙·장비 저장 이름·저장 시각·모듈·시리얼·MXU), `opdSetupText(file)`(file_setups 에 넣는 구조 JSON), `opdImportWarnings(file, fileName)`, `deviceNameMatchesFile`.

`viewer.ts` (`'@core/opd/viewer'` — index 에서 다시 내보내지 않음, NDE 모듈을 끌어오지 않게): `readOpdViewerInfo(src)`, `buildOpdViewerInfo(file, check)`, `readOpdViewerChunk(src, group, s, n)`, `readStoredViewerInfo(path)`·`readStoredViewerChunk(path, group, s, n)`(경로 확장자 .opd → OPD, 그 밖 NDE), `viewerSelfCheckOf`, `opdSelfCheckPassed`, `opdExitVMm`, `opdKindLabel`, `OPD_VIEWER_NOTES`.

단위는 앱과 같다: 길이 mm, 시간 µs, 각도 °, 음속 m/s, 주파수 MHz, 이득 dB. 파일의 SI 날 값은 `setup.raw`('A-0x510' 꼴 칸 이름)에 그대로 둔다.

**읽기 규칙 버전** `OPD_READER = { name: 'opd-structure', version: 4 }` — 위치표나 점검이 바뀌면 올린다. 3 = 2026-10-07 용접 숫자·꼬리 typed 설정 레코드 해석(Hot Pass/Land/Root, 템플릿·대칭 원코드, 판재·연강·탐촉자 소자 수·초기 스캔 위치). 4 = 같은 날 개선 틀 코드 6 = V-Offset(한면 V, 이름 추정)·5 = Double V-Offset(양면 V, X)로 개선 모양을 정하고 시편 모양·재질 코드 이름에 '추정' 표시(`OPD_조사/4_용접형상.md`). **스펙 규칙** `OPD_SPEC_RULE = 3` 은 지문에 들어간다(2 → 3: 코드 6 플랜 126개의 `bevelShape`·`template`·`estimatedFields` 가 생겨 지문이 바뀌지만, 이 칸은 이미 지문에 있던 코드에서 나오므로 162개 플랜 묶음 35개는 그대로 — 시험이 규칙 2 지문 묶음과 비교). 읽기 규칙을 올렸을 때 스펙 값이 달라지면 스펙 규칙도 올린다 — `OPD_SPEC_RULE_FOR_READER` 표(시험이 짝을 확인)와 실데이터 162개 지문 스냅샷 시험(`normalize.realdata.test.ts`)이 잊지 않게 막는다. 스펙 규칙이 바뀐 OPD 플랜은 저장소를 열 때 사본을 다시 읽어 고친다(`core/service/maintenance.ts`).

원본은 `'r'` 로만 연다. 머리 0x20 B → 꼬리 색인 → 앞부분 256 KiB(모자라면 4배씩, 최대 32 MiB)와 꼬리 typed 설정 구역(색인 2→3, 최대 32 MiB)을 읽고, 래스터는 요청한 조각만 읽는다.

## 파일 배치 (위치표)

`A` = 셋업 앵커 = **그룹 이름 끝 + 0x328** (162개 모두 절대 0x30F4). `R` = 빔 이름 문자열 끝(0 끝 다음). 값은 따로 적지 않으면 little-endian double(SI). 문자열은 UTF-16LE + 0x0000 (길이 머리 없음). 근거의 '162' = 우리 파일 162개 바이트 전수(`OPD_조사/실험기록/survey.jsonl`·`xcheck_all.jsonl`, 구조 점검 시험 `survey.realdata.test.ts`).

| 구역 | 위치 | 내용 | 근거 |
| --- | --- | --- | --- |
| 머리 | 0x00 | `44 33 22 11 'SURD'`, 0x08 버전(BE u32 = 3), 0x10 꼬리 색인 수(8), 0x14 색인 위치, 0x18 파일 크기 | 162 (크기 칸 = 실제 크기, 색인이 파일 끝에서 끝남) |
| 일반 정보 | 0x2A1A | 저장 시각 (OLE DATE, 시간대 없음) | r01 날짜 36/36 |
|  | 0x2A22 | 장비 모듈 `OMNISX-PA1664PR` → MXU 버전 `MXU - 4.4R5`(인천은 4.4R4) → 보고서 칸 7쌍(`Contractor`·값 … `Procedure`·값) | 162 (값은 모두 기본값 `Name`, 2026-10-07 전수) |
| 그룹 셋업 | 보고서 칸 끝 + 0x270 | 집속법칙 파일 문자열 → 그룹 이름 `PA 1`. 그룹 이름 끝 + 0x328 = 앵커 A | 162 (0x270·0x328 간격 162/162). 값이 채워진 파일·다른 그룹 이름은 아직 본 적 없음 → 경고 |
|  | A±칸 | 아래 '셋업 칸' 표 | 표 참고 |
| 탐촉자·웨지 | A+0xB8 | [시리얼][모델] +0xC8 [문자열 2개] +0x40 [시리얼][모델] +0xC8 [문자열 2개] → 웨지 음속 +0 · 오프셋 X +0x10 · 높이 +0x28 · 각 +0x30 → [웨지 모델 2개] +0x40 [웨지 모델 2개] | 162 (두 벌 같음), r01 탐촉자·웨지 36/36, 웨지 값은 스넬 대조 155/155 |
| 빔 이름 목록 | 웨지 문자열 끝 + 8 | `FblUT_Context_GROUP` … `FblUT_Gate_GROUP`×3 (10개) 묶음 × (빔 수 − 1) | 162 (묶음 수 = 빔 수 − 1) |
| 빔 기록 × 빔 수 | 목록 끝부터 | 앞 블록 0x38 B + 이름 `A:45.00 Sk:090 L:001` + 본문 (아래 표) | 162 (이름 각도 ↔ 각도 블록) |
| 경보·파일 정보 | 마지막 빔 뒤 | `Alarm_Output_GROUP`×3 끝 + 0x88 = **장비 저장 이름** → `File####`×5 → 집속법칙 파일 문자열 | 162 (장비 저장 이름 ↔ 파일 이름 161/162 같음) |
| 장비 정보 | 색표 바로 앞 | 모듈 → 시리얼 → 시리얼 → MXU 버전 (앞쪽 일반 정보와 같아야 함) | 162 |
| 색표 3개 | 1024 B씩 | RGB0 × 256. 세 번째가 회색조 (i, i, i, 0) | 162 |
| **래스터** | 회색조 색표 끝 | `[위치][빔][320]` uint8, 프레임 사이 머리 없음 | 162 (기준표 31칸), 화면 A-scan 모양 상관 0.983/0.997 |
| 게이트 결과 | 래스터 바로 뒤 | `[위치][빔][게이트 I·A·B]` × 12 B, 바이트 8 = 최대 진폭 | 게이트 A 재계산 일치 155개 93.2 % |
| 고정 블록 | 그 뒤 | 4,928 B (뜻 미해독) | 162 |
| 꼬리 구역·색인 | 색인 1번 항목부터 | 수정 이력 등, 끝에 16 B × 8 색인 | 162 |

위치 수 = (첫 꼬리 구역 − 래스터 시작 − 4,928) ÷ (빔 수 × (320 + 36)). **샘플 수 320 을 적은 칸은 찾지 못해 가정이다.** 나누어떨어지는 것만으로는 부족하므로(801 = 9 × 89 라 샘플 수가 4의 배수면 나누어떨어짐) 1축은 위치 수 = 스캔 길이 ÷ 간격 ± 1, 2축은 구조로 센 줄 수 = 인덱스 길이 칸 ÷ 줄 간격 칸이어야 한다(아니면 해석 실패). 162개 모두 통과한다.

### 셋업 칸

| 값 | 위치 | 확인 정도 · 근거 |
| --- | --- | --- |
| 각도 시작·끝·간격 | A+0x00 / +0x08 / +0x10 | 확인 (r01 36/36, 빔 이름 162/162) |
| 집속 깊이 | A+0x18 | 확인 (r01 36/36) |
| 필터 하한·상한 | A+0x68 / +0x70 | 추정 |
| 탐촉자 주파수 · 피치 | A+0x78 / A+0x88 | 확인 (r01 36/36) |
| 스캔 길이 · 스캔 간격 · 인덱스 간격 | A−0x5A8 / A−0x30 / A−0x10 | 확인 (r01 36/36, 길이 = 칸 − 간격) |
| 인덱스 길이 · 인덱스 줄 간격 | A−0x590 / A−0x588 | 추정 (부식 2축 7개 줄 수 5·13 과 맞음, 용접 155개는 1줄) — 2축 교차 확인에 씀 |
| 시편 두께 | A−0x510 | 확인 (r01 36/36, OmniPC 스킵선 2장) |
| Hot Pass · Land · Root 높이 | A−0x4D8 / A−0x4D0 / A−0x4C8 | OmniPC 개선 화면: PL 11.5+2+11.5=25 mm. 용접 155개 모두 세 높이 합 = 두께. 부식 7개 모두 0 |
| Hot Pass · Root 각도 / Land 오프셋 | A−0x4C0 / A−0x4B8 / A−0x508 | OmniPC 개선 화면 30° / 30° / 1 mm, Weld_GROUP typed 숫자 포인터로 위치 재확인 |
| 인덱스 오프셋 · 스큐 · 그룹 음속 | A−0x3F0 / A−0x3E8 / A−0x3E0 | 확인 (r01 36/36, 화면 출사점 2장) |
| 이득 · 기준 진폭 % · 기준 이득 | A−0x3C8 / A−0x3C0 / A−0x3B8 | 확인 (OmniPC Gain·Ref 2장, r01 이득 36/36) |
| 펄스 폭 | A−0x378 | 확인 (r01 36/36) |

### 꼬리 typed 설정 레코드 (`weld.ts`)

색인 `entries[2].offset`부터 `entries[3].offset`까지 16 B 튜플을 따라 읽는다. 튜플은 u32LE `(tag, count, value 또는 앞부분 절대 포인터, extra)`이다. 그룹 header `tag=0x13EB0`의 count는 **이름 UTF-16 바이트 길이**이며 자식 수가 아니다. 그룹 이름 문자열을 읽어 필요한 그룹을 고른다. 0xB 타입은 SI double 포인터, 0x6/0x7 타입은 레코드의 정수 값을 읽는다. 날 값은 `setup.raw['Weld_GROUP[0]:0x…']` 등으로 남긴다.

| 그룹 · 태그 | 값 · 확인 근거 |
| --- | --- |
| Weld_GROUP · 0x74CBF | 개선 틀 코드(`weld.ts` `OPD_WELD_TEMPLATE_INFO`). 5 = DoubleVOffset · 양면 V(X) — PL23861-ROOT-L-01 화면과 같은 파일로 대조 **확인**(PL 29개). 모양 X 는 저장된 캡처 `검증_OPD정보_2026-10-07/OmniPC_PL23861_설정.jpg` 의 덮개선을 픽셀로 재서 0.2 mm 안(`weldOverlay.realdata.test.ts`), 이름 'Double V-Offset'·대칭 'Symmetric' 은 사용자가 대화에 붙인 화면으로 확인한 것이고 저장된 캡처에서는 그 칸이 접혀 있다(그 화면을 파일로 남기면 근거가 닫힘). 6 = VOffset · 한면 V(V) — 모양은 **확인**(Root 0·Land offset > 0, 사용자 SetupBuilder `12t_SV`·`25t_SV.wkb` 값과 바이트 그대로 같음, OmniPC 덮개 2장이 파일 칸 계산과 0.1 mm 안), 이름은 같은 설계 X3 .nde ModelSetup `VOffset` 으로 짐작해 **추정**(126개, 화면에 '(추정)'). 0 = 용접 없음(부식 7개, 용접 칸 0 → `weld = null`). 그 밖의 코드는 이름·모양 null(원코드 보존) |
| Weld_GROUP · 0x74DBF | 대칭 원코드. 0=Symmetric(PL 개선 화면 대조). 다른 코드는 이름 미해독 |
| SpecimenInformation_GROUP · 0x740DD / 0x742DD | 0=Plate / 30=STEEL, MILD (`OPD_SPECIMEN_SHAPES`·`OPD_MATERIALS`). SEC20 r01 36개·사용자 .wkb 3개와 같다. 162개가 모두 같은 코드라 다른 값 표본이 없어 **추정** — 스펙 `estimatedFields` 로 화면에 '(추정)'. 다른 코드는 null |
| ProbeUT_Container_GROUP · 0x641B6 | 송·수신 2벌의 실제 소자 수가 일치할 때만 사용. PCN64, 인천32, S36 16, 부식64. 모델 숫자는 사용하지 않음 |
| GroupUT_GROUP · 0xB3EE2 | 초기 스캔 위치(SI). r01 Scan_Offset와 대조 |
| GroupUT_GROUP · 0x742E2 | 코드 1=Shear(SEC20 r01 36개 대조), 코드 2는 이름 미해독으로 null |
| FblUT_Context_GROUP · 0x149B9 / 0x3DBB | 빔 이름 / I·A·B 게이트 테이블 참조 3개. 이름으로 빔 기록에 연결 |
| FblUT_Gate_GROUP · 0x240BB | 문턱 %는 튜플+8의 uint8 값. 나머지 3바이트는 값이 아니므로 무시 |

파 모드 코드 2는 PCN 횡파와 부식 종파 파일에 모두 나타나므로 이름을 추측하지 않는다. SEC 코드 1만 r01의 Shear와 대조한 이름을 적용한다. 게이트 참조 5,804개 Context/17,412개 Gate를 전수 확인했으며 r01 36개×3 게이트의 I/A/B 문턱 108개와 모두 일치한다. 화면의 Fill·HAZ·Cap 값이 모두 0이라 남은 0 숫자 포인터의 의미를 가를 수 없으므로 미해독 상태로 둔다. Fill 높이는 별도로 두께−Hot Pass−Land−Root 잔여값을 `derivedFillHeightMm`에 계산값으로 표시한다. 잔여값이 양수면 Fill 각도가 미해독이므로 두께 점검을 판정 보류(null)하며 음수로 층 높이가 두께를 넘을 때만 불일치 경고를 붙인다.

### 빔 기록 본문

| 값 | 위치 | 확인 정도 · 근거 |
| --- | --- | --- |
| 굴절각 · 집속 · 출사점 X · 법칙 음속 · 웨지 지연 · 이득 보정(?) | R+0x00 / +0x10 / +0x18 / +0x28 / +0x30 / +0x38 | 출사점(화면 2장·스넬 155/155)·웨지 지연(r01 36/36) 확인, 이득 보정 추정 |
| 소자 칸 (최대 28칸, 0x40 B씩) | R+0x40 + 0x40·k | u16 번호 · +0x08 송신 지연 · +0x18 u32 1 · +0x20 u16 번호 · +0x28 수신 지연 · +0x30 펄스 폭. 쓰는 칸은 앞에서부터 이어지고 나머지는 0 (162: 모두 16칸, r01 첫 소자 36/36) |
| A-scan 시작 · 범위 | R+0x768 / R+0x770 | 확인 (r01 36/36, 화면 2장). 샘플 간격 = 범위 ÷ 320. 한 파일 안 모든 빔이 같아야 한다(162 — 다르면 해석 실패) |
| TCG | R+0x798 | `FblUT_TCGPoint_GROUP` × n → 점 (n+1) × (시각, dB) (r01 TCG 4점 36/36) |
| 게이트 I·A·B (시작, 폭) | TCG 점 끝 + 0x60 | 깊이 시간 (깊이 × 2 / 음속). 게이트 A는 장비 결과와 대조. I/A/B 순서는 Context 참조 및 r01 문턱 20/20/30% 36/36 대조로 확인 |

알려진 배치는 n = 3 (TCG 4점, 본문 0x8E6 B — 이름 포함 빔 기록 2,376 B)과 n = 0 (TCG 없음 6.4T, 0x838 B — 2,202 B) 둘뿐이다. 부식 파일의 2,374 B 는 이름 `A:0.00` 이 2바이트 짧아서다(본문은 같음). 다른 n 은 해석 실패로 둔다.

## 시간·좌표 규칙

- 래스터 샘플 i 의 시각 = `t0Us + i × sampleIntervalUs`. 웨지 지연을 뺀 뒤 출사점에서의 왕복 시간이다(NDE `ultrasoundOffset` 와 같은 뜻).
- 게이트 시작·폭은 **깊이 시간**이다. 빔 시간으로는 ÷ cos(굴절각).
- TCG 점 시각은 **음로(빔) 시간**이다. r01 의 True Depth 위치 = 시각 × 음속/2 × cos θ 로 36/36 맞았다. `1_파서실험.md` 1.3절 본문은 'TCG 도 깊이 시간'이라고 적었지만 같은 문서의 확인 계산(4.418 µs × 1620 × cos35° = 5.86 mm)은 음로 시간 쪽이다. 여기서는 계산 쪽을 따른다(명세 문서 정정은 사용자 확인 뒤).
- 출사점 X 는 웨지 앞면 기준이고 뒤쪽이 음수다. 출사점 V(`viewer.ts` `opdExitVMm`): 스큐 90 = 인덱스 오프셋 + 출사점 X (OmniPC 화면 2장과 0.2 mm 안, **확인**), 스큐 270 = 인덱스 오프셋 − 출사점 X (**추정** — L/R 오프셋이 −40/+40 처럼 부호만 반대라 대칭으로 봄, TP14-ROOT-R 캡처로 확인 전). 첫·끝 빔 사이를 보간하지 않고 빔 값 그대로 쓴다.
- 스캔 위치 = Patch 시작 위치 + 프레임 번호 × 간격. Patch의 제외 상한에서 간격을 뺀 값이 마지막 측정 위치다. `scan.ts`가 Mechanical→Patch→Axis 참조로 동기를 읽는다(0=Time, 1=Encoder). 162개에서 Time 35·Encoder 127, SEC20 r01 36/36과 일치한다. 시간 동기의 mm는 명목 위치로 표시한다. 부식 7개는 엔코더 설정 코드가 중복되어 분해능을 선택하지 않고 원값 두 벌을 보존한다.

## 구조 점검 → 보류(해석 실패)

점검이 하나라도 맞지 않으면 `OpdError`(code `NDE_READ_ERROR`, 메시지 `보류(해석 실패): …`, `check` = 점검 이름)를 던진다. 추정값으로 메우지 않는다.

| check | 무엇을 보나 |
| --- | --- |
| `magic` · `container-version` · `file-size` · `tail-index` | SURD 매직, 머리 버전 3, 머리의 파일 크기 = 실제 크기(잘림), 색인이 파일 끝에서 끝나고 위치가 파일 안·오름차순 |
| `general-info` · `anchor` | 모듈·MXU 문자열과 보고서 칸 이름 7개 순서(값은 무엇이든), 그룹 이름 문자열·계산한 앵커 범위 |
| `setup-values` | 셋업 칸이 유한하고 넓은 범위 안 (두께 0.1 mm~1 m, 음속 500~15,000 m/s 등). 처음 보는 배치(보고서 값이 채워짐·앵커 ≠ 0x30F4)에서 실패하면 '아직 시험하지 못했습니다' 안내를 붙인다 |
| `probe-strings` | 탐촉자 블록 두 벌의 시리얼·모델이 같음, 웨지 값 범위 |
| `beam-pool` · `beam-records` · `beam-values` · `beam-layout` | 이름 목록 묶음 수 = 빔 수 − 1, 이름 모양·L 번호 순서·스큐, 빔 값 범위·이름 각도 일치·**빔마다 A-scan 시작·범위 같음**, 소자 칸 연속·번호 연속, 알려진 TCG 배치·TCG 첫 점 시각 0·게이트 범위 |
| `angle-block` | 섹토리얼: 빔 수 = (끝 − 시작)/간격 + 1, 빔 각도 = 시작 + k·간격, 첫 소자 같음. 리니어: 각도 같음, 첫 소자가 일정 간격으로 늚. 빔마다 소자 수 같음 |
| `trailer` · `palette` | 경보 구역 → 장비 저장 이름 → 문자열 5개 → 집속법칙 파일 문자열(앞쪽과 같음), 회색조 색표, 앞 두 색표의 넷째 바이트 0, 색표 앞 모듈·시리얼·MXU |
| `positions` · `bounds` | 위치 수 공식이 나누어떨어짐, **1축은 위치 수 = 스캔 길이 ÷ 간격 ± 1, 2축은 줄 수 = 인덱스 칸 줄 수**, 읽는 위치가 파일 안 |

파일 접근 오류는 `not-found`(NOT_FOUND)·`not-a-file`·`empty-file`(NDE_READ_ERROR)·`io`(IO_ERROR)다.

경고(`warnings`, 오류 아님): 늘 '공개되지 않은 형식이라 구조를 따라 읽음(OmniPC 대조 전)'을 붙인다. 그 밖에 처음 보는 배치(보고서 칸 채움·다른 그룹 이름), 2축 스캔(이미지 보기 미지원), Patch 위치 수 칸이 없는 파일에서만 위치 수 ≠ 스캔 길이 ÷ 간격(± 1 안)(SEC25-2 sr1_04~07 의 800 대 801 은 Patch 시작 1 mm·위치 수 800 칸으로 풀려 지금은 경고 없음), 두께 칸 < Hot Pass + Land + Root(현재 155개 용접 모두 일치)를 붙인다. 정규화 경고의 스캔 동기 줄은 동기 칸을 못 읽은 파일('모름')과 시간 동기 파일('명목값')에만 붙는다(엔코더 127개는 없음 — 2026-10-07 반박 검토에서 늘 붙던 '동기 모름'을 고침).

## 자체 점검 (`selfCheckOpd`)

판단.md 3.2 를 따른다. 판정과 메모는 이 점검(core) 한 곳에서만 하고, 뷰어(`viewerSelfCheckOf`)는 그대로 옮긴다.

- **게이트 A**: 래스터의 게이트 A 구간 최댓값을 장비 저장 값(게이트 결과 바이트 8)과 정수로 비교한다. 포함 샘플은 `ceil((시작/cos − t0)/간격 − 1e-6)` … `floor((끝/cos − t0)/간격 + 1e-6)` (양끝 포함). 빈 프레임(래스터가 모두 0)은 뺀다. 이 규칙으로 기준표의 칸 수·일치 칸 수와 155개 모두 같다(2,540,289 칸 중 2,366,380 칸, 93.2 %).
  - 통과 = 저장 구간 안 칸 일치율 ≥ 95 % **그리고** 전체 칸 일치율 ≥ 95 % **그리고** 설명할 수 없는 어긋남(장비 값 < 재계산) ≤ 10 %. 저장 구간 안 칸이 없으면 **판정 못 함(null) = 대조 전**이다(전체 일치율이 높아도).
  - 162개 결과(그릴 수 있는 155개): 통과 88 · 실패 31 · 판정 못 함 36. 전체 일치율이 낮은 12t PCN ROOT/TOP 20개(TP01·02·04·07·tp07·08)·PL BOT 8개·SEC20 sr04_16, 안쪽 칸이 없는 36개(PL ROOT·6.4T·TP SW·TP11~14 ROOT, TP14-ROOT-L 포함)는 `VERIFIED` 를 올려도 막힌다(시험 `viewer.realdata.test.ts` 가 고정).
  - 설명할 수 없는 어긋남이 10 % 를 넘으면 래스터 배치를 믿을 수 없어 이미지 보기는 그리지 않는다('보류(해석 실패)'). 실데이터 최대 4.5 %(TP14-SW-R), 샘플 수를 잘못 가정한 파일은 48~64 %.
  - 센 신호(재계산 raw ≥ 224) 칸 일치율을 따로 센다. 포화 근처는 절반쯤만 맞는다(원인 모름 — 이웃 프레임·빔과도 맞지 않음). 63개 파일이 95 % 미만이라 막는 이유에 적힌다. 8단계 캡처 O2(포화 지점 A%) 대조 때 꼭 본다.
- **손상 의심 프레임**: 래스터는 모두 0 인데 그 프레임의 장비 게이트 결과(36 B × 빔)에 0 이 아닌 바이트가 있는 프레임. 실데이터에는 한 번도 없다. 1개라도 있으면 통과가 아니고 막는 이유에 붙는다.
- **스넬**: 가운데 소자(첫 소자 + 7.5)를 웨지 경사면을 따라 앞·위로 놓고, 법칙 음속으로 입사각을 구해 출사점을 계산한다. 155개 용접 파일 모든 빔에서 0.05 mm 안이다. 2축(부식) 파일은 출사점 기준이 달라(첫 법칙 = 0) 하지 않는다.
- **두께**: 용접 높이가 있으면 두께 ↔ Hot Pass + Land + Root (±0.05 mm). PL2386x 29개의 기존 불일치 경고는 Root 누락 오류였으며 수정했다.
- 기준표의 빈 프레임·255 칸 열은 '스캔 길이 ÷ 간격' 프레임만 센 값이다. 그래서 2축 파일은 첫 줄만, SEC25-2 sr1_04~07 은 래스터 뒤 1프레임(게이트 결과)까지 들어가 있다. 테스트는 위치 수 = 스캔 길이 ÷ 간격인 파일만 비교한다.

## 스캔플랜·가져오기 (`normalize.ts`·`meta.ts`)

- 파일에서 읽은 값만 지문에 넣는다. 판재·연강·탐촉자 소자 수·초기 스캔 위치와 개선 모양(틀 코드 5 = X, 6 = V)·Hot Pass/Land/Root 높이·각·Land 오프셋을 읽는다. 코드 이름을 다른 값 표본 없이 정한 칸(시편 형상·재질·틀 코드 6 의 이름)은 값을 넣고 `specimen.estimatedFields`(`'shape'`·`'materialName'`·`'weld.template'`)에 적어 플랜 화면·도식에 '(추정)'을 붙이고 경고한다. 모르는 코드 이름·파 모드 코드 2·스캔면·집속 방식·Fill 각도/HAZ/Cap은 null 이고 경고한다. 공유 타입이 null 을 받지 않는 두 칸(탐촉자 종류 '선형 위상배열'·장착 방향 '정방향')은 모든 OPD 플랜에 같은 상수라 지문을 가르지 않으며, 플랜 화면에 '(추정)'을 붙인다.
- `techniqueParams` 에 `dataFormat: 'opd'`(NDE 플랜과 섞이지 않게)·`opdSpecRule`·시편 형상/재질/파 모드 원코드. 개선 숫자와 템플릿·대칭 원코드는 `specimen.weld`에 넣는다.
- 요약 줄 = NDE 요약(개선 모양 포함 '판재 25 mm · X 개선 · …') + 집속 깊이 + '개선 높이 Hot Pass+Land(+Root, 0 이 아닐 때)' (+ '두께 확인 필요') + ' · OPD'. 예 PL23861-ROOT-L: '판재 25 mm · X 개선 · 5L64-A32 · -18 mm · PA 섹터 45–70° · 집속 25 mm · 개선 높이 11.5+2+11.5 mm · OPD'. '두께 확인 필요'는 층 높이 합이 두께를 넘을 때만 붙는다(양면 V 는 Root 까지 더해 25 = 11.5 + 2 + 11.5 — 162개 중 0개). 짧은 이름 = 두께·주파수·스큐 + 집속 + '{모양}개선 높이' + ' · OPD'('25T · 5MHz · SK90 · 집속 25 · X개선 11.5+2+11.5 · OPD'). 이미 만든 플랜의 이름은 저장소 점검이 바꾸지 않는다(사용자가 고친 이름일 수 있음). 162개 → 플랜 35개, 서로 다른 플랜의 요약 글자는 모두 다르다. 이름은 인덱스 오프셋만 1~2 mm 다른 회차끼리 겹칠 수 있다(' (2)' 가 붙음 — 합칠지는 사용자 결정 대기).
- 셋업 원문(file_setups) = 우리가 읽은 구조 JSON(`format: 'opd-structure'` + `OpdFile`). 플랜 재계산은 원문이 아니라 저장소 사본을 다시 읽는다.

## 이미지 보기 (`viewer.ts`)

- t0 = A-scan 시작, 샘플 간격 = 범위/320, 음속 = 그룹 음속, U = GroupUT 초기 스캔 위치(모르면 0 근사). 게이트 I·A·B = 깊이 시간 ÷ cos θ, `TrueDepth`·`Pulse`, 문턱은 typed 게이트 참조에서 읽으며 확인 못한 파일만 null.
- 진폭 눈금 `{ rawMax: 255, unitMax: 250, estimated: true }` (**추정** — 화면 세 점). 기준 이득 0(PCN)은 `null`('Ref 모름'). A-scan 진폭 축 '전체'는 250 % 까지.
- 색표는 앱 내장(X3 .nde ModelSetup 의 256색, `paletteSource: 'default'`) — 파일 색표는 OmniPC 화면 색과 다르다. C-scan 은 캡처 2장처럼 첫 빔(작은 각도)이 아래(`cscanReversed: true`, 파일 칸 못 찾음).
- 파일에 저장된 판재 설정을 사용한다. 코드 5 는 Double V-Offset(X)로, 코드 6 은 V-Offset(V)로 그린다(`shared/imaging/weld.ts` — 양면 V 는 바닥 → Root → Land → Hot Pass 순 반폭, Root 0 인 V 와 NDE 덮개는 바이트 그대로). 모르는 코드는 이름을 붙이지 않고 숫자 층으로 그린 참고 단면(`geometryEstimated`)으로 둔다. OPD 덮개에는 늘 꼬리표 `overlayNote: '덮개 추정'` 을 붙여 S-scan 개선면 옆에 보인다(코드 6 은 경고 `OPD_VIEWER_NOTES.templateEstimated` 도). 실제 시편의 형상·재질은 파일 설정과 별도로 확인해야 한다.
- 조각: uint8 → `Int16Array`, 상태 = 모두 0 인 프레임이면 0. 2축은 그리지 않는다.
- `VERIFIED` 의 OPD 표는 비어 있다(`core/nde/viewer/meta.ts`, 열쇠 = (형식·기법·스큐)) → 모든 OPD 그룹 `verified = false`. `verified` = 대조 표 && `opdSelfCheckPassed`.
- 막는 이유(`blockReasons`, 항목별): 대조 전(OPD 기법 · 스큐) · 진폭 눈금 추정 · 시편 형상 모름 또는 추정(코드 0 → 판재는 다른 값 표본이 없고 SEC·S36 은 실제 배관일 수 있어 '시편 형상 추정(파일 코드 0 → 판재, 다른 값 표본 없음)'으로 남긴다 — 2026-10-07 반박 검토) · 두께 칸 의심 · 게이트 A(실패/판정 못 함) · 센 신호 칸 일치율 · 손상 의심 프레임 · 스넬. `blockReason` 은 그 항목을 이은 한 문장(`composeBlockReason`). 학습 내보내기는 파일 정렬에 실측 두께가 있으면 두께 항목을 빼고, derive 이유가 '대조 전'이면 대조 전 항목을 빼고 붙인다.

## 아직 모르는 것 (8단계에서 캡처로 정할 것)

- 진폭 % 눈금: `OPD_AMPLITUDE_SCALE = { rawMax: 255, unitMax: 250 }` 은 **추정**이다(화면 세 점). OmniPC C-scan 색은 raw × 0.83~0.86 으로 또 다르다. 센 신호(raw ≥ 224) 칸은 장비 값과 절반쯤만 맞는다(캡처 O1·O2).
- 개선 틀 코드 6 의 메뉴 이름(모양 V 는 확인, 이름 V-Offset 은 추정 — TP14-ROOT-L Weld 설정 창 캡처 O9 1장이면 확정)·Fill 각도/HAZ/Cap 이 어느 칸인지(후보 4칸 162개 모두 0 — 값 하나씩 바꿔 다른 이름으로 저장한 사본 필요)·S36 만 다른 칸(A−0x4F0 = 30, 0x64EBF = 5)·파 모드 코드 2, 샘플 수 칸. (엔코더/시간 동기·스캔 시작 위치는 읽기 규칙 4 의 `scan.ts` 가 Patch·Axis 칸으로 읽는다.) 시편 설정 코드 0=Plate/30=STEEL, MILD는 r01 36개와 대조했으며 실제 시편 정보를 대신하지 않는다.
- 스큐 270 의 V 부호(TP14-ROOT-R 1장), 리니어·45빔·6.4T·12t 80 ns 의 OmniPC 화면 대조(O4·O5·O8).
- 게이트가 저장 구간 밖까지 걸친 파일(판정 못 함 36개)·전체 일치율이 낮은 파일의 원인. 어긋난 칸은 PL ROOT·TP12/13 ROOT·S36 에서 98 % 이상 '장비 값 > 재계산'(게이트가 저장 구간보다 넓다는 설명과 맞음)이고, 리니어 SW 는 '장비 값 < 재계산'이 많다. 판정 규칙을 넓힐지는 사용자 결정.
- 보고서 칸을 채운 OPD·그룹 이름을 바꾼 OPD 는 본 적이 없다(같은 규칙으로 따라 읽고 경고). 한 개씩 받으면 시험에 넣는다.

## 테스트

| 파일 | 실데이터 | 내용 |
| --- | --- | --- |
| `tests/core/opd/opd.test.ts` | 필요 없음 | `synth.ts` 로 만든 작은 OPD: 읽기 값, 보고서 칸 채움·그룹 이름이 달라도 따라 읽기, 리니어·TCG 없음·스큐 270·2축, 진폭 조각·Int16, 자체 점검(손상 의심·설명할 수 없는 어긋남·센 신호), 앞부분 다시 읽기, 원본 불변, 잘린·바꾼 파일 → 점검 이름별 해석 실패(위치 수 교차 확인·빔 시간 포함) |
| `tests/core/opd/survey.test.ts` | CSV 있으면 | `tests/fixtures/opd/survey.json` = 조사 CSV(162행). `PAUT_WRITE_OPD_SURVEY=1` 이면 다시 만든다 |
| `tests/core/opd/survey.realdata.test.ts` | 있으면 | 162개 예외 없이 읽고 기준표 31칸 일치, 게이트 A 일치 칸 ≥ 기준표, 스넬 ≤ 0.05 mm, 용접 155개 모두 층 높이 합 일치 |
| `tests/core/opd/r01.realdata.test.ts` | 있으면 | SEC20 36개 ↔ r01 |
| `tests/core/opd/opd.realdata.test.ts` | 있으면 | TP14-ROOT-L 값, OmniPC 화면 정답 재현, 원본 불변, 잘린·바꾼 사본, 성능 기록 |
| `tests/core/opd/weldOverlay.realdata.test.ts` | 있으면 | 용접 덮개 반폭 ↔ OmniPC 화면 덮개선 픽셀 측정(PL23861-ROOT-L 양면 V 7점·TP14-ROOT-L 5점·SEC25-2 2점, 0.2 mm 안), TP01 덮개 = 같은 설계 X3 .nde 덮개(개선면 점 같음, HAZ 선만 다름) |
| `tests/core/opd/normalize*.test.ts` | 일부 | 스펙·지문·요약·이름·경고, 162개 플랜 35개 묶음, 지문 스냅샷, 읽기 규칙 ↔ 스펙 규칙 짝 |
| `tests/core/opd/viewer*.test.ts` | 일부 | ViewerFileInfo·막는 이유·조각, 162개 전수(게이트 A 판정 표 88/31/36), 서비스 경로, 라벨 기록·JSON 왕복·derive·학습 내보내기 |
| `tests/omnipcOpd.test.ts` | 있으면 | OmniPC 화면 2장 재현(A%·DA^·ViA^·출사점·빔 선·C-scan 상관) |
| `tests/e2e/opd*.test.ts` | 일부 | 가져오기 → 확정 → 중복, 저장소 점검(규칙 갱신·플랜 합치기 필요·미등록 사본), mock |

OmniPC 재현 결과(결정 6 허용치 안): TP14-ROOT-L 278 mm·65° A% 32.35(화면 32.3) · DA^ 22.48(22.45) · ViA^ 2.19(2.21) · 출사점 V −56.82(−57.0). SEC25-2 sr1_01 114 mm·39° A% 4.90(4.9) · DA^/ViA^ ND(문턱 20 %) · 출사점 V −28.87(−28.9).

## 성능 (맥, 디스크 캐시가 데워진 상태, 2026-10-07)

10.5 MB 파일(SEC20 sr01_01, 36빔 × 801위치): 셋업 읽기 0.2 ms, 진폭 조각 64위치 0.1 ms, 전체 801위치 Int16 넓히기 1.9 ms(18.5 MB), 자체 점검 17 ms. 162개 전수 구조 읽기 약 40~80 ms, 전수 자체 점검(1.2 GB) 약 1.8 s. 이미지 보기 열기(구조 읽기 + 자체 점검) TP14 6~13 ms, SEC20 18~26 ms. 콜드 캐시·Windows 에서는 다시 잰다.
