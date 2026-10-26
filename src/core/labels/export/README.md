# core/labels/export — 학습 데이터 일괄 내보내기 · 분할 (2b)

전문가 mm 기록(라벨 세트 하나)과 저장된 .nde 사본에서 AI 학습 파일을 만듭니다. 계산은 `shared/labels/derive`(규칙 버전 2)를 그대로 씁니다.
근거: `계획_라벨링/규격_초안.md` 3.5절, `계획_라벨링/계획.md` 6절 기본값(원 진폭 + mm 메타, 고정 그림, 펼친 S-scan 레그별 상자, 시편 단위 분할).

## 폴더

라벨 관리 → '학습 데이터 내보내기' → main 의 폴더 대화상자로 고른 폴더 **안에** 새 폴더 `학습데이터_<YYYYMMDD-HHmm>_<PC ID>`(있으면 `_2` …)를 만듭니다. 덮어쓰지 않습니다.

```
학습데이터_20261006-1530_pc-1a2b/
  manifest.json          형식(버전 2)·버전(스키마·좌표·변환 규칙·그림 규칙·내보내기·팔레트 이름과 SHA-256)·지침서 버전·앱 버전·내보낸 시각·옵션·규칙 매개변수 전부
                         데이터셋 ID(datasetId = checksums.sha256 글자의 SHA-256 — 평가 보고서의 '데이터셋 버전')
                         분할: 시편 → 분할 전체 표(assignments)와 그 SHA-256·마지막으로 바꾼 시각·분할별 판독 단계 수(stages)
                         파일 목록(sha256·시편·용접부·분할·고른 세트·승인 안 한 형상 에코 후보 mm)·건너뛴 파일과 이유·막힌 그룹과 이유·세트 고르기 결과·경고
  checksums.sha256       manifest 를 뺀 모든 파일의 SHA-256 (sha256sum 형식, 경로 순)
  data.yaml              YOLO 설정 (그림을 낼 때). yolo_<분할>.txt = 그 분할의 그림 목록 (검토한 장면만)
                         Ultralytics 에는 data.yaml 을 절대 경로로 넘깁니다 (상대 경로면 기본 datasets 폴더 기준으로 찾음). 목록 안 경로는 이 폴더 기준
  coco_<분할>.json       그 분할의 모든 그림·상자·무시 영역 (경로는 이 폴더 기준)
  files/<sha256 앞 16자>/
    meta.json            축·빔·게이트·이득·Ref·진폭 기준(%FSH)·두께와 출처·파일 정렬·개선 형상·단위 설명·그림 범위
    labels.json          쓴 기록 원본: 라벨 세트·라벨러·지시 기록·검토 구간·관측 행·파일 정렬·물리 결함
    scenes.json          derive 결과 (장면 세 상태·학습 상태·객체·장면 상자·C-scan 상자·관측 표·탐색 창·길이 제안·이슈)
    ascan.json           A-scan 구간 + A-scan 하나하나의 상태 글자(P W I N U) — states = 원래 상태, trainStates = 학습 상태
                         (약한 양성 → weakAs, 계산만 한 관측 → unconfirmedObservation 반영, 그림·COCO 와 같은 기준) + 음성 구간 + 가릴 구간
    amplitude_g<id>.npy  int16 [스캔, 빔, 샘플], 파일 이득 그대로(소프트 이득 0 dB). %FSH = raw / rawMax × unitMax (meta.json)
    status_g<id>.npy     uint8 [스캔, 빔], 파일 상태 비트 그대로 — **status & 1 = 데이터 있음** (나머지 비트는 파일 원값, 1 과 같다고 비교하지 않음)
    images/g<id>/s<스캔>.png   펼친 S-scan 그림 (가리지 않은 원본)
    masks/g<id>/s<스캔>.png    가림 그림 (회색조 8비트): 0 = 그대로, 1 = 검토 게이트 밖, 2 = 라벨 가림. 가린 화소가 있는 장면만
    labels/g<id>/s<스캔>.txt   YOLO 상자 (그림과 같은 이름, 음성 장면은 빈 파일)
    masked/images·masked/labels  maskMode 'blackout' 이고 train 분할일 때만: 가림 값 ≠ 0 화소를 검게 칠한 판과 같은 YOLO 글자
    coco.json            이 파일 그림의 COCO (경로는 이 파일 폴더 기준). 무시 객체 창 = iscrowd 1 (attributes.ignore = true)
```

## 규칙

- **같은 입력 → 같은 바이트.** 파일은 (이름, sha256) 순, 그룹·장면은 번호 순. JSON 은 키 정렬(`stableJson`), PNG 는 행마다 Sub 필터·deflate 6. 시각은 `manifest.exportedAt` 한 칸뿐이고, 옵션 `fixedExportedAt` 으로 고정할 수 있습니다. 출력 폴더 이름(시각)은 내용에 들어가지 않습니다.
- **막기.** derive 가 막는 그룹(OmniPC 대조 전, U 격자 오프셋 ≠ 0, 그릴 수 없음, 두께·Ref 를 모름 등)은 내보내지 않고 `manifest.blockedGroups` 에 이유를 적습니다. 막힐 그룹은 진폭도 읽지 않습니다. 모든 그룹이 막히면 그 파일은 `skipped`. 막을지는 내보낼 때마다 파일 메타로 다시 판정합니다(규격 2절).
- **OPD (구조를 따라 읽은 형식).** 이미지 보기 정보(`core/opd/viewer.ts`)가 그룹마다 막는 이유 항목 `blockReasons`(OmniPC 대조 전 · 진폭 눈금 추정 · 시편 형상 모름 · 두께 칸 의심 · 게이트 A · 센 신호 칸 일치율 · 손상 의심 프레임 · 스넬)와 그것을 이은 `blockReason` 을 붙인다. 진폭 눈금이 추정(`ampScale.estimated`)인 동안은 이 항목 때문에 `VERIFIED` 를 올려도 %FSH 가 나가지 않는다 — 눈금이 확정되면 `OPD_AMPLITUDE_SCALE` 과 `estimated` 만 바꾸면 풀린다. 파일 정렬에 실측 두께가 있으면 '두께 칸 의심' 항목만 뺀다(`withAlignmentThickness`, 그 두께를 씀). 내보내기는 이 이유도 막을 이유로 보고 진폭을 읽지 않으며, derive 에 `blockReason` 으로 넘기고 `skipped`·`blockedGroups` 이유에 derive 이유 뒤로 붙여 적는다(derive 이유가 이미 '대조 전'이면 대조 전 항목은 빼고). 사본은 경로 확장자로 형식을 골라 읽는다(`readStoredViewerInfo`·`readStoredViewerChunk`). 대조를 마쳐 내보내게 되면 `meta.json` 의 `nde` 칸에 `reader`(읽기 규칙 이름·버전)·`scanSync: 'unknown'`·`ampScale`(추정 눈금 `estimated: true`), 그룹에 `selfCheck`·`formatBlockReason`·`formatBlockReasons`, `manifest.files[].format` 이 더해진다. NDE 파일은 이 칸들이 없어 바이트가 그대로다.
- **세트 고르기** (`selectSets.ts`, 화면에서 바꿈): 확정 > 설계값 대조 > 지정 라벨러의 블라인드. 같은 단계에 세트가 둘 이상이면 고르지 않고 이유를 남기며, 파일 줄에서 직접 고릅니다(`overrides`). 2인 독립 모드면 지금 라벨러의 세트만 후보입니다.
  - **시험(test) 분할은 확정 세트만** (`testFinalOnly`, 기본 켬 — 평가 정의 1·2절). 확정 세트가 없으면 고르지 않고 이유를 남깁니다. 끄면 다른 분할과 같은 순서로 고르고 결과에 경고를 남깁니다.
  - 검수 출처(`adjudication`)가 없는 확정 세트(엑셀·다른 경로로 들어온 것)는 저절로 고르지 않습니다(직접 고르면 씀).
  - 서비스는 사본을 읽기 전에 SHA-256 을 다시 확인합니다(`verifyCopies`). 다르면 그 파일을 건너뛰고 이유를 적습니다.
- **옵션.** 원 진폭(.npy), 그림(PNG·COCO·YOLO, mm/px 기본 0.1), 무시 구역(train 만 검게 가림(기본) / 가림 그림만 따로 / 장면 빼기), 약한 양성(기본 무시 — 사용자 확인 대기), 계산만 한 관측의 양성(기본 그대로), 시험 분할은 확정만(기본 켬).
- **경고** (`manifest.warnings`·결과): 검토 완료 구간 안에서 승인하지 않은 형상 에코 후보(그 자리 분류 1 이 상자 없이 배경이 됨 — 파일마다 `unapprovedEchoMm`), derive 의 경고급 확인 사항(코드별 수, 자세한 것은 scenes.json `issues`), test 분할의 확정 아닌 세트, 풀지 않은 충돌.
- **그림** (`images.ts`, 그림 규칙 버전 `TRAIN_IMAGE_RULES_VERSION` = 2). 가로 = V(파일 V 그대로, 왼쪽이 작은 값), 세로 = 펼친 깊이(위 0). 범위는 mm/px 배수, 깊이는 다루는 레그(최대 4) × 두께까지. 색은 앱 내장 색표(OmniScan X3 MainColors, 파일 색표 아님), 소프트 이득 0 dB. 부채꼴 밖·데이터 없음 = 회색 808080.
  - 품질 불량·데이터 없음·기준 미만 지시 구간 장면은 내지 않습니다. 검토하지 않은 장면은 결함 양성 상자가 있을 때만 내고(COCO `reviewed: false`), **YOLO 목록에는 넣지 않습니다**(상자 밖이 음성이라는 보장이 없고, 게이트 띠가 없는 그림이 '결함 있음' 단서가 되지 않게).
  - 그림은 늘 **가리지 않은 원본**입니다. 가림은 `masks/` 와 COCO 무시 영역으로 따로 냅니다 — 검은 덩어리가 '근처에 라벨된 지시가 있다'는 단서가 되거나, val·test 평가 입력에 라벨 정보가 새지 않게. YOLO 는 무시 구역이 없어 `blackout`(기본)이면 **train 분할에만** 검게 칠한 판을 더 냅니다.
  - 라벨 가림(값 2) = 학습 상태가 무시인 객체의 탐색 창 + **결함 양성 객체의 탐색 창에서 덩어리 밖** (A-scan `ascanLabelAt` 과 같은 규칙 — 띠 위 결함 에코의 꼬리가 상자도 가림도 없이 배경으로 남지 않게). 검토 게이트 밖(값 1) = 검토한 장면의 게이트(펼친 깊이·레그) 밖 — 음성은 게이트 안에서만 성립. 양성 상자의 칸 덩어리는 가리지 않습니다.
  - 장면 빼기(`exclude`)는 평가 기준 이상 신호가 있는 무시 객체만 셉니다('안 보임' 레그 창은 세지 않음 — 같은 기록의 빈 무시 객체로 양성 장면 대부분이 빠지지 않게).
  - 상자 = 학습 상태가 양성인 객체의 장면 상자(절대 문턱 칸 덩어리). 분류 0 = 결함, 1 = 형상 에코(결함 아님). **화소 상자 = 가장 가까운 칸이 그 덩어리에 드는 화소를 모두 감싸는 사각형**(그림은 칸 사이를 보간해 칠하므로 칸 중심보다 넓다) ∪ 칸 중심 끝점 상자, 최소 3 화소(학습 증강에서 버려지지 않게). mm 값과 기록 UUID·레그·종류는 COCO `attributes` 에 있습니다.
- **쓰기.** `<폴더>.partial` 에 쓰고 끝나면 이름을 바꿉니다. 취소·실패면 방금 만든 `.partial` 폴더만 지웁니다. 원본·사본 .nde 는 읽기만 합니다.

## 분할 (`split.ts`)

- 시편 단위 train · val · test. 같은 시편의 모든 파일·재스캔·양쪽 스큐가 자동으로 같은 쪽에 갑니다. 시편 ID 는 ASCII 대소문자를 가리지 않습니다.
- 시험 세트를 잠그면 test 로 넣거나 test 에서 빼는 변경과 잠금 풀기는 확인(`confirmLocked`)과 이유가 있어야 하고 바꾼 기록(`log`, 최근 1000줄)에 남습니다. train ↔ val 은 잠금과 무관합니다.
- 저장은 이 저장소 `catalog.db` 의 `label_meta` 한 칸(`train-split`, JSON)입니다. 마이그레이션을 늘리지 않습니다. catalog 가 label_meta 읽기·쓰기 함수를 내보내지 않아 같은 DB 파일에 짧은 두 번째 연결을 엽니다(동기 호출이라 섞이지 않음). JSON 백업으로 다른 PC 에 가지 않습니다.

## 서비스 · IPC (`core/service/labels.ts`, 'labels:*' 8개)

| 채널 | 하는 일 |
|---|---|
| `trainingSplits` · `setTrainingSplits` · `lockTrainingTest` | 시편 표·분할 바꾸기·시험 세트 잠금 (잠긴 test 변경은 `CONFLICT` → 이유를 적고 다시) |
| `trainingCandidates(rule)` | 파일마다 고른 세트와 이유 (대화상자 미리보기) |
| `chooseTrainingDir` | main 폴더 대화상자. 이렇게 고른 폴더만 `exportTraining` 이 받습니다 |
| `exportTraining(request, dir)` | 한 번에 하나(`BUSY`). 라벨 작업이라 끝날 때까지 저장소를 바꿀 수 없습니다 |
| `trainingStatus` · `cancelTraining(operationId)` | 진행률(렌더러가 0.3초마다 되묻음)·취소(`CANCELLED`) |

진행률을 기존 `event:progress` 로 보내지 않는 까닭: `ProgressEvent.operation` 이 'analyze' | 'commit' 뿐이고 상태줄이 그 둘만 그립니다. 늘리려면 `shared/types.ts` 와 상태줄을 함께 고쳐야 해서, 지금은 되묻기로 둡니다.

## 시험

`tests/core/labels/exportTraining.test.ts`(X3 실데이터: manifest·meta·scenes·ascan 모양, .npy 머리·크기·원자료, PNG 크기·상자 위치·상자 화소 안 가림, 두 번 → 같은 바이트, 시각만 다름, 막힌 그룹, 건너뜀, 취소), `exportRules.test.ts`(세트 고르기·분할 잠금·label_meta·npy·PNG·JSON·상자 화소), `exportService.test.ts`(서비스 E2E: 세트 고르기·2인 모드·분할·잠금·다시 열기·분할로 고른 내보내기·진행률·취소·BUSY), `exportMock.test.ts`(브라우저 mock 계약).

## 크기·시간 (맥 실측)

X3 4개 파일을 그림까지 내면 21.5 s, 약 193 MB(파일당 약 48 MB — 원 진폭 .npy 가 대부분)입니다. 그림 한 장이 약 9.6 ms 로 시간의 대부분입니다.
파일 하나를 처리하는 동안 모든 그룹의 진폭 조각을 메모리에 듭니다 — derive 가 그룹 사이(반대 그룹 관측)를 함께 보기 때문입니다.
원 진폭 287 MB 인 가짜 파일(X3 를 10배로 이어 붙임)은 58.6 s, RSS 최대 726 MB 였습니다. 큰 4.x 파일은 윈도우 8 GB PC 에서 실측이 필요하고, 필요하면 derive 를 worker 로 옮깁니다(남은 일).

## 남은 일

- C-scan·B-scan 그림, 접은 단면 상자(선택), A-scan npz 묶음(지금은 ascan.json + amplitude .npy 로 대신).
- 증강(스큐 90 ↔ 270 좌우 대칭)은 앱 밖 학습 코드에서 합니다(규격 3.5).
- 분할 단위를 용접부로 고르는 선택(지금은 시편만 — 같은 시편이 train·test 로 갈리지 않게).
- 큰 파일: derive 를 worker_threads 로 옮기고 그룹마다 조각을 놓기 (지금은 파일 하나의 모든 그룹 진폭을 듦), 대화상자에 예상 메모리 알림.
- 다른 PC·Electron 의 zlib 빌드가 달라 PNG 바이트가 다를 수 있음 — 윈도우 점검에서 같은 고정 시각 내보내기의 checksums 를 맥과 견줄 것(다르면 결정성을 '디코드한 화소 해시'로 정의).
- 무시 구역 옵션별로 남는 양성 장면·상자 수를 대화상자에서 미리 보이기.
