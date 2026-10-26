# PAUT 데이터 관리 (app)

한국지역난방공사 PAUT 과제용 데이터 관리 데스크톱 앱. Electron 44 + electron-vite 5 + Vite 7 + React 19 + TypeScript 5.9(strict). 폐쇄망 단독 사용: 네트워크 호출·텔레메트리·자동 업데이트·CDN·웹폰트 없음 (폰트는 `pretendard`, `@fontsource-variable/inter` 로컬 번들).

## 구조

```
src/shared/   공유 계약 (런타임 의존성 없음)
  types.ts      데이터 타입 (단위: mm·°·MHz, ISO 날짜, POSIX 상대경로)
  api.ts        IPC 채널(IPC) · 채널별 타입표(IpcContract) · 렌더러 API(PautApi) · API_CHANNEL_MAP
  errors.ts     ApiResult = {ok:true,data} | {ok:false,code,message}, AppError
  modules.ts    관리 기능 모듈 등록 규약 (MODULES, ModuleProps)
  ids.ts        플랜 ID(SP001)·경로 조각 정리·바이트 표시
  imaging/      이미지 보기 계산 (좌표·색표·S-scan 변환·게이트·C/A/B-scan·조각 크기·개선 덮개 weld.ts). main·renderer·테스트 공용
                그리기 최적화(2026-10-07, 그림 바이트 그대로 — tests/imagingFast.test.ts 가 예전 함수 tests/helpers/imagingRef.ts 와 대조): rgba32.ts = 화소 4바이트 한 번에 쓰기,
                B-scan 행 우선(레티나 2400×600 26 → 10 ms)·C-scan 클로저 없앰(20 → 10 ms)·S-scan 조회표 φ 다시 쓰기(90 → 69 ms)
                OmniPC 조사 반영(2026-10-07): cscanExport.ts = OmniPC 'Export C-scan' 꼴 .txt, readings.ts = 측정값 표(공개 MXU 설명서 정의),
                palette.ts parsePal = 사용자 .pal 읽기. 앞 두 개는 index.ts 에 없고 '@shared/imaging/cscanExport'·'@shared/imaging/readings' 로 가져옴
  labels/       결함 라벨 기록 스키마 v1 (types·codes·validate·columns·factory·versions·levels·spans·match·metrics·grouping). 순수 함수.
                columns.ts = 전문가 엑셀 양식 칸(생성기 scripts/label-template/). grouping.ts = 시방서 그림 5·6 그룹 짓기·누적 길이.
                derive/ = 기록 → 학습 라벨(관측 표·세 상태 장면·상자·A-scan 구간·형상 에코 후보·길이 제안, 규칙 버전 2). 계획·규격·평가: ../계획_라벨링/
                review/ = 검수 계산(두 세트 매칭·일치도·Level III 확정 세트 만들기·CSV·평가 보고서). '@shared/labels/review' 로 가져옴
src/core/     Electron 비의존 순수 Node (vitest 로 실데이터 테스트)
  nde/          NDE 3.x·4.x 읽기·정규화·지문·플랜 차이·이름·시편 제안. viewer/ = 이미지 보기용 진폭·화면 상태 읽기
  opd/          OmniScan MX2 .opd 구조 읽기(우리 데이터 바이트·r01·OmniPC 캡처만 근거 — clean-room)·자체 점검·스펙·메타·이미지 보기 정보 (README.md)
  catalog/      catalog.db (node:sqlite, 마이그레이션)
  storage/      입력 탐색·SHA-256·검증 복사·저장 경로 규칙
  import/       분석(판정 미리보기)·확정(복사·기록·이력) 파이프라인
  service/      IPC 계약의 Electron 비의존 부분: 설정·카탈로그 열기/교체·작업 잠금·취소·미리보기 보관
  settings/     설정 JSON
  labels/       라벨 규칙: 저장(검토 구간 풀기·관측 행 지우기)·그룹 짓기·JSON 내보내기·가져오기 병합·충돌 해결 (README.md).
                xlsx/ = 전문가 엑셀 읽기(ZIP·XML, node:zlib, 의존성 없음). 저장소는 catalog/labels.ts (스키마 v2)
                export/ = 학습 데이터 내보내기(형식 2: 가리지 않은 PNG + 가림 마스크 + 학습 분할 가린 사본, COCO·YOLO·npy·manifest, node:zlib) ·
                분할(split.ts)·세트 제출과 설계값 대조 사본 기록(setLocks.ts) — 둘 다 catalog.db label_meta 한 칸 (README.md)
  service/labels.ts · labelWorkbook.ts · labelReview.ts = IPC 'labels:*' 의 Electron 비의존 부분(세션·버전 칸·2인 모드·엑셀 미리보기/확정·JSON·충돌·
                세트 제출/대조 시작·검수 비교/확정·학습 내보내기)
src/main/     Electron main (ESM). handlers.ts = service 위임 + 대화상자·탐색기 열기, smoke*.ts = --smoke
src/preload/  sandbox preload (CJS 번들, index.cjs) — API_CHANNEL_MAP 으로 타입 있는 window.pautApi 노출
src/renderer/ React UI (Tesla 디자인 → design/PAUT_DESIGN.md). api/ = 어댑터(window.pautApi. mock 은 브라우저 미리보기 `dev:web` 에서만 main.tsx 가 따로 불러옴 — `__PAUT_MOCK__`, 운영 묶음에는 가짜 데이터가 없고 preload 를 못 읽으면 오류 화면)
              viewer/ = 이미지 보기 본체(NdeViewer·S/C/A/B-scan 뷰·volumeStore, 앱 틀과 분리 — 나중에 새 창·라벨링에서 재사용), modules/viewer = 얇은 껍데기
              labeling/ = 뷰어의 라벨 모드(오른쪽 라벨 패널·기록 만들기·검토 구간·지시 표·형상 에코·작업 이벤트 세션·검수 비교 보기, README.md)
              modules/labels = 라벨 관리 화면(지금 라벨러·2인 모드·엑셀 미리보기/확정·JSON 가져오기/내보내기·충돌·파일별 현황·검수·학습 내보내기·분할)
tests/        vitest (node 환경). tests/paths.ts 에 실데이터·예제 경로, tests/e2e/ = 실데이터 가져오기 E2E
```

흐름: 렌더러 `getApi().import.analyze(paths)` → preload `ipcRenderer.invoke('import:analyze')` → main `ipc.ts`(신뢰 발신자 확인, ApiResult 포장) → `handlers.ts` → `core/service` → `core/import` → nde·storage·catalog. 진행률은 service 의 `onProgress` → `progress.ts` 가 모든 창에 `event:progress` 로 보낸다(analyze 는 previewId, commit 은 batchId 가 operationId 이며 그 ID 로 취소).

라벨 흐름: 렌더러 `labels.chooseWorkbook()`(main 대화상자, 고른 경로만 허용) → `labels.previewWorkbook(path, { groupChoices, fileChoices })`(엑셀 읽기·저장소 파일과 맞추기·'확정하면 일어날 일') → `labels.commitWorkbook(previewId)`(한 트랜잭션). JSON 은 `labels.chooseJson()` → `labels.importJson(path)`, `labels.chooseExportPath(req)` → `labels.exportJson(req, path)`. 그 밖에 session·setSession(PC ID·지금 라벨러·2인 모드)·registerLabeler(이미 있는 ID 는 overwrite 일 때만)·overview·listSets·listRecords·save/deleteRecord·Observation·Review·appendWorkEvent·listConflicts·resolveConflict, 세트 제출·대조 시작(submitSet·startReconcile)·설계값 목록(physicalDefects), 검수(reviewSources·compareSets·previewFinal·saveFinal·CSV), 학습 내보내기(trainingCandidates·trainingStatus·trainingSplits·setTrainingSplits·lockTrainingTest·chooseTrainingDir·exportTraining·cancelTraining) — 모두 'labels:*' 41개 채널 (`main/smoke.ts` 는 아직 새 채널 단계가 없음. 대화상자 승인 경로·settings:set 라벨 칸·내보낼 범위·색표 막음은 `tests/main/handlers.test.ts` 가 electron 을 흉내 내어 본다). 설정 칸 pcId·labelerId·labelBlindMode·lastLabelDir 는 settings:set 으로 바꾸지 않는다(labels:setSession).

새 관리 기능 추가: `shared/modules.ts` 에 정의 → `renderer/src/modules/<id>/index.tsx` → `renderer/src/modules/registry.ts` 한 줄 (빠뜨리면 typecheck 실패). main 기능이 필요하면 `IpcContract`·`IPC`·`API_CHANNEL_MAP`·`handlers.ts` 에 추가.

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run dev` | Electron 개발 실행 (HMR) |
| `npm run dev:web` | 렌더러만 브라우저에서 (http://localhost:5199, mock 데이터) — UI 검증용 |
| `npm run build` | `out/` 에 main·preload·renderer 빌드 |
| `npm test` | vitest (단위 + 실데이터 E2E. `PAUT_E2E_REPORT=<경로>` 를 주면 E2E 결과 Markdown 저장) |
| `npm run typecheck` | node·web 두 tsconfig 검사 |
| `npm run smoke` | 빌드 후 창 없이 실행·점검 후 종료 (exit 0 = 성공). 아래 참고 |
| `npm run dist:win` | electron-builder nsis x64. 설정: `electron-builder.yml`. 결과: `dist/PAUT-DataManager-<버전>-setup.exe` |
| `npm run dist:mac` | `scripts/mac-dist.cjs`: electron-builder `--mac dir --arm64`(설치된 `node_modules/electron/dist` 를 그대로 써서 내려받기 없음) → ad-hoc 서명 → `dist/mac-arm64/PAUT 데이터 관리.app`. /Applications 로 복사하면 끝. 번들 안 실행 파일·헬퍼 이름은 영문 `PAUT-DataManager`(아래 참고) |

환경 변수 `PAUT_USER_DATA_DIR` 를 주면 userData(설정 파일 위치)를 바꾼다 (테스트·스모크용).

이미지 보기 흐름: 스캔플랜별 데이터 → 파일 펼침 → '이미지로 보기'(파일 펼침의 '파일 설정 보기' 를 누르면 같은 `viewer:open` 으로 파일 출처·Ref 근거·파일 설정 주의를 읽음 — 펼칠 때마다 읽지 않아 뷰어 메타 캐시를 밀어내지 않음) → `viewer:open(fileId)`(메타 수 KB + `key` = storeRoot|fileId|sha256, main 이 사본 경로를 스스로 찾음) → 그룹마다 `viewer:chunk(fileId, key, groupId, scanStart, scanCount)`(int16 조각 32 MB 이하. 그사이 저장소나 사본이 바뀌어 지금 key 와 다르면 `CONFLICT`) → 렌더러 볼륨 저장소(같은 key, 256 MB 상한, 저장소를 바꾸면 비움)에서 C·B·A-scan 을 계산해 Canvas2D 로 그린다. 레이아웃은 A-C-S / A-B-C-S. 그 밖의 뷰어 IPC(2026-10-07): `viewer:exportCscan({ fileId, key, groupId, gate? })` = main 저장 대화상자 → 서비스가 저장된 사본에서 C-scan 을 다시 계산해 고른 경로에만 쓴다(취소면 null), `viewer:openPalette()` = main 열기 대화상자(기본 위치 문서/Evident/OmniPC/Palette, `.pal` 만) → 읽어 검사해 돌려준다(취소면 null). 그리는 기법은 PA 섹토리얼·리니어·컴파운드(펄스에코, 스큐 90/270, 정류 16비트). C-scan 세로축은 섹토리얼·컴파운드 = 굴절각, 리니어 = 빔 번호(1부터, `shared/imaging/beamAxis.ts`), 리니어는 측정값 줄·패널 제목도 '빔 n · 60°'. 계획과 근거: `../계획_이미지보기/`.

후처리(OmniPC 분석 모드 흉내, 2026-10-06 1차 = `../계획_이미지보기/계획_후처리.md` 1·2a·2b·3단계): 범위(C/B-scan 스캔 창, A/B-scan 깊이, C-scan 세로축(각도·빔 번호) 방향 — S-scan 범위 잘라 보기는 사용자 지시로 화면에서 뺐고 모델만 남음), 게이트 A 시작·폭·문턱 편집(C-scan 재계산), 그룹별 소프트 이득·Auto 80 %, 색표 범위. 상태는 `shared/imaging/postprocess.ts`(순수 모델 `PostProcess`, mm·%·dB 단위) + `shared/imaging/postReducer.ts`(순수 리듀서, 되돌리기 10단계) + `renderer/src/viewer/postState.ts`(세션 캐시 — 뒤로 갔다 다시 열어도 유지, 저장소를 바꾸면 비움 — 와 파생 C-scan 캐시 그룹당 3개). 조작: 휠(C/B-scan 스캔·A-scan 깊이 포인터 중심 ×1.25, Shift = 이동, B-scan Alt = 깊이), 눈금자 끌기 = 그 구간 확대·더블클릭 = 그 축 초기화(C/B-scan 스캔·A/B-scan 깊이), 눈금자 위 빨간 다이아몬드 = 게이트 시작·끝·문턱 끌기(S-scan 깊이·A/B-scan 깊이·A-scan 진폭 눈금자; ±6 px 안 가장 가까운 것, 손을 뗄 때 한 번 적용, Esc 취소, 움직이지 않은 클릭은 무시; 다이아몬드 위에서만 ns/ew-resize 커서), S-scan 영상 위 게이트 A 빨간 점선 끌기(모든 S-scan, 선 ±6 px 에서 커서가 바뀌고 6 px 이상 끌면 다이아몬드와 같은 뜻 — 시작 = 폭 유지하고 옮김, 끝 = 폭 바꿈; TrueDepth 는 포인터 깊이, SoundPath 는 포인터 아래 빔의 음로. 6 px 미만은 지금처럼 빔 고르기. 계산 `shared/imaging/sscanGate.ts`). 점선·다이아몬드 공통: 시작·끝이 겹치면(두 선까지 거리 차 1 px 미만 — 폭 0.1 mm 등) 첫 움직임 방향으로 정하고(깊게 = 끝 = 폭, 얕게 = 시작 = 옮김), 끄는 동안 `Ctrl/Cmd+Z` 는 무시한다(잡을 때의 게이트 기준 계산이 어긋나지 않게 — `canvas.ts` `blockUndoWhileDragging`). '조정' 패널(범위·게이트·이득·색표 탭, 한 행 32 px) 숫자 입력, 키 `Z`/`Shift+Z` 범위 초기화·`=`/`-` 이득·`A` Auto 80 %·`Ctrl/Cmd+Z` 되돌리기. 조정값이 없으면 지금(파일값) 그림과 바이트 단위로 같다(`applyGateOverride` 가 파일 배열을 참조 그대로 돌려주고 `gainedScale(…, 0)` 이 같은 객체). 현재 커서·레이아웃·그룹 모드는 저장하지 않는다. catalog 저장·PNG/CSV 내보내기·기준 커서·지시 목록은 2차.

스모크 옵션 (`npm run build` 후 `electron . --smoke ...`): `--smoke-nde=<파일 또는 폴더>`(여러 번 주면 모두 한 번에 가져옴, .nde·.opd 섞어도 됨) 면 `--smoke-store=<폴더>`(기본 userData/smoke-store)를 저장소로 정하고 숨김 창의 렌더러에서 `window.pautApi` 로 settings.get → settings.set → import.analyze → app.info 를 실제 IPC 로 왕복한다. `--smoke-commit` 을 더하면 확정까지 하고 페이지를 다시 읽어 '스캔플랜별 데이터'·'가져오기 이력'·'설정' 화면의 글자를 확인(기대 글자 = 확정 결과의 첫 플랜·첫 사본의 플랜 ID·시편 ID·파일 이름 — X3·OPD 어느 쪽이든), `--smoke-shots=<폴더>` 면 화면을 PNG 로 저장한다. `--smoke-viewer` 를 더하면 첫 파일을 이미지 보기로 열어 진폭이 Int16Array 로 오는지·옛 key 로 요청하면 `CONFLICT` 인지·시간(openMs, chunk.ms)을 기록하고 화면을 캡처한다. 가져온 것 중 OPD 가 있으면 첫 OPD 도 같은 왕복을 하고 `verified = false`·막는 이유가 있는지 본다(`viewer.opd`). 설치본에서는 `PAUT_ALLOW_SMOKE=1` 일 때만 동작.

```
PAUT_USER_DATA_DIR=/tmp/paut-ud ./node_modules/.bin/electron . --smoke --smoke-commit \
  --smoke-nde=".../06_원시데이터/02_라벨완료/X3_12T-SV" --smoke-store=/tmp/paut-store --smoke-shots=/tmp/paut-shots
```

맥 개발 환경의 Claude Code 샌드박스 안에서는 Electron 이 Mach port 권한 오류(SIGTRAP)로 뜨지 않고, dev 서버는 로컬 포트 바인딩(EPERM)이 막힌다. 샌드박스 밖에서 실행하거나 설정 `sandbox.network.allowLocalBinding: true` 를 쓴다. 같은 이유로 electron-builder 의 내려받기도 프록시 뒤에서 실패한다. 이때는 Electron zip 과 nsis-resources 를 curl 로 받아 체크섬을 확인한 뒤 `-c.electronDist=<폴더>`·`ELECTRON_BUILDER_CACHE=<폴더>` 로 넘긴다(0.1.0 설치본을 이렇게 만듦).

맥 앱 주의(2026-10-06): electron-builder 는 `productName` 의 한글을 **NFD(자모 분해)** 로 폴더·plist 에 쓰는데, Electron 은 그 이름으로 헬퍼 앱(`… Helper (Renderer).app`)을 찾지 못해 시작 직후 SIGTRAP(exit 133, 로그 없음)으로 죽는다. 그래서 맥 빌드만 `-c.productName=PAUT-DataManager` 로 번들 안 이름을 영문으로 두고 `mac.extendInfo.CFBundleDisplayName` 으로 Dock·메뉴 이름을 한글로 보인다(.app 폴더 이름은 스크립트가 NFC 한글로 바꿈; `app.getName()` 은 package.json 을 읽으므로 userData 폴더는 개발 실행과 같은 `~/Library/Application Support/PAUT 데이터 관리`). Developer ID 가 없어 ad-hoc 서명(`codesign -s -`)이며 Apple Silicon 은 서명이 아예 없으면 실행이 안 된다. 포장본 점검: `PAUT_ALLOW_SMOKE=1 PAUT_USER_DATA_DIR=<임시> "dist/mac-arm64/PAUT 데이터 관리.app/Contents/MacOS/PAUT-DataManager" --smoke …`(33단계 통과 확인). 개발 실행(`npm run dev`)과 설치본은 같은 userData 를 쓰므로 둘을 동시에 띄우면 두 번째는 단일 실행 잠금으로 바로 꺼진다.

새 맥 앱을 설치하기 전에 사용자에게 알릴 것(2026-10-07, 라벨 기능이 든 첫 빌드): ① 새 앱을 열기 전에 실행 중인 옛 앱(설치본)을 끈다. ② 새 앱이 저장소를 처음 열 때 catalog.db 를 스키마 v2(라벨 테이블)로 올리고, 저장소 폴더에 올리기 전 사본 `catalog.v1-날짜-시각.bak` 을 남긴다. 그 뒤 옛 앱은 이 저장소를 열지 않는다(더 새 스키마는 열지 않음). ③ 옛 앱으로 되돌리려면 새 앱을 끄고 그 `.bak` 을 `catalog.db` 로 바꿔 옛 앱으로 연다(그 사이 새 앱에서 한 라벨 작업은 빠진다). 사용자 저장소 사본(APFS 복제)으로 두 길(서비스·Electron)을 시험해 백업 1개·옛 7개 테이블 그대로·지문 76/76 같음·다시 열면 새 백업 없음을 확인했다.

윈도우 점검: `../윈도우_점검/윈도우_점검.bat` 위에 .nde·.opd 파일(여러 개·폴더 가능)을 끌어 놓으면 설치본을 `PAUT_ALLOW_SMOKE=1 --smoke --smoke-commit --smoke-viewer --smoke-report=<결과.json>` 으로 돌린다(`../윈도우_점검/00_점검_안내.md`).

## 결정 사항

- **SQLite = `node:sqlite` (DatabaseSync)**: Electron 44.5.1 내장 Node 24.21.0(SQLite 3.53.4)과 시스템 Node 24.16.0(SQLite 3.53.0) 모두에서 동작 확인. 네이티브 모듈이 없어 윈도우 빌드가 단순하다. 준비한 문은 SQL 글자마다 256개까지 캐시한다(`catalog/db.ts` — 스키마를 바꾸는 exec·롤백·닫기 때 비움: node:sqlite 가 'SELECT *' 칸 목록을 문에 기억하므로).
- **h5wasm**: `import('h5wasm/node')` (ESM 전용 exports, `require` 불가). Electron main 프로세스에서 우회 없이 동작 확인 (X3 셋업 읽기 12 ms). 그래서 main 은 ESM 번들. wasm 이 `hdf5_util.js` 안에 들어 있어 asar 안에서 그대로 동작하므로 `asarUnpack` 은 쓰지 않는다(`electron-builder.yml`).
- **보안**: contextIsolation·sandbox true, nodeIntegration false, preload 는 타입 있는 API 만 노출. CSP 는 `'self'` (dev 서버에서만 HMR 용 inline style·ws 허용). main 에서 외부 http/ws 요청 차단, 새 창·외부 이동·webview·권한 요청 거부, 맞춤법 사전 다운로드 끔. IPC 는 신뢰 발신자(file:// 또는 dev 서버)만.
- **오류 규약**: 모든 API 는 `Promise<ApiResult<T>>`. core/main 은 `AppError(code, 한국어 메시지)` 를 던지고 IPC 레이어가 포장한다.
- **시편은 전역 엔터티**: 같은 시편이 여러 플랜으로 스캔될 수 있어 플랜 소속은 파일 레코드로 정한다 (`SpecimenSummary.planIds`).
- **경로 주의**: 이 맥의 상위 폴더 `01_프로젝트` 는 디스크에 NFD 로 저장되어 있다. 경로 비교·중복 판정은 NFC 정규화 후에 할 것.
- TypeScript 는 7.x(네이티브) 대신 5.9.3, Vite 는 electron-vite 5 호환인 7.x 사용.
- **가져오기는 main 프로세스에서 비동기로**: 해시·복사는 스트림(1 MB 청크), NDE 셋업 읽기는 파일당 1~7 ms, 파일마다 `setImmediate` 로 이벤트 루프에 양보한다. 실측(맥): X3 4개 129 MB 분석 0.14 s, 복사·검증·기록 0.19 s. 수천 개 단위로 UI 가 끊기면 utilityProcess 로 옮긴다(service 가 Electron 비의존이라 그대로 옮길 수 있음).
- **작업은 한 번에 하나**: 분석·확정 중 두 번째 요청과 저장소 변경은 `BUSY`. 잠금은 첫 await 전에 잡는다.
- **확정의 일관성**: 파일 복사(파일시스템)와 DB 기록은 한 트랜잭션으로 묶을 수 없으므로 복사 → 검증 → DB 트랜잭션(플랜 생성 + 시편 ensure + 파일 기록) 순서로 하고, DB 가 실패하면 방금 만든 사본과 빈 폴더를 지운다. 새 플랜은 첫 파일이 성공할 때 만들어 빈 플랜이 남지 않는다.
- **원본 변경 감지**: 확정 때 원본을 읽으면서 다시 해시해 분석 때 SHA-256 과 다르면 그 항목만 실패(`HASH_MISMATCH`).
- **셋업 원문 보관**: `file_setups` 에는 검증된 사본에서 다시 읽은 셋업 JSON 원문을 넣는다(미리보기에 원문을 들고 있지 않아 메모리 절약).
- **시편 ID 대체 규칙**: PL·TP·TF 번호가 없으면 파일명(확장자 제외)을 정리해 제안한다(출처 'filename'). 사용자가 미리보기에서 고친다. TF 번호(자체 X4 Sonaspection 시편)는 쓰는 이름 그대로 'TF_01'(2026-10-26, AI 개발 플랜 T4).
- **시편 다시 묶기** (2026-10-26, `core/service/specimenRegroup.ts`·시편 화면 알림): 출처 'filename' 인 파일을 지금 패턴으로 다시 보고 시편 번호가 나오면 그 시편으로 옮긴다(미리보기 → 확인). 카탈로그 시편만 바꾸고 사본은 옮기지 않는다(저장 경로는 파일마다 있어 옛 시편 폴더 이름이 남아도 됨). 옛 시편에 물리 결함·학습 분할이 있거나 잠긴 시험 세트로 가면 막고 사유를 보인다. 학습 분할(시편 단위)과 물리 결함 연결(L·R·다중 그룹 같은 결함)이 시편 단위로 맞게 하려는 것.
- **계층 종류·근거 등급** (2026-10-26, `shared/labels/taxonomy.ts`): L0/L1/L2·근거 등급 A~D·D3 확정/미확정·겹침을 저장 칸에서 계산한다(스키마 버전 1 그대로). 지시 표 고른 기록 아래 '분류·정답·겹침', 학습 내보내기 labels.json `taxonomy`·COCO 속성. 규칙: `../계획_AI개발/T2_계층종류_근거등급_규칙.md`.
- **새 플랜 이름 규칙** 기본값은 `{name}`(예: `12T V · 5L64-A32 · ±15mm · 40–70°`). 설정 `newPlanNameTemplate` 에서 `{summary}`·`{id}` 도 쓸 수 있다.
- **저장소 폴더가 사라진 경우**(USB 분리 등) 빈 저장소를 새로 만들지 않고 `STORE_ROOT_INVALID`. 새 폴더는 사용자가 직접 고를 때만 만든다.
- 창 최소 크기 1280×800 (디자인 9절).
- **이미지 보기는 읽기 전용·잠금 없음**: 가져오기 BUSY 잠금과 무관하게 저장된 사본만 읽는다(원본·임의 경로는 받지 않음). 쓰는 것은 C-scan 내보내기 하나뿐이고, 사용자가 대화상자에서 고른 경로에만 쓴다 — 저장소 폴더 안, 가져올 때의 원본 폴더(그 아래 포함), 측정 원본(.nde·.opd·.oud·.wkb)이 바로 든 폴더는 거절하고, 대화상자가 묻지 않은 '.txt' 를 붙인 이름이 이미 있으면 덮지 않는다(CONFLICT). 색표 불러오기는 고른 `.pal` 만 읽는다(1 MB 이하). main 은 요청마다 열고 닫으며 메타만 4개 캐시(저장소를 닫으면 비움). 진폭은 렌더러가 들고 C·B·A-scan 을 직접 계산한다(C-scan 그룹당 5~27 ms. S-scan 조회표(buildSscanMap)는 배율 1 600×450 약 16 ms, 레티나 상한 1.6 M화소(1460×1095) 약 90 ms, 그 뒤 한 장은 600×450 약 2 ms · 1460×1095 약 13 ms — M5 Pro 실측, 윈도우 125·150 % 는 윈도우 점검 때 더함 — 범위를 바꾸는 중에는 마지막 정확 프레임을 오프스크린 캔버스에서 늘려 보이고 80 ms 멈춘 뒤 한 번만 다시 만든다). 조각 요청에 열 때의 key 를 실어, 다른 저장소의 같은 번호 파일이 섞이지 않게 한다(`CONFLICT`).
- **OmniPC 와 같은 그림의 근거**: 시간 0 = 빔 `ultrasoundOffset`, 빔마다 자기 출사점에서 같은 음로로 보간, 파일 ModelSetup 의 256색. X3 12T-SV-01 을 OmniPC 6.6 캡처와 겹쳐 확인(`tests/omnipc.test.ts`, 정답표 `tests/fixtures/omnipc/`). 같은 테스트에서 장비 `RawCScan` 과 게이트 A 값을 교차 확인(그룹 0 9185/9331칸 정수 일치). 대조 여부는 (형식, 기법, 스큐)마다 `core/nde/viewer/meta.ts` 의 `VERIFIED` 표로 정하고(열쇠 '기법:스큐', NDE 는 '기법:*' 라 스큐와 무관 — 3.x 섹토리얼, 4.x 컴파운드·리니어. OPD 는 빈 표), 대조 전 조합(지금은 4.x 섹토리얼·모든 OPD)과 B-scan 은 '대조 전 (NDE 4.x 섹토리얼 · B-scan)'·'대조 전 (OPD 섹토리얼 · 스큐 90 · 진폭 눈금)' 처럼 이름으로 표시.
- **컴파운드·리니어는 섹토리얼과 같은 S-scan 규칙**(빔마다 자기 출사점에서 같은 음로, 이웃 두 빔 섞기, 두 빔 모두 샘플이 있을 때만 그림)이다. 빔 순서는 (굴절각, s·출사점 V) 사전식으로 놓고 이분 탐색한다(같은 각도·같은 출사점 빔이 겹치거나 각도가 커질 때 출사점이 반대로 물러나면 '아직 그리지 않습니다'). OmniScan X4 4.2 TF_01_C_L_0001(컴파운드 50~68°)·TF_01_L_0001 GR-2(리니어 44빔 60°)를 OmniPC 6.6 캡처와 대조(`tests/omnipcTf.test.ts`): A% 2.61/3.27(화면 2.6/3.3), 게이트 점선 깊이 차 ≤ 0.07 mm, 첫·끝 빔 경계 ≤ 0.13 mm, C-scan 무늬 상관 0.999, 컴파운드 톱니 경계가 갈리는 픽셀의 91 % 일치. 리니어 C-scan 축은 캡처 눈금 회귀로 빔 번호 [1, 45](빔 n 칸 = [n, n+1])로 판정. 섹토리얼 조회표는 바꾸기 전과 바이트 단위로 같음(SHA-256 30/30). 라이트 테마 S-scan 외곽선·개선 덮개 클립은 조회표와 같은 데이터 경계(`shared/imaging/sscan.ts` `sscanOutline` — 띠마다 첫·끝 샘플 원 두 개의 바깥/안쪽 경계, 띠 사이는 빔 선을 따라 뜀)를 그린다: 예전 직선 외곽선은 컴파운드 톱니 홈을 최대 10.3 px(1.3 mm) 감쌌고 지금은 조회표와 0.02 px 안(`tests/sscanOutline.test.ts`, 데이터 픽셀은 SHA-256 고정으로 그대로).
- **라벨 작업은 가져오기 잠금(BUSY)과 무관**: 카탈로그 쓰기는 동기 트랜잭션이라 섞이지 않는다. 다만 라벨 작업 중에는 저장소를 바꿀 수 없고(BUSY), 저장소를 바꾸는 중에는 라벨 작업을 받지 않는다(BUSY).
- **라벨 버전 칸 = 'PC ID:복제본 ID'**: 복제본 ID 는 (PC ID, DB 파일 위치)마다 저장소가 만든다. 같은 PC 의 저장소 둘, 복사한 DB, 다른 PC 와 같은 PC ID 가 서로의 수정을 조용히 덮지 않는다. 백업에서 되돌린 저장소는 userData/label-replicas.json 의 쓰기 횟수로 알아채 새 칸으로 바꾸고 라벨 관리에 알린다. PC ID 는 이 저장소 기록에 다른 PC 이름으로 나오면 바꿀 수 없다.
- **엑셀 재가져오기는 3-way**: 엑셀이 그 줄의 원본이지만, 지난 가져오기 뒤 앱·다른 PC 에서 고친 줄은 덮지 않고(같은 엑셀이면 그대로, 엑셀도 바뀌었으면 충돌), 엑셀이 지운 줄은 다시 적으면 되살린다(`core/labels/README.md` 표). 미리보기는 고침·지움 표시·충돌 목록을 보이고 확인을 받은 뒤 확정한다.
- **2인 독립 모드는 실수 막기용(보안 장치 아님)**: 목록·쓰기·충돌 해결·다른 라벨러 정보 고치기·엑셀 미리보기와 확정(다른 판독자 엑셀은 `INVALID_ARGUMENT`)을 지금 라벨러로 막고, JSON 내보내기도 지금 라벨러 세트만 담는다. 두 판독자 화면을 같게 하려고 색표(.pal) 불러오기도 막는다(main 핸들러에서 한 번 더). 라벨러 바꾸기·모드 끄기는 한 번 더 묻는다. 내보낸 파일이나 DB 를 직접 열면 다른 기록을 볼 수 있다(사용자 확인 필요).
- **후처리는 읽기 전용 위에 덧씌운다**: 원본·사본 .nde 는 그대로이고 조정값은 세션 메모리에만(2차에 catalog). 게이트 편집은 파일 µs 를 재환산하지 않고 사용자가 값을 바꿨을 때만 mm → µs 로 환산한다(파일 게이트 A 7.0/21.0 mm 를 우리 식으로 재환산하면 3.8~11.8 ns, 0.1~0.3 샘플 어긋나므로). 게이트 B 재계산이 장비 `RawCScan` 과 정수로 같은 칸 수(그룹 0 9178/9331, 그룹 1 9028/9331)를 회귀 스냅샷으로 고정했고, 게이트 I 는 저장 구간 밖에서 시작해 한 점만 본다. 소프트 이득 = 저장 진폭 × 10^(dB/20), 색 번호는 100 % 에서·읽기값은 unitMax(200 %) 에서 포화 — OmniPC 캡처(17·18·44)로 대조하기 전이라 Δ ≠ 0 이면 'OmniPC 대조 전 (이득)' 표시.
- **라벨 덮개는 라벨 모드에서만, 따로 겹친 캔버스에** (예외: A-scan 기준선 `.vplot__levels` 는 보통 모드에서도 사용자가 켤 수 있다 — 기본 끔, 끄면 캔버스를 만들지 않아 바이트 그대로. 아래 'OmniPC 설정 반영'): 영상 캔버스 위에 포인터를 받지 않는 덮개 캔버스(`.vplot__overlay`)를 두고 기록 상자·점·시간 커서를 거기에만 그린다. 보통 모드 영상은 바이트 그대로이고(viewer-steps 가 켜기 전·끈 뒤를 비교), 라벨 모드에서 커서·덮개만 바뀌면 영상을 다시 칠하지 않는다. Electron 에서 캔버스 크기가 바뀐 뒤 첫 그림은 반투명 점선의 바이트가 다시 그린 것과 다를 수 있어, 시험은 비교 전 한 번 다시 그린다.
- **확정 세트는 검수 화면(saveFinal)에서만**: 서비스가 판독 단계 '확정' 세트의 기록·관측·검토 구간 저장·지움을 거절한다(INVALID_ARGUMENT). 블라인드 세트는 '제출'로 잠그고(CONFLICT, 풀 때 이유를 기록), 설계값 대조는 새 UUID 로 복사한 대조 세트에서 한다(`core/labels/export/setLocks.ts`, label_meta 'set-locks', 다른 PC 로 건너가지 않음). 앱 밖 경로도 같은 보호(2026-10-07): 엑셀 다시 가져오기는 제출한 세트·검수 확정 세트가 있는 파일의 확정 단계·잠긴 시험 파일의 확정 단계 줄을 '그대로 둠'으로 하고 이유를 보이며, 충돌 해결의 '들어온 것'·'둘 다'는 그 세트에서 CONFLICT. JSON 가져오기는 막지 않고(잠금이 이 저장소에만 있음) 제출한 세트가 바뀌면 경고한다. 앱 '설계값 대조 시작' 사본에 같은 사람 대조용 엑셀을 넣어도 같은 지시 번호를 새로 만들지 않는다. 검수 확정은 원본 기록의 전문가 관측 확인(expertConfirmed)을 확정 기록으로 옮긴다(대조 시작과 같은 규칙, 원본에서 거두면 다시 저장할 때 지움 표시). 학습 세트 고르기는 검수 출처 없는 기록이 섞인 확정 세트에 '검수 출처 일부 없음'을 붙인다.
- **라벨 JSON 백업이 담지 않는 것**: 기록·관측·검토 구간·작업 이벤트·정렬·물리 결함·라벨러는 담지만, 제출(잠금)·대조 사본 출처·학습 분할·시험 세트 잠금(모두 이 저장소 label_meta)과 엑셀 가져오기 표시(label_import_marks)는 담지 않는다. 그래서 JSON 으로 되돌린 새 저장소에서는 제출했던 블라인드 세트를 다시 고칠 수 있고, 같은 엑셀을 다시 가져오면 앱에서 고친 줄이 '그대로 둠' 대신 '충돌'로 보인다. 저장소를 통째로 백업하려면 앱을 끄고 catalog.db 를 복사한다. 라벨 관리 'JSON 백업 내보내기' 대화상자에도 담지 않는 것과 catalog.db 복사를 한 문단으로 알린다(`modules/labels/ExportDialog.tsx`, 2026-10-07 최종 검증 때 더함).
- **내보내기 쓰기 경로(원시데이터는 읽기만)**: C-scan .txt·라벨 JSON·검수 CSV·학습 데이터 폴더 모두 저장소 폴더 안·가져올 때의 원본 폴더(그 아래 포함)·측정 원본(.nde·.opd·.oud·.wkb)이 바로 든 폴더를 거절한다(`core/service/exportTarget.ts`, 대화상자로 고른 경로만 받는 것과 별도).
- **검토 완료 구간은 기록의 위치·길이·구분이 바뀔 때만 풀린다**(`releasesReviews`): 메모·속성·화면 스냅샷만 고친 저장, 형상 에코 승인은 풀지 않는다. 새 결함 기록은 겹치는 같은 그룹 구간을 푼다.
- **학습 내보내기 형식 2**: 그림은 가리지 않고(`images/`), 가림은 마스크 파일(`masks/`, 0 = 그대로 · 1 = 게이트 밖 · 2 = 라벨 가림)로 따로 낸다. 검정 칠한 사본은 학습 분할에만(가림이 정답 위치를 알려 주지 않게). 시험 분할은 확정 세트만(기본). manifest 에 datasetId·분할 전체 표와 해시·그림 규칙 버전·색표 해시. 그림 PNG 의 deflate 는 libuv 스레드풀에서 4장면까지 겹쳐 하고(같은 수준·같은 바이트, 쓰기·해시는 장면 순서대로) 양성 상자는 칸별 화소 상자 표로 구한다 — X3 4개 그림 켬 기준 2026-10-07 측정은 아래 '성능' 문단.
- **OPD(OmniScan MX2 .opd) 읽기 — 근거와 위치(2026-10-07, `OPD_조사/판단.md` 방법 (A))**: 우리가 TypeScript 로 새로 만든 구조 읽기(`core/opd`)로 `ScanPlanSpec`·`NdeFileMeta`·`ViewerFileInfo` 에 맞춘다. OmniPC 로 .nde 변환하는 길은 없다(판단.md 1절). 근거는 우리 데이터 파일 162개의 바이트, SEC20 r01 36개, OmniPC 화면 캡처 2장, `OPD_조사/1_파서실험.md`·`3_화면대조.md` 뿐이다(clean-room). OmniPC 설치본 분석 결과와 `2_공식경로.md` 는 쓰지 않았고, Python 프로토타입은 옮기지 않았다. 칸마다의 근거는 `core/opd/README.md` 위치표, 실험 스크립트·전수 결과는 `../OPD_조사/실험기록/`. 고객이 만든 데이터 파일의 형식을 읽는 일이라 **내부 연구용**으로 진행하고 상용화 전에 법률 검토·Evident 질의를 한다. 화면 표시는 'OPD · 자체 해석 · 대조 전'('역설계'라는 말은 쓰지 않음)이고 미리보기 항목 아래에 '정확도 대조 전 — 자동 변환·학습 내보내기 막힘' 한 줄을 글자로 둔다. 구조 점검이 하나라도 안 맞으면 '보류(해석 실패): …'(`NDE_READ_ERROR`)로 가져오지 않는다. 샘플 수 320 은 파일 칸이 아니라 가정이라 위치 수를 스캔 길이 칸(1축 ±1)·인덱스 칸(2축 줄 수)과 교차 확인한다. 읽기 규칙 버전 `opd-structure` v4, 스펙 규칙 3(짝은 시험이 확인). 추가 근거는 `../OPD_조사/4_시편용접_해석.md`와 사용자 PL23861 설정 캡처다.
- **OPD 대조·막힘 규칙**: `VERIFIED` 의 OPD 표는 비어 있어 모든 OPD 그룹이 `verified = false`('대조 전') — 라벨 기록은 되지만 derive·학습 내보내기는 지금 규칙으로 막힌다. 올리는 조건: 캡처 O1·O2·O9 + O4(섹토리얼·스큐 90), TP14-ROOT-R 1장(스큐 270), O5(리니어), O8(6.4T TCG 없음) 대조 테스트(`tests/omnipcOpd.test.ts`) 통과(판단.md 3.2·8절). 올린 뒤에도 파일마다 `verified = 대조 표 && 자체 점검 통과`: 게이트 A 재계산이 저장 구간 안 칸 ≥ 95 % **그리고** 전체 칸 ≥ 95 % 이고 설명할 수 없는 어긋남(장비 값 < 재계산) ≤ 10 %(저장 구간 안 칸이 없으면 판정 못 함 = 대조 전), 스넬 ≤ 0.05 mm, 두께 일치, 손상 의심 프레임 0. 162개: 통과 88 · 실패 31 · 판정 못 함 36(TP14-ROOT-L 포함). 그 밖에 형식 이유(`ViewerGroup.blockReasons`: 대조 전·진폭 눈금 추정·시편 형상 모름·두께 칸 의심·게이트 A·센 신호(raw ≥ 224) 칸 일치율·손상 의심·스넬)를 derive·학습 내보내기에 넘겨 막는다 — 진폭 눈금(255 = 250 %)이 추정인 동안 %FSH 는 내보내지 않는다. 학습 내보내기는 파일 정렬에 실측 두께가 있으면 '두께 칸 의심' 항목만 뺀다. 설명할 수 없는 어긋남이 10 % 를 넘으면 래스터 배치를 믿을 수 없어 이미지 보기도 그리지 않는다.
- **OPD 가져오기·플랜 (v0.2.1)**: 꼬리의 이름 붙은 속성 표에서 시편 형상·재질·탐촉자 전체 소자 수·초기 스캔 위치·용접 템플릿·대칭 코드를 읽는다. 형상 0→판재, 재질 30→STEEL, MILD는 SEC20 r01 36개로 대조했다. PL23861 설정 화면으로 템플릿 5→Double V-Offset, 대칭 0→Symmetric을 확인했다. 다른 코드는 이름을 추측하지 않고 보존한다. Hot Pass·Land·Root 높이/각도/오프셋을 `specimen.weld`에 저장하며 Root를 누락한 과거 PL 두께 경고를 제거했다. Fill 높이는 두께에서 알려진 세 층 높이를 뺀 **계산값**으로 구별하고, 직접 해독하지 못한 Fill 각도·HAZ·상/하부 캡은 모름으로 둔다. 용접 155개 모두 층 높이 합이 두께와 같고, OPD 162개의 기존 플랜 35개 분류는 유지된다.
- **OPD 저장소 갱신**: 스펙 규칙이 바뀐 플랜을 열면 저장소 사본의 SHA-256을 대조한 뒤 새 규칙으로 다시 읽는다. 플랜 스펙/지문/요약과 파일별 읽기 규칙/수집 요약/셋업 JSON을 한 트랜잭션에서 갱신한다. 파일 ID·시편 ID·저장 경로·해시·사용자 메모·라벨 연결은 유지한다. 내용이 바뀐 사본에서 갱신하지 않는다. 기존 플랜과 지문이 겹치면 자동으로 합치지 않고 안내한다.
- **OPD 이미지 보기**: 시편·용접 설정을 뷰어로 전달하고, Double V를 Hot Pass·Land·Root의 실제 층 높이에 따라 그린다(중간점 가정 없음). 아직 템플릿 이름을 해독하지 못한 코드는 치수에서 그린 대칭 참고 단면으로 표시한다. 게이트 문턱은 꼬리의 `FblUT_Gate_GROUP` 한 바이트 값으로 읽고 보고서/화면과 대조했다. 빔별 값이 다른 게이트는 하나의 대표 문턱을 만들지 않는다. 시편/게이트 설정을 읽었다고 이미지 진폭 정확도 검증까지 완료된 것은 아니므로 OPD `VERIFIED` 표와 진폭 눈금/스큐 270/스캔 동기 제한은 유지된다. 2축(부식) 7개는 보관만 한다.
- **시편 화면**: 시편 ID·이름·태그·셋업으로 검색하고 연결된 플랜과 파일을 본다. 같은 시편의 다른 플랜에서 두께/개선 설정이 다르면 각 플랜의 설정을 별도로 표시한다. 파일 상세에는 이득·음속·게이트 시작/폭/문턱·스캔 범위·교정/동기 정보와 파일 설정 주의를 표시한다.
- **OPD 용접 형상 반박 검토 (2026-10-07)**: 162개를 읽기 규칙 4 로 다시 읽어 칸 뜻·묶음이 `../OPD_조사/4_용접형상.md` 5절과 같음을 확인했다(용접 155개 두께 = Hot Pass + Land + Root, 플랜 35개). 틀 코드 5(양면 V)의 덮개는 같은 파일 OmniPC 캡처 덮개선과 0.2 mm 안(`tests/core/opd/weldOverlay.realdata.test.ts`), 코드 6 덮개는 같은 12T SV 설계 X3 .nde 덮개와 점이 같다(HAZ 선만 다름). 사용자 저장소 복제본에서 OPD 플랜 1개만 갱신되고 NDE 76개 지문·스펙·요약은 바이트 그대로. 고친 것: 늘 붙던 '동기 모름' 경고(엔코더 127·시간 35 로 가름), 이미지 보기 막는 이유에 '시편 형상 추정', 라벨 경고의 '채움 높이 + 랜드' 글, 실제 앱 시나리오 OPD 두 단계·브라우저 mock 을 지금 규칙으로. 남은 것: 코드 5·6 이름·캡·HAZ 칸 캡처, 기존 OPD 플랜 이름의 옛 '채움 …' 글(사용자 결정) — `4_용접형상.md` 8절.
- **OPD 라벨 기록**: 기록·앵커·JSON 왕복은 NDE와 같다. 형상 정보가 추가되어도 대조 전 그룹의 자동 변환·학습 내보내기는 기존 제한을 유지한다. 진폭 눈금·스큐 270 부호와 같이 남아 있는 추정은 화면과 기록의 출처에 남긴다.
- **OmniPC 설정 반영 (2026-10-07, `../OmniPC_조사/조사_보고.md` 6절)**
  - **근거 규칙(클린룸)**: OmniPC 사용권은 역설계를 금지한다. 코드·문서의 근거는 (a) 공개 MXU 4.4·5.6·5.8 설명서·릴리스 노트·ndeformat, (b) 사용자 파일(`~/Documents/Evident/OmniPC` 의 `.pal`·Export `.txt` — 읽기만, 시험도 읽기만), (c) 우리 데이터 파일 덤프, (d) OmniPC 를 보통으로 써서 얻은 화면 캡처·내보내기뿐이다. OmniPC 설치본·EXE·DLL 은 열지 않는다. **Evident 색표 파일은 앱·시험 자료에 복사해 묶지 않는다**(사용자 폴더에서 불러오기만). 앱 기본 진폭 색표(`palette.ts` `DEFAULT_AMPLITUDE_PALETTE`)는 우리 .nde 파일 ModelSetup 에서 옮긴 256색인데, 사용자 폴더 `EVDNT_Amplitude.pal` 과 256색이 같다(아래 사용자 결정 6). 시험의 그 같음 확인(`tests/omnipcSettingsPal.test.ts`)은 사용자 폴더가 있을 때만 돈다.
  - **읽는 것(모두 선택 칸 — 기존 칸 값은 그대로)**: X2 Ref 근거 단계(`refBasis`·`refPct`, Ref % 가 표시 상한을 넘으면 경고), X7 탐촉자 위치·분석 오프셋(`positioning` — 0 이 아니면 뷰어 '파일 설정 주의'와 **가져오기 미리보기 항목 경고**), L1 저장된 측정값 목록(`display.readings`)·측정값 툴팁(설명서 정의), L4 저장된 분석 이득(`softGainDb` — 경고와 이득 탭 '이 값으로' 단추, 자동 적용 안 함), L5 게이트 켜짐·봉우리 고르기·위치 기준(`enabled`·`detection`·`event`), L6 파일 출처(`info.source` — 만든·고친·저장 앱, 장비, OmniPC 재저장, **만든** MXU 판이 6.3.0 전인 X4 웨지 오프셋 주의 — 대조 전), L7 덮개 종류(`weld.template`).
  - **학습 내보내기 바이트 그대로**: 새 칸(L5 게이트 세 칸, L7 `weld.template`)은 meta.json 에 넣지 않는다(`exportTraining.ts` `gateMeta`·`specimenMeta` — 형식 2 가 처음부터 담던 칸만). 새 칸을 내보내려면 `TRAINING_EXPORT_VERSION` 을 올린다. 학습 그림 바깥 색은 `EXPORT_OUTSIDE_SPECIAL_INDEX`(808080 고정)이고 뷰어 데이터 없음 색 `VIEWER_NO_DATA_SPECIAL_INDEX` 와 별칭이 아닌 따로 된 상수다(X11 ① — 옛 이름 `NO_DATA_SPECIAL_INDEX` 는 지움). 뷰어 색을 설명서 순서(특수색 1번 검정)로 바꾸는 것은 캡처 10·11 뒤.
  - **보통 모드 그림 바이트 그대로의 예외(의도)**: ① ERW 덮개 파일(공식 예제 4.2 COD)은 개선면 대신 이음매 선을 그려 보통 모드 S-scan 덮개가 바뀐다. ② A-scan 기준선은 사용자가 켤 때만(보통 모드 기본 끔). ③ 같은 플랜 파일이 둘 이상이면 도구막대에 '◀ n/N ▶'(약 90 px, 한 줄 그대로 — 보통 모드 도구막대는 줄을 바꾸지 않는다). 디자인 문서 2절 예외 줄에 같이 적었다.
  - **X3 A-scan 기준선**(`renderer/src/viewer/levelLines.ts`): 기록 기준·평가 기준 세로 점선(파일 이득 화면 기준, 화면 이득 Δ 만큼 옮김). 'Ref' 라는 이름의 선(X3 159.6 %)은 그리지 않는다 — OmniPC 의 'Ref.'(80 % 빨간 TCG 선)와 다른 높이에 보여 헷갈리므로. Ref 값은 조정 패널 툴팁 글자에만. 켜고 끄기는 조정 → 색표 → 색 범위, 라벨 모드 기본 켬.
  - **X8 C-scan 내보내기**(조정 → 내보내기): 머리말 21줄·탭·CRLF·줄 = 인덱스 끝 → 0(TP14 사용자 Export·설명서). OPD 의 Inspection Date 는 TP14 대로 0001-01-01, NDE 는 파일 생성일(확인 전). OPD에서 문턱을 읽으면 그 값이 Gate Level에 들어가고, 읽지 못한 경우에는 게이트 탭에서 넣은 값이 된다(둘 다 모르면 빈 칸). TP14 를 앱 경로로 내면 머리말 21줄이 사용자 Export 와 글자 그대로 같고, 값은 '차 ≤ max(1 %p, 1 %)·한 칸 어긋남 허용' 으로 98.3 % 이지만 **소수 둘째 자리까지 같은 칸은 거의 없다**(OPD 진폭 눈금 추정 — 캡처 14). 확인 전 칸(리니어 'VPA'·컴파운드 인덱스 칸, NDE 의 Ampl. End·날짜·두께, OPD 진폭 눈금)은 결과의 `unconfirmed` 로 화면에 '대조 전' 칩.
  - **X9 이전·다음 파일**(도구막대 '◀ n/N ▶', 키 `[`·`]`): 같은 스캔플랜 전체를 시편 → 파일 이름 순서로(2026-10-07 기본값 — 아래 결정 대기 2, `viewer/fileNav.ts` — 확장자를 뗀 줄기를 숫자 값 순으로 먼저 견줌, 같으면 확장자·ID). 라벨 모드면 다음 파일도 라벨 모드(볼 수 없는 파일 화면을 거쳐도). 라벨·후처리 세션은 파일마다 남고, 저장하지 않은 초안이 있는 세션은 16개 상한에서 버리지 않는다(64개까지 — `labeling/session.ts`). 라벨 패널 안에 포커스가 있으면 `[ ]` 를 받지 않는다.
  - **L2 색표 불러오기**(조정 → 색표 → 색표 파일): 고른 `.pal` 은 이 실행 동안 모든 파일 보기에 쓴다(2026-10-07 기본값 — 아래 결정 대기 3; `PostProcess.paletteFile`). '색표 초기화'·'파일값으로'·되돌리기로 빠지고, 빼면 그림이 바이트 그대로. NDE 도 경고 줄 아래 '색표: 불러옴 (이름)' 한 줄을 보인다. 라벨 기록의 화면 스냅샷(불투명 JSON — 기록 스키마는 그대로)에 `paletteFile{name, sha256}` 을 남긴다(sha256 = 256색 'rrggbb' 를 ',' 로 이은 글자의 SHA-256 — 학습 내보내기 manifest 색표 해시와 같은 규칙, `labeling/record.ts` `paletteSha256`; 색표를 불러오지 않은 기록에는 칸이 없음). 2인 독립 모드(`settings.labelBlindMode`)에서는 불러오기를 막는다(두 판독자 화면을 같게 — 렌더러와 main 핸들러).
  - **L5 측정값 이름**: 앱 값은 늘 가장 큰 봉우리(^) 기준이라 파일 게이트가 첫 봉우리·문턱 교차여도 이름을 바꾸지 않고, '게이트 설정' 줄에 OmniPC 이름(^1·/)과 '앱 값과 다를 수 있음(대조 전)' 을 글자로 보인다(봉우리 고르기를 모르면 '봉우리 고르기 모름').
- **사용자 결정 대기 (OmniPC 조사 반영 뒤 · 2026-10-07 최종 검증 때 갱신 — 2·3 은 기본값으로 돌고 있고 확인만 남음, 8·9 새로 적음)**
  1. X7: 스캔플랜 지문 (c) 탐촉자 위치를 취득값(= JSON − 분석 오프셋, `ViewerGroup.positioning`)으로 계산할지. 지금은 JSON 값 그대로(OmniPC 분석 화면과 같은 위치)이고 가져오기 미리보기에 경고만 낸다. 실데이터 X3·X4 는 모두 0 이라 영향 없음(공식 예제 4.2 Sect −52 mm·4.2 ToFD ±0.13 mm 만).
  2. X9 범위 — **기본값으로 정함(사용자 확인 대기, 2026-10-07)**: 같은 스캔플랜 전체를 시편 → 파일 이름 순으로 넘긴다(전에는 같은 플랜·같은 시편 안에서만 — X3 2인 판독 4개는 시편이 모두 달라 단추가 보이지 않았음). 되돌리려면 `fileNavOf` 거르기만 바꾸면 된다.
  3. L2 — **기본값으로 정함(사용자 확인 대기, 2026-10-07)**: 불러온 색표는 세션 전체(모든 파일)에 쓰고, 기록 스냅샷에 불투명 칸 `paletteFile{name, sha256}` 을 남기며(기록 스키마는 그대로), 2인 블라인드 판독(`settings.labelBlindMode`)에서는 색표 불러오기를 막는다.
  4. L4: 파일의 OmniPC 분석 이득(4.2 ToFD 예제 20 dB 등)을 화면 이득 Δ 초기값으로 자동 적용할지(지금은 단추로만 — 보통 모드 그림이 바뀌므로). 캡처 17·34 뒤.
  5. L5·L1: First·Edge 게이트 파일의 측정값을 따로 계산할지, 측정값 줄 칸 순서를 파일의 OmniPC 목록 순서에 맞출지(지금은 툴팁에 '목록 n번째 칸' 만).
  6. 기본 진폭 색표: 앱 기본값이 사용자 폴더 `EVDNT_Amplitude.pal` 과 같다(우리 .nde 에서 옮긴 값). 열린 NDE 는 늘 파일 안 색표를 쓰고 기본값은 대신 쓰는 값일 뿐이며, OPD 만 '앱 내장 색표' 로 칠한다. 기본값을 앱이 만든 중립 색표로 바꿀지(바꾸면 OPD 그림·학습 그림 색표 해시가 바뀜 — 그림 규칙 버전을 올려야 함).
  7. 전문가 엑셀 양식 v2(`scripts/label-template/README.md` '양식 v2 후보' 7줄): AdBA 도움말 글 등. 칸 지문이 바뀌어 나눠 준 v1 양식과 함께 바꿔야 한다.
  8. JSON 가져오기가 이 저장소에서 제출(잠금)한 블라인드 세트를 바꿀 때: 지금은 **막지 않고 경고만** 한다(잠금은 이 저장소 label_meta 에만 있고 JSON 에 담기지 않음 — 위 '라벨 JSON 백업이 담지 않는 것'). 막으려면 가져오기에서 제출한 세트 갱신을 거절하거나 JSON 형식에 잠금을 담아야 한다(형식·시험이 바뀜). 최종 검증 실데이터 흐름에서 다른 PC JSON 이 제출한 kim F1 기록을 고칠 때 경고 한 줄이 뜨는 것을 확인.
  9. 라벨 '약한 양성' 새 기본값(평가 기준 이상 ~ 기록 기준 미만 지시를 따로 내보내고 기본 학습·평가에서는 무시) — `../계획_라벨링/계획.md` 진행 표 '새 기본값', `../계획_라벨링/규격_초안.md` 3.1.
  - 결정이 아닌 남은 일(빌드 뒤): 맥 앱 빌드(`npm run dist:mac`)와 포장본 스모크, 윈도우 설치본을 다시 만들어 `../윈도우_점검/윈도우_정밀점검.bat`(viewer-steps 47단계·화면이 바뀜), `NdeViewer.tsx`(2000줄) 라벨 모드 연결을 훅으로 나누기, 검토 구간 음성 범위를 구간 목록으로(학습 규칙 버전을 올릴 때 — 지금은 'reviewed-gates-disjoint' 경고), OPD 8단계 캡처 대조.

## 성능 (2026-10-07 빌드 전 측정·최적화, 맥 M5 Pro 18코어 · Node 24.16)

측정 스크립트는 앱 밖 `$TMPDIR/paut-perf`(`build.sh` → `run.sh open render derive exportTrain labelsIo …`, Electron 시작은 `smoke.sh`). 최적화는 모두 같은 입력에서 출력이 바이트 단위로 같다(아래 '같음').

| 항목 | 전 | 뒤 | 같음의 근거 |
|---|---|---|---|
| 학습 내보내기 X3 4개 · 그림 켬 | 29.6 s | 12.3~12.6 s (2.4배) | 옛·새 코드로 같은 저장소 입력을 내보내 36,318개 파일 비교: 그림·가림·검게 칠한 판·COCO·YOLO·scenes·ascan·meta·npy 모두 같음(다른 것은 가져올 때 시각·복제본 ID 가 든 labels.json 기록용 칸과 그 해시뿐). `tests/core/labels/exportEncode.test.ts` |
| 학습 내보내기 파일 하나 · 그림 켬 | 7.0~7.9 s | 3.0~3.1 s | 같음 |
| 학습 내보내기 X3 4개 · 그림 켬 · 학습 분할(검게 칠한 판 더함) | 42.6 s | 16.7 s (2.5배) | 같음 (이 줄은 시험을 함께 돌린 중이라 두 쪽 다 느림) |
| derive(runDerive) 기록 10 · 50 · 200건 | 83 · 411 · 1615 ms | 43 · 208 · 816 ms (약 2배) | X3 4개 결과 JSON 해시 같음, `tests/labels/maskedEnvelope.test.ts`(무작위 300조합 값·빔·샘플 비트까지) |
| 엑셀 확정 2천 줄 · 1만 줄 | 121 · 599 ms | 63 · 296 ms | 확정 계획(새로·고침·그대로) 같음, 라벨 시험 |
| 엑셀 미리보기 1만 줄 | 1.08~1.12 s | 0.98~1.04 s | 같음 |
| JSON 가져오기 기록 2만 건(48 MB) | 1.24 s | 0.68 s | 라벨 시험 |

바꾼 것: PNG deflate 를 libuv 스레드풀에서 4장면까지 겹침(`export/encode.ts` `encodePngAsync` — 필터는 동기, 같은 수준), 양성·무시 상자를 칸별 화소 상자 표로(`export/images.ts` `cellPixelBoxes`), maskedEnvelope 를 raw 진폭으로 견주고 마지막에 한 번 %(`derive/amplitude.ts` `maskedMax` — 조각이 여럿이거나 범위가 [0, nt) 밖이면 옛 길), SQLite 준비한 문 캐시(`catalog/db.ts`), 키 정렬·검사 복사에서 '__proto__' 만 defineProperty(`catalog/values.ts`·`shared/labels/validate.ts`). 그대로 둔 것: h5wasm 메모리(조각 상한 32 MB 로 묶임, 첫 조각 30~50 ms). 이미지 보기 그림 계산(`shared/imaging` renderBscan·renderCscan·buildSscanMap — 측정 때 레티나 B-scan 다시 그리기 27~51 ms, C-scan 20 ms, S-scan 조회표 80~110 ms)의 최적화는 같은 날 따로 했다(바이트 대조 `tests/imagingFast.test.ts`, 이 표 밖).

**최종 재측정** (2026-10-07 06:45~07:00, 최종 코드. 같은 측정 스크립트를 바꾸기 전 묶음과 최종 묶음으로 번갈아 돌림 — 스크립트는 앱 밖 `$TMPDIR/final/perf` 의 `runall.sh`·`table.mjs`, 맥 M5 Pro · Node 24.16. 그림 줄은 두 번 잰 범위)

| 항목 | 전 | 뒤 | 같음의 근거 |
|---|---|---|---|
| 학습 내보내기 X3 4개 · 그림 켬 | 32.0 s | 13.6 s (2.4배) | 학습 분할 켠 12가지 내보내기 36,318개 파일을 최적화 전 코드 결과와 비교: 36,270개 바이트 같음, 나머지 48개(labels.json·manifest·checksums)는 기록 시각·복제본 칸·datasetId·분할 바꾼 시각만 다름. Electron 내장 Node(zlib 1.3.2.1-motley)로도 전·후 3,020개 같음 |
| 학습 내보내기 파일 하나 · 그림 켬 | 7.6~8.4 s | 3.3~3.4 s | 같음 |
| derive 기록 10 · 50 · 200건 | 88 · 427 · 1706 ms | 47 · 224 · 880 ms (1.9배) | 시험 |
| 엑셀 확정 2천 줄 · 1만 줄 | 125~127 · 585~626 ms | 74~77 · 291~363 ms (1.7~2배) | 확정 계획 같음 |
| JSON 가져오기 기록 4천 · 2만 건 | 0.28 · 1.23~1.26 s | 0.15 · 0.67~0.76 s | 라벨 시험 |
| B-scan 2400×600 · 1200×300 | 26.7~45.8 · 7.1~11.8 ms | 9.4~10.2 · 2.9~3.2 ms (2.8~4.5배) | 그림 해시 204/204 같음, Electron 캔버스 PNG 8장 같음 |
| C-scan 2400×400 · 1200×200 | 20.1~20.7 · 5.5~5.7 ms | 10.3~10.9 · 2.9~3.1 ms (약 2배) | 같음 |
| S-scan 조회표 1460×1095 · 600×450 | 86~104 · 16~19 ms | 68~86 · 12~16 ms (1.2배) | 같음 |
| S-scan 한 장 1460×1095 | 12.4~13.1 ms | 10.5~11.0 ms | 같음 |
| Electron 스크럽(→ 40번) syncMedian · frameP95 | 7.0 · 14.8 ms | 5.3 · 12.2~13.1 ms | 47단계 측정값 줄 같음 |

바뀌지 않은 것(최적화 대상 아님, 차 ±5 % 안): NDE·OPD 열기(데운 상태 5.1~5.6 ms), 조각 읽기, PCN 108 가져오기 분석 205~209 ms · 확정 1.44~1.46 s, 저장소 열기, 앱 빈 시작 벽시계 1.35~1.39 s(전 1.37~1.67 s). 메모리: 학습 내보내기 최고 RSS 353 → 378 MB, 라벨 1만 줄 시험 최고 RSS 1.16~1.52 → 1.39~1.42 GB(같은 범위) — 다만 1만 줄 엑셀 미리보기를 들고 있는 동안 남는 힙이 25~51 → 37~87 MB 로 늘었다(원인은 따로 보지 않음. 미리보기는 확정하면 지우고 시간이 지나면 버리며, 실제 엑셀 크기(수십~수백 줄)에서는 무시할 만함).
