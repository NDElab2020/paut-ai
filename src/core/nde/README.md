# core/nde — NDE 코어

Evident `.nde`(HDF5)를 `h5wasm/node` 로 **읽기 전용**으로 열어 파일 메타와 버전 무관 스캔플랜 스펙·지문을 만든다. 가져오기 경로(`openNde`·`readNdeFile`)는 진폭 데이터를 읽지 않는다(파일당 1~8ms, 44MB 예제 4ms). 이미지 보기용 진폭 읽기는 `viewer/` 에 따로 있다(아래).

## 공개 함수 (index.ts)

| 함수 | 하는 일 |
| --- | --- |
| `openNde(path)` | 열기 → 버전 판별 → 셋업 JSON·메타(`NdeFileMeta`)·경고. 반드시 닫음. 실패는 `NdeError` |
| `readNdeFile(path)` | `openNde` + `normalizeSetup` → `NdeReadResult` (가져오기에서 쓰는 기본 진입점) |
| `normalizeSetup(setup, version?)` | 3.x/4.x 셋업 → `{ spec, fingerprint, acquisition, summary, warnings }` |
| `fingerprint(spec)` / `computeFingerprint` / `canonicalJson` | `'fp1:' + sha256(정준 JSON)`. `fingerprint()` 는 정준 JSON 도 돌려줌 |
| `diffSpecs(a, b)` / `describeDifference(d)` / `specDistance` | 차이 목록(한국어 라벨) / '두께 12 mm → 25 mm' / 가까운 플랜 고르기 |
| `summarizeSpec(spec)` / `suggestPlanName(spec)` | '판재 12 mm · V 개선 · 5L64-A32 ×2 · ±15 mm · PA 섹터 40–70°' / '12T · 5MHz · SK90/270' (두께 · 주파수 · 스큐) |
| `summarizeAcquisition(setup)` | 지문 제외 기록값(게인·음속·게이트·TCG·보정·스캔 격자·엔코더) |
| `suggestSpecimen(meta, fileName)` | 시편 ID(PL·TP 번호, TF 번호는 'TF_01' 그대로 — 2026-10-26, 장비 원본 파일명 우선)·Cap on/off·회차·태그 + 근거 |

## 오류 (`NdeError.reason` → `code`)

`not-found`→NOT_FOUND, `not-a-file`·`empty-file`·`not-hdf5`·`truncated`·`hdf5-open-failed`·`corrupt`·`bad-setup-json`→NDE_READ_ERROR, `no-setup`·`unknown-layout`·`unsupported-version`→NDE_UNSUPPORTED.
h5wasm 은 열기 실패 때 예외 대신 `file_id = -1` 을 주고 HDF5 오류 스택을 stderr 에 찍는다. 그래서 열기 전에 HDF5 서명과 슈퍼블록의 EOF 주소를 직접 읽어 비-HDF5·잘린 파일을 먼저 거른다. 내부 메타데이터가 깨진 파일만 stderr 잡음이 남는다.

## 버전 판별

- 3.x: 루트 `Domain/Setup`, 메타 = 루트 속성(`Format version`, `Date created` …), 장비 원본 파일명 = `/Applications/<앱>/ModelSetup` 의 `<SaveFileName>`.
- 4.x: 루트 `Public/Setup` + `Properties`(JSON `file.*`), 장비 원본 파일명 = `/Private/<앱>/ModelSetup` 의 `<SaveFileName>` (공식 예제 4.0~4.2 전부에 있음).
- 버전 문자열은 `setup.version` 우선. 구조(3.x/4.x)와 버전 major 가 다르거나 major 가 3·4 가 아니면 `unsupported-version`.
- 날짜 `+0900` → `+09:00` 로 정규화.

## 3.x ↔ 4.x 매핑 (근거: 공식 스펙 `versioning/version-4.0/transitioning-3.3-4.0/upgrade-json-setup.md`, `whats-new-4.0.md`)

| 3.x | 4.x | 정규화 |
| --- | --- | --- |
| `groups[].paut` | `processes[].ultrasonicPhasedArray` | PA (sectorial/linear/compound, pitchCatch, tandem) |
| `groups[].ut` (`refractedAngle` 직속) | `processes[].ultrasonicConventional` (`beams[0].refractedAngle`) | UT / ToFD(`tofd`, PCS) |
| `groups[].fmc` + `tfmDescriptions[]` | `ultrasonicMatrixCapture` 그룹 1 + `totalFocusingMethod` 그룹 N (`inputs[].groupId`) | TFM 그룹 N (캡처 그룹은 다른 그룹이 입력으로 쓰고 자체 데이터셋이 없으면 묶음에서 뺌) |
| `groups[].planeWaveCapture` | `ultrasonicMatrixCapture` (`acquisitionPattern: 'PWI'`) | PWI / TFM(capture='PWI') |
| `paut.softwareProcess` | `thickness`, `tfmBoxGates`, `ultrasonicGates`, `ultrasonicTcg`, `gain` process | 기록용만 |
| `dataEncodings[].discreteGrid.specimenId` | `dataMappings[].specimenId` | 그룹 묶음이 쓰는 시편 선택 |
| encoder `stepResolution` step/mm | step/m | 기록값은 step/mm 로 통일 |
| 그 밖의 process (eddyCurrent 등) | | `technique: 'other'`, `techniqueParams.unsupported` + 경고 (예외 아님) |

## 지문 (사용자 확정 4범주만)

- (a) 시편: 형상(plate/pipe/bar/unspecified), 두께, 배관 외반경·원주 범위(봉재는 지름/2 를 외반경 자리에), 재질 이름, 용접 형상(개선·대칭·각도·캡·핫패스·랜드·루트·충전층·재질).
- (b) 탐촉자 모델·종류·중심주파수·소자 수·피치(elementLength+elementGap), 웨지 모델·wedgeAngle.
- (c) 웨지 positioning: u/v 오프셋, 스큐.
- (d) 그룹별 기법·빔 형성·첫 소자·어퍼처·소자 스텝·굴절각 start/stop/step·집속 방식/거리·파 모드, 기법 변수(ToFD PCS, TFM 경로·파 세트·영역, pitchCatch/tandem 등).
- 단위: mm·°·MHz, 반올림 0.1 mm / 0.1° / 0.01 MHz. 그룹은 정준 JSON 으로 정렬(이름 무관), 그룹 안 탐촉자는 역할 → 모델 순.
- 제외(기록만): 게인, 게이트, TCG, calibrationStates, 빔 지연·ascanStart, 음속, 그룹 이름, 파일명, 시리얼, 날짜, 엔코더, 스캔 격자.
- 규칙을 바꾸면 `SPEC_VERSION` 과 `FINGERPRINT_PREFIX`(fp1→fp2)를 함께 올린다.

## 검증된 사실 (tests/core/nde)

- X3 4개 → 같은 지문 1개. 시편 PL23833/PL23840/PL23841/PL23831, Cap on/off.
- 3.3 `ManualWeldPA` ↔ 4.0 `ManualWeldPA-4.0`: 같은 측정(같은 시리얼·생성 시각·데이터 크기, 4.0 은 OmniPC 6.0 변환본) → 같은 지문.
- 4.1 ↔ 4.2 의 UT·4TFM 예제도 같은 지문. 3.x fmc 형식으로 되돌린 4.2 TFM 셋업도 같은 지문.

## 규칙 v2 (fp2, SPEC_VERSION 2)

- 반올림: 격자보다 3자리 더 정밀한 10진 문자열로 먼저 고정한 뒤 정수 연산으로 반올림(0 에서 먼 쪽). `0.75*0.0254` 와 `0.01905`, `0.00615±1e-12` 가 같은 값이 된다. 격자 경계는 여전히 있으므로 `withinTolerance()` 로 "허용오차 안 차이만 있음"을 알린다.
- 배관 `angularOpening` 이 없으면 360(전체 원주).
- 탐촉자 장착 방향 `wedgeAssociation.orientation`(없으면 Normal), 스캔면(`positioning.surfaceId` → 시편 surfaces 이름), 스큐는 0~360 으로.
- 액주 웨지: 4.x `wedges[].fluidColumn.mountingLocations[].wedgeAngle`, 3.x `probes[].fluidColumn.wedgeAngle` 을 같은 `WedgeSpec(kind 'fluidColumn')` 으로.
- 선형 `elementStep` 0.01 반올림, 탠덤 송수신 `focusingDistance`(µs), TFM 다중 탐촉자는 송신/수신 역할을 나누고 내용 순으로 정렬(id 순서 무시).
- 이전 규칙으로 만든 플랜은 저장소를 열 때 `core/service/maintenance.ts` 가 보관된 셋업 원문으로 다시 계산한다.
- 용접 중심 오프셋(`weldGeometry.offset`)은 아직 지문에 넣지 않았다(사용자 결정 필요).

## 이미지 보기 (`viewer/`)

OmniPC 처럼 S·C·A·B-scan 을 그리기 위한 읽기. 계산(좌표·색·S-scan 변환·게이트·C/A/B-scan·조각 크기)은 `src/shared/imaging/` 에 있고 main·renderer·테스트가 같이 쓴다. 저장소·사본이 바뀌었는지(키 `storeRoot|fileId|sha256`) 확인은 `core/service` 의 `viewerChunk` 가 한다. 근거와 계획: `../계획_이미지보기/`.

| 함수 | 하는 일 |
| --- | --- |
| `readViewerInfo(path)` | 그룹별 기법·지원 여부(이유)·진폭 경로·축·빔·게이트·시편·파일 화면 상태(색표·현재 빔·레이아웃·C-scan 방향). 수 KB |
| `readViewerChunk(path, group, scanStart, scanCount)` | 진폭 int16 [스캔, 빔, 샘플] + 상태 비트. 조각 하나 32 MB 이하 (`chunkRanges`) |
| `parseModelSetup(xml)` | 비공개 MXU ModelSetup XML 에서 색표 256색·화면 그룹(ID·UserName·CurrentContextID)·CurrentGroupID·CurrentLayout·LayoutGroupMode·IsCScanReversed 만 정규식으로. 화면 그룹 번호는 셋업 그룹 id 가 아니므로 `buildViewerInfo` 가 이름 → 순서로 맞춘다. 실패하면 기본값. 2026-10-07: 그룹마다 저장된 측정값 목록(L1, `groupExtras`)과 파일 쪽 칸(덮개 종류 `WeldTemplateType` L7·저장 앱·장비 `file`)도 |
| `readBusinessSetupXml(file, layout)` · `parseBusinessSetup(xml)` | 비공개 BusinessSetup XML(3.x `/Applications/<앱>`, 4.x `/Private/<앱>`)에서 그룹마다 기준 이득 있음·SoftGain(L4)·첫 빔 게이트의 IsEnabled·EventType·PeakType(L5), 탐촉자 묶음마다 Scan/Index·분석 오프셋·기준점(X7)만 정규식으로. BusinessSetup 그룹 ID = ModelSetup 화면 그룹 번호로 본다(추정 — X3·4.2 COD·X4 TF_L 의 순서·이름이 맞음, 공개 근거 없음) |
| `readImportOffsetWarnings(path)` | 가져오기 미리보기용(X7): 4.x 분석 오프셋 ≠ 0 이면 경고 한 줄('스캔플랜 지문의 탐촉자 위치가 바꾼 값으로 계산'). 3.x 는 읽지 않음, 실패하면 빈 배열(가져오기를 막지 않음). `core/import/analyze.ts` 가 NDE 4.x 항목에 붙인다 |
| `buildViewerInfo` 의 OmniPC 설정 칸 (meta.ts) | `refBasisOf`(X2 Ref 근거 'tcg'·'single-depth'·'none'), `gateModes`(L5 — 봉우리 고르기는 3.x JSON peakDetection → 4.x gateDetection → XML PeakType, 위치 기준은 3.x JSON timeSelection → XML EventType → 4.x gateDetection 순), `fileSourceOf`(L6 — 웨지 오프셋 주의는 **만든** MXU 판 기준), `offsetWarnings`(X7), `parseAppVersion`. 모두 선택 칸이라 기존 칸 값은 그대로 |

`read.ts` 의 `readSavedApplication(modelXml)`·`supplementApplication(props, saved)` 는 파일 메타의 저장 앱 이름이 빠진 경우만 ModelSetup `SoftwareInformation` 으로 보충한다(L6 — 4.0 공식 예제 → OmniPC 6.0.0.647, 새로 가져올 때만).

근거 규칙(OmniPC 조사, 2026-10-07): 위 비공개 XML 칸 이름·값은 **우리 데이터 파일 덤프**(`../../OmniPC_조사/4_NDE설정.md`)와 공개 MXU 설명서·ndeformat 으로만 해석한다. OmniPC 설치본·프로그램 파일은 열거나 근거로 쓰지 않는다(사용권의 역설계 금지).

- 지원: PA 섹토리얼·리니어·컴파운드 펄스에코, 스큐 90/270, 정류된 16비트 진폭 (3.x·4.x). `verified` 는 (형식, 기법)마다 `VERIFIED` 표: 3.x 섹토리얼(X3 12T-SV-01), 4.x 컴파운드·리니어(X4 TF_01_C_L_0001·TF_01_L_0001 GR-2) 는 OmniPC 화면과 대조, 4.x 섹토리얼 스큐 90 은 검증 그룹 교차 대조(TF_01_L_0001 GR-1 ↔ GR-2·장비 TrueDepth, 2026-10-26 — `계획_AI개발/T3_섹토리얼_교차검증.md`), 그 밖(4.x 섹토리얼 스큐 270 등)은 대조 전 표시. B-scan 은 형식과 관계없이 대조 전(화면에 표시).
- 아직 안 그림(이유 표시): UT·ToFD·TFM, 빔 2개 미만, 스큐 0/180·섞인 스큐, RF, 그룹 200 MB 초과, 리니어·컴파운드 중 같은 각도·같은 출사점 빔이 겹치거나 굴절각이 커질 때 출사점이 반대로 물러나는 배치.
- 시간 0 = 진폭 차원 빔의 `ultrasoundOffset`(출사점 기준, beamDelay 더하지 않음). 빔 각도·스큐·출사점도 진폭 차원 값(3.x `paut.beams[].skewAngle` 은 0 이라 쓰지 않음).
- 검증: `tests/core/nde/viewer.test.ts`(X3 + 공식 예제 11개), `tests/imaging.test.ts`(심은 반사체, 리니어·컴파운드 빔 순서), `tests/omnipc.test.ts`(OmniPC 정답표 `tests/fixtures/omnipc/`, 장비 `RawCScan` 교차 확인, `PAUT_VIEWER_SHOTS=<폴더>` 면 대조 그림 저장), `tests/omnipcTf.test.ts`(X4 컴파운드·리니어 캡처 대조).

### Paintbrush 정상입사 매핑 (0.2.3)

NDE 4.x의 `Paintbrush` `[UCoordinate,VCoordinate,Ultrasound]`를 정상입사 선형 PA로 표시한다. 저장 V 위치와 초음파 offset/resolution을 직접 사용하며 탐촉자 설치 오프셋·법칙 지연을 중복 적용하지 않는다. 표면·0° 종파 PulseEcho·법칙별 공통 시간축/게이트·8비트 상태 격자를 확인한다. C-scan은 Index mm 축, 단면은 인덱스·깊이 직교 격자로 그린다.

미취득 셀의 잔존 진폭은 읽어 반환하는 사본에서 0으로 가리고, 상태 비트는 그림·측정값에도 적용한다. 상태가 없거나 좌표/형상이 맞지 않으면 표시를 막는다. 원본 파일과 기존 Beam 방식의 결과는 변경하지 않는다. 일반 경사 Paintbrush나 원래 빔 ID/덮어쓰기 이력의 복원은 지원 범위 밖이다. 위치 대응은 OmniPC 대조 전(`verified=false`)이며 저장 U 좌표를 실측 엔코더 거리·시간순이라고 단정하지 않는다.

실파일 `small flat Al R_0002.nde`는 `[1201,57,348]`, V1.75…29.75 mm, Δt40 ns, 유효1,187행·미취득14행으로 확인했다. 근거와 실제 패키지 QA는 `../../../../검증_NDE_smallflat_2026-10-07/`에 보존한다.
