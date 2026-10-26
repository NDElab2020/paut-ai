# core/import — 가져오기 파이프라인

- `analyze.ts` `analyzeImport(paths, ctx)`: `storage.scanInputPaths` 로 펼침(숨김·심볼릭 링크 건너뜀) → 지원 확장자(`SUPPORTED_EXTENSIONS` = `.nde`·`.opd`)와 보류 확장자(`UNSUPPORTED_EXTENSIONS` = `.oud`·`.wkb`)만 항목으로, 나머지는 `ignoredCount`. 지원 파일은 스트리밍 SHA-256 → 카탈로그·같은 배치 중복이면 `duplicate`(읽지 않음) → 형식별 읽기(`.nde` = `openNde`+`normalizeSetup`, `.opd` = `readOpd` 아래) → 지문이 기존 플랜이면 `match-existing`, 아니면 `new-plan`(같은 지문 = 같은 `newPlanKey`). 파일별 오류는 `error` 로 격리, 취소만 `CANCELLED` 로 전체 중단. 진행률 phase scan→hash→read→match→done(항상 done 으로 끝남).
- **OPD**(`readOpd`): `core/opd` 구조 읽기 → `opd/normalize.ts` `normalizeOpd`(스펙·지문·수집 요약·요약 줄 끝 ' · OPD') + `opd/meta.ts` `opdFileMeta`(형식 `ndeVersion.family = 'opd'`, raw 'OPD · MXU - 4.4R5', 읽기 규칙 `reader`, 장비 저장 이름·저장 시각·모듈·시리얼·MXU). 모르는 칸(형상·재질·개선 모양·소자 수·파 모드·스캔면·스캔 오프셋·집속 방식)은 null, `techniqueParams` 에 `dataFormat: 'opd'`·`opdSpecRule`·용접 채움 높이·랜드 날 값(NDE 플랜과 섞이지 않게, 개선을 몰라 다른 용접이 묶이지 않게). 구조 점검 실패는 '보류(해석 실패): …'(`NDE_READ_ERROR`) → `error`. 미리보기 항목 경고: 장비 저장 이름 ≠ 파일 이름, 두께 칸 ≠ 채움 + 랜드(PL2386x), 2축은 '보관만'(지문에는 넣지 않음 — .nde 와 같이 기록용 `scanQuantity`·`indexQuantity`), 위치 수 ≠ 스캔 길이 ÷ 간격, 폴더 이름의 시편 번호 ≠ 제안 시편 ID(`suggest.ts` `folderSpecimenNote`, OPD 만). 늘 붙는 '공개되지 않은 형식' 경고는 미리보기 표의 'OPD · 자체 해석 · 대조 전' 표시와 그 아래 '정확도 대조 전 — 자동 변환·학습 내보내기 막힘' 줄로 대신한다(툴팁이 아니라 글자로).
- `planning.ts`: 새 플랜 후보(예정 ID = `peekNextPlanIds`, 이름 규칙 `{name}`/`{summary}`/`{id}`, `specDistance` 로 가장 가까운 기존 플랜과 `diffSpecs`). OPD 플랜의 짧은 이름에는 집속 깊이·채움 높이와 끝의 ' · OPD'('25T · 5MHz · SK90 · 집속 24 · 채움 23 · OPD' — 그 값만 다른 ROOT/TOP·TP/PL TOP 플랜이 같은 이름이 되지 않게). 요약 줄도 '… · 집속 24 mm · 채움 23+2 mm(· 두께 확인 필요) · OPD'.
- `suggest.ts`: 시편 ID·상태 태그·회차 제안(`nde.suggestSpecimen` 위임). PL·TP·TF 번호가 없으면 파일명(확장자 제외)을 폴더에 쓸 수 있게 정리해 임시 제안.
- `commit.ts` `commitImport(preview, req, ctx)`: 요청 검증(시편 ID 빈 값이면 아무것도 하지 않고 `INVALID_ARGUMENT`) → 배치 시작 → 항목마다: 카탈로그 중복 재확인 → 플랜 ID 결정(새 플랜은 다음 ID 로 복사한 뒤 첫 파일 기록과 같은 트랜잭션에서 생성) → `copyVerified`(원본 해시가 분석 때와 다르면 `HASH_MISMATCH` 로 그 항목만 실패) → 사본에서 셋업 원문을 다시 읽어 `insertFile`(+ `ensureSpecimen`, 같은 트랜잭션). 셋업 원문은 형식별: `.nde` = 셋업 JSON 그대로, `.opd` = 사본을 다시 구조 읽기 한 JSON(`{ format: 'opd-structure', reader, header, setup, beams, raster, … }`). DB 기록이 실패하면 방금 만든 사본을 지우고, 실패 항목 때문에 생긴 빈 시편·플랜 폴더도 지운다. 취소되면 남은 항목은 '취소해 건너뜀', 배치 상태 `cancelled`. 결과 항목에는 중복·보류·분석 오류 항목도 들어간다(분석 오류 = `failed`).
- `previewStore.ts`: main 메모리에 미리보기 보관(TTL 6시간, 최대 8개). 확정하면 지운다.
- 잠금·취소·저장소 전환은 `core/service` 가 맡는다(작업은 한 번에 하나, 두 번째는 `BUSY`).

## 검토 반영 (판정·결과)

- `missing-copy`: 카탈로그에 같은 SHA-256 이 있지만 저장소 사본이 없거나 크기가 다르면 복원 대상. 확정 때 같은 자리로 다시 복사(`restored`)하고 이름이 바뀌면 레코드 경로를 고친다.
- 같은 배치 중복은 기준 항목의 실제 결과로 정한다(기준이 제외 → 제외, 실패 → 실패, 저장 → 그 경로).
- 확정 때 검증된 사본에서 셋업을 다시 읽어 분석 때 지문과 같은지 확인한다(다르거나 못 읽으면 그 항목 실패, 사본 삭제).
- 복사된 항목의 이력은 파일 기록과 같은 트랜잭션에 쓰고, 배치 마무리 기록이 실패해도 결과는 그대로 돌려준다. `ImportResult.status` 로 취소 여부를 알린다.
- 저장 경로가 240자를 넘으면 미리보기 항목 `warnings` 에 경고.

## 저장소 점검 (`core/service/maintenance.ts`)

- `.nde` 플랜: `specVersion < SPEC_VERSION` 이면 보관된 셋업 원문(file_setups)으로 다시 정규화.
- OPD 플랜(`isOpdSpec`): `specVersion < SPEC_VERSION` 이거나 `techniqueParams.opdSpecRule ≠ OPD_SPEC_RULE` 이면 **저장소 사본을 다시 읽어** 계산한다(읽기 규칙이 바뀌면 새 칸이 생길 수 있어 보관한 구조 JSON 을 믿지 않는다). 가져온 순서로 처음 읽히는 사본이 기준이고, 다른 사본의 지문이 다르거나 읽지 못하면 `upgradeProblems` 에 남긴다(파일은 옮기지 않음).
- 미등록 사본 정리(`storage/recovery.ts`)는 `.nde`·`.opd` 모두.

## 테스트

- `tests/e2e/import.e2e.test.ts`(.nde 실데이터), `tests/e2e/opd.e2e.test.ts`(OPD 실데이터: PCN교육 108개 → 플랜 31개, 다시 분석하면 모두 중복, 규칙 갱신, HASH_MISMATCH, 2축·해석 실패 격리), `tests/e2e/opd.synth.test.ts`(시험용 OPD — 실데이터 없이), `tests/e2e/opd.mock.test.ts`(브라우저 mock).
- `tests/core/opd/normalize.test.ts`(시험용 OPD), `normalize.realdata.test.ts`(162개 플랜 묶음 = 조사 기준표 셋업 값 + 집속 깊이 묶음 35개, 다시 읽어도 같은 지문, NDE 시험 파일 17개와 지문 겹치지 않음).
