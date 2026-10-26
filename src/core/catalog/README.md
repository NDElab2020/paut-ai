# core/catalog — 카탈로그 DB

`<storeRoot>/catalog.db` 를 `node:sqlite` `DatabaseSync` 로 관리한다(Electron 44 내장 Node 24.21 / SQLite 3.53 확인). `openCatalog(path, { now? })` 가 `Catalog` 를 돌려준다. 모든 오류는 `AppError`(제약 위반 = `CONFLICT`, 없음 = `NOT_FOUND`, 입력 = `INVALID_ARGUMENT`, 그 외 = `DB_ERROR`).

- 파일: `db.ts`(래퍼·중첩 트랜잭션·오류 변환), `schema.ts`(마이그레이션), `plans.ts`, `specimens.ts`, `files.ts`, `imports.ts`, `values.ts`(입력 정리), `time.ts`.
- 테이블: `schema_version`, `id_counters`(플랜 ID 카운터, 삭제돼도 재사용 안 함), `plans`(fingerprint UNIQUE, spec_json 은 키 정렬 JSON), `specimens`(id COLLATE NOCASE — 대소문자만 다른 ID 는 같은 시편), `files`(sha256 UNIQUE, stored_rel_path UNIQUE), `file_setups`(원본 셋업 JSON 전체), `import_batches`, `import_items`.
- 스키마 진화: `schema.ts` 의 `MIGRATIONS` 끝에 `{ version: n+1, description, up }` 를 추가한다. 배포된 단계는 고치지 않는다. 단계마다 트랜잭션 하나, 실패하면 롤백. 앱보다 새 스키마의 DB 는 열지 않는다.
  - 번호는 1 부터 1 씩 늘어야 한다(`assertMigrationOrder`). 같은 번호를 두 번 붙이면 조용히 건너뛰지 않고 열기를 거부한다.
  - 있던 DB 를 올리기 전에 같은 폴더에 `catalog.v<지금 버전>-<YYYYMMDD-HHmmss>.bak` 을 만든다(`VACUUM INTO`, 일관된 사본). 만들지 못하면 올리지 않는다. 옛 앱은 더 새 스키마를 열지 않으므로 이 사본으로 돌아갈 수 있다.
  - v1 = 초기 스키마, v2 = 결함 라벨 저장소(`labels.ts`, `core/labels/README.md`). 이미지 보기 후처리의 보기 설정 테이블은 v3 로 붙인다.
- v2 라벨 테이블: `label_labelers`, `label_records`, `label_observations`, `label_review_intervals`, `label_file_alignments`, `label_physical_defects`(specimen_id COLLATE NOCASE), `label_work_events`(추가 전용 트리거), `label_conflicts`(풀지 않은 같은 사본은 부분 UNIQUE, 출처 이름 source_name), `label_meta`(복제본 ID·쓰기 횟수), `label_import_marks`(엑셀 재가져오기 기준). files 로 가는 FK 는 없다(sha256 글자로만 이음).
- 검색(`listFiles.text`): 공백으로 나눈 낱말이 모두(AND) 원본 파일명·저장 파일명·장비 원본 파일명·시편 ID·시편 이름·상태 태그·메모·태그·플랜 ID·플랜 이름 중 하나에 부분일치(ASCII 대소문자 무시, NFC 정규화).
- 플랜 이름은 DB 에만 있으며 이름을 바꿔도 파일은 이동하지 않는다.
- 진행 중(또는 비정상 종료된) 가져오기 배치는 `finishedAt: null`, `status: 'partial'` 로 보인다.
