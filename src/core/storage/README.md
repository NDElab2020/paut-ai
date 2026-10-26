# core/storage — 저장소 파일 작업

원본은 읽기 전용으로만 연다(수정·이동·삭제 없음).

- `layout.ts`: `resolveStoreLayout`, `ensureStoreRoot`(폴더 생성 + 쓰기 확인, 실패 = `STORE_ROOT_INVALID`), `plannedRelPath` → `스캔플랜/<플랜ID>/<시편ID>/<파일명>`(POSIX, NFC), `toAbsolutePath`/`toRelPath`(저장소 밖 이탈 = `INVALID_ARGUMENT`).
- `names.ts`: Windows 금지 문자 `<>:"/\|?*`·제어문자 → `_`, 끝 공백·마침표 제거, 예약어(CON, PRN, AUX, NUL, COM0-9, LPT0-9, 점 앞부분 포함 `CON.nde`)에 `_`, 앞의 `.`(숨김) 방지, 확장자 보존한 길이 제한(150자), 충돌 시 ` (2)`.
- `scan.ts`: 입력 파일·폴더 재귀 탐색. 숨김(`.`으로 시작, `~$`, Thumbs.db, desktop.ini, $RECYCLE.BIN, System Volume Information, __MACOSX) 건너뜀, 심볼릭 링크 미추적, (dev, ino) 기준 중복 제거, 정렬, 파일명 NFC. 읽을 수 없는 하위 경로는 `unreadablePaths` 로 보고.
- `hash.ts`: 스트리밍 SHA-256(1 MB 청크, 8 MB 마다 진행률).
- `copy.ts`: `copyVerified` — `<대상>.partial` 로 읽으며 해시 → fsync → 수정 시각을 원본과 같게 → 사본 재해시 → 둘 다 기대값이면 rename. 불일치 = `HASH_MISMATCH`, 취소 = `CANCELLED`, 실패 시 partial 삭제. 기존 파일은 덮어쓰지 않으며, 같은 이름에 같은 내용 파일(이전 중단 잔여물)이 있으면 복사 없이 그것을 쓴다(`reusedExisting: true`).

## 저장소 점검·복구 (`recovery.ts`, `guard.ts`)

- 저장소를 열 때: `스캔플랜/**` 의 `*.partial` 삭제, 카탈로그에 없는 측정 사본(`*.nde`·`*.opd` = `SUPPORTED_EXTENSIONS`)은 `미등록_파일/<시각>/` 으로 옮김, 비게 된 폴더 정리. 끝나지 않은 배치는 카탈로그가 '중단됨'으로 닫는다.
- 새 저장소 폴더 안(숨김 제외)에 `.nde/.opd/.oud/.wkb` 가 있으면(기존 저장소 = catalog.db 있음 제외) 저장소로 쓸 수 없다.
- 입력 탐색은 저장소 폴더를 건너뛴다(`excludeDirs`). (dev, ino) 는 bigint 로 비교한다(윈도우 NTFS 64비트 FileId).
- 확정은 하드링크(대상이 있으면 EEXIST)로 덮어쓰기를 막고, 링크를 못 쓰는 파일시스템은 직전 확인 + rename. POSIX 는 rename 뒤 폴더 fsync, 윈도우는 EPERM/EBUSY 재시도.
