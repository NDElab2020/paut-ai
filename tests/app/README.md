# 실제 앱 시나리오 (tests/app)

창 없이 띄운 실제 Electron 앱을 시나리오로 조작해 수치·그림·조작·테마·창 크기를 확인한다. vitest 가 아니라 `--smoke` 의 `--smoke-steps` 로 돈다 (맥 샌드박스 안에서는 Electron 이 뜨지 않으므로 밖에서).

```
# 1) 가져올 파일 8개를 한 폴더에 복사 (원본은 건드리지 않음)
#    12T-SV-01-Cap on.nde, 12T-SV-03-Cap off.nde, Weld_Plate_PA-Sect_sk90-4.2.nde, Weld_COD_2PA-ToFD-4.2.nde,
#    Weld_Plate_4TFM_sk90-4.2.nde, ManualWeldPA.nde, TF_01_C_L_0001.nde, TF_01_L_0001.nde (../testdata/X4_TF/)
#    (+ OPD 단계용 TP14-ROOT-L-01.opd — 없으면 OPD 두 단계는 건너뜀,
#     + 이전·다음 파일 단계용 PCN PL23864_TOP_R_01.opd·PL23864_TOP_R_02.opd — 같은 플랜·같은 시편, 없으면 건너뜀). 복사 대신 --smoke-nde 를 파일마다 여러 번 줘도 된다
# 2) 빌드 후 실행
npm run build
PAUT_USER_DATA_DIR=<임시>/ud ./node_modules/.bin/electron . --smoke --smoke-commit --smoke-viewer \
  --smoke-nde=<복사 폴더> --smoke-store=<임시>/store --smoke-shots=<임시>/shots \
  --smoke-steps=tests/app/viewer-steps.js --smoke-report=<임시>/결과.json
# 3) 저장된 캔버스를 OmniPC 화면과 대조 (vitest)
PAUT_APP_SHOTS=<임시> ./node_modules/.bin/vitest run tests/appShots.test.ts
```

`viewer-steps.js` 단계: X3 열기(첫 커서) → OmniPC 커서(39 mm·54°)에서 A% 1.6·ND → C-scan 클릭 → 단일 그룹에서 S-scan 60° 빔 클릭 → 캔버스 저장 → 다크 → A-B-C-S → 1280×800 → UI 계산 스타일 수집 → 스크럽 성능 → 돌아가기·다시 열기(첫 커서) → 4.2 Sect(첫 커서, 4.x 섹토리얼 스큐 90 은 2026-10-26 부터 대조 전 표시 없음) → COD(ToFD 안내) → 4TFM(볼 수 없음) → 3.3 ManualWeldPA(데이터 없음 경계) → X3 Cap off(첫 커서) → 후처리 15단계(`post-open-x3` ~ `min-window-tools-open`) → X4 컴파운드(`open-tf-compound`) → X4 섹토리얼+리니어(`open-tf-linear`) → S-scan 게이트 점선 끌기(`sscan-gate-drag-linear`) → 라벨 모드 7단계(`label-mode-toggle-same-canvas` · `label-sscan-zoom` · `label-point-click` · `label-panel-flow` · `min-window-label` · `label-tool-focus-arrow` · `label-scrub-perf`) → A-scan 기준선(`level-lines-toggle`, 2026-10-07 OmniPC 조사 X3) → OPD 2단계(`open-opd-tp14` · `opd-tp14-278-65`) → 이전·다음 파일(`file-nav-prev-next`, X9). 모두 47단계. **최종 재검증 2026-10-07**(최적화·화면 고침이 모두 들어간 06:37 빌드로 06:38·06:55, 마지막 글 고침 뒤 07:06 빌드로 07:07 — 세 번, 05:25 와 같은 입력 19개, 샌드박스 밖, 임시 userData·저장소): 세 번 모두 47단계 통과·콘솔 오류 0·전체 약 145 s(단계 합 108.5 s). scrub-perf syncMedian 7.0 → 5.3 ms · frameP95 14.8 → 12.2~13.1 ms, 긴 작업 0. label-scrub-perf p95 13.2~18.2 ms · 가운데 9.6~9.8 ms(전 10.7~14.3 · 9.4~10.2 — 40프레임의 둘째로 느린 값이라 흔들림, 기준 50 ms). 측정값 줄·첫 커서 값이 05:25 와 47단계 모두 같고, 가져오기 지문 19개 같음, 캔버스 PNG 8장(S05·S32 X3 S/C/A-scan, S46 OPD C/S-scan)이 05:25 와 SHA-256 같음. appShots 4건 통과(알파 255 기준 vMin 0.27 · vMax −0.6 · dMin 0.12 · dMax −0.12 mm, 밝기 상관 0.809·0.955). 나머지 10개 파일을 화면으로 여는 추가 시나리오(스크래치)도 10/10 통과·측정값 줄과 IPC 조각 결과가 05:30 기준과 같음. 맥 개발 빌드 2026-10-07 05:25(빌드 전 기준선 — 최적화 뒤 같은 입력으로 다시 돌려 견줌, 샌드박스 밖, 임시 userData·저장소, 입력 19개 = X3 4 · 공식 예제 4.2 Sect·COD·4TFM·Comp 2gr · 3.3 ManualWeldPA · X4_TF 2 · OPD TP14-ROOT-L·R · PL23861-ROOT-L · PL23864_TOP_R_01·02 · SEC20 sr01_01 · 6.4T S36-1 · 부식 2축 C10_01): 47단계 모두 통과, 콘솔 오류 0, 전체 144 s(단계 합 108.5 s). scrub-perf syncMedian 7 ms · frameP95 14.8 ms, label-scrub-perf p95 10.7 ms. 가장 느린 단계 label-panel-flow 8.1 s · label-point-click 6.8 s · label-mode-toggle-same-canvas 6.6 s. 이어서 appShots 4건 통과(부채꼴 외곽 검사는 이 실행 뒤 알파 255 만 세도록 고침 — 알파 255 기준 차 vMin 0.27 · vMax −0.6 · dMin 0.12 · dMax −0.12 mm). `openFile` 은 그 행 바로 아래 펼침 칸의 '이미지로 보기'만 누른다(같은 플랜 파일을 잇달아 열 때 앞 행 단추를 잡던 경쟁 — 2026-10-07 고침). 그 전 05:12(OmniPC 조사 검토 반영 뒤, 샌드박스 밖, 임시 userData·저장소, 위 8개 + X3 02·04 + OPD TP14-ROOT-L·TP14-ROOT-R·PL23861-ROOT-L·PL23864_TOP_R_01·02): 47단계 모두 통과, 콘솔 오류 0, 이어서 appShots 4건 통과. 그 전 03:11(샌드박스 밖, 임시 userData·저장소, 위 8개 + X3 02·04 + OPD TP14-ROOT-L·TP14-ROOT-R·PL23861-ROOT-L): 45단계 모두 통과, 콘솔 오류 0. 그 전 01:02: 43단계 통과, 이어서 appShots 4건 통과.

윈도우 정밀 점검(`../윈도우_점검/윈도우_정밀점검.bat`)은 설치본으로 같은 단계를 돈다. 2026-10-06 13:20 빌드(0.1.0)에는 후처리 패널·확대·컴파운드·리니어가 없어 S20~S36 이 실패하므로 `npm run dist:win` 으로 다시 만든 설치본으로 돌린다.

## 판정 기준 (뷰어와 따로 계산한 기대값과 비교)

- **첫 커서 (계획 결정 8)** — 파일을 열면 현재 그룹의 게이트 A C-scan 이 가장 센 스캔 칸에 커서가 놓여야 한다. 기대값은 단계 안에서 `window.pautApi` 의 `viewer.open`/`viewer.chunk` 로 다시 계산한다 (게이트 창 규칙은 `shared/imaging/gates.ts` 의 `gateSampleWindow` 와 같고, 상태 비트 1 이 0 인 칸은 빼며, 같은 최대가 여럿이면 앞 칸). 그림 준비(`.viewer__loading` 사라짐) 직후의 측정값 줄은 첫 커서 effect 가 돌기 전(0.0 mm)일 수 있으므로 `openFile()` 이 기대값과 같아질 때까지(최대 5 s) 기다린 뒤 돌려주고, open-x3 · back-restore-reopen · open-4x-sect · open-x3-capoff 가 `readout['스캔'] === firstScan.scanMm` 를 ok 에 넣는다. 실데이터 기대값: 12T-SV-01 **202.0 mm**, 12T-SV-03 **62.0 mm**, 4.2 Sect GR-1 **50.0 mm** (COD S90 35.0 mm, ManualWeldPA 257.0 mm 는 기록만).
- **스크럽 성능 (scrub-perf)** — → 40번을 sleep 없이 누르며 키마다 `syncMs`(keydown → React 동기 렌더·캔버스 그리기 끝, 마이크로태스크 뒤)와 `frameMs`(→ 다음 프레임)를 잰다. 기준은 `frameP95Ms ≤ 50`(60 Hz 세 프레임, 계획.md '스캔을 넘길 때 끊김 없음')과 긴 작업(50 ms+) 0회. `syncMedianMs` 가 계획.md 의 '한 장에 3 ms' 에 해당한다. `visibility` 는 숨김 창 스로틀링 확인용 기록(맥은 `visible`, rAF 정상).
- **데이터 없음 경계 (open-manualpa33-nodata)** — 상태 비트로 모든 빔이 hasData=0 인 첫 스캔 칸 `k0`(ManualWeldPA GR-1: 259)를 구하고, 기대 회색은 파일의 `display.specialColors[2]` 로 둔다. C-scan·B-scan 모두 `k0−1` 칸은 색, `k0` 칸부터 회색이어야 하며(한 칸 어긋나면 실패), `edge` 에 `k0±3` 칸의 rgb 를 1 mm 간격으로 기록한다.
- **컴파운드 (open-tf-compound)** — TF_01_C_L_0001 GR-1 이 그릴 수 있는 `pa-compound`·verified 이고 볼 수 없는 그룹·'OmniPC 대조 전' 표시가 없으며 첫 커서가 기대값과 같아야 한다. C-scan 에서 OmniPC 캡처 커서(스캔 0 mm · 빔 0)를 누른 뒤 측정값 줄 `각도 50.0°`, A% 가 따로 계산한 게이트 A 최대(빔 0: 창 [53, 452), raw 427 → 2.61 %)와 ±0.05·화면값 **2.6** 과 ±0.1, DA^·SA^ `ND`(문턱 25 %). C-scan 세로축 '굴절각' 끝이 캡처 눈금 회귀값 아래 49.51°·위 68.48° 와 ±0.1°.
- **리니어 (open-tf-linear)** — TF_01_L_0001 이 파일 화면 상태대로 Single · GR-2(리니어)로 열리고(S-scan 1개, 대조 전 표시 없음) 두 그룹 모두 볼 수 있어야 한다. 스캔 0 · 빔 0 에서 측정값 줄은 `각도` 대신 `빔 1 · 60.0°`, 패널 제목 `빔 1 · 60°`, A% 가 따로 계산한 값(raw 536 → 3.27 %)과 ±0.05·화면값 **3.3** 과 ±0.1, DA^ `ND`. C-scan 세로축 '빔 번호' 끝이 캡처 회귀값 아래 1.02·위 44.96 과 ±0.1. '모두' 로 바꾸면 S-scan 2개가 그려지고 'OmniPC 대조 전' 표시가 없다(GR-1 섹토리얼 스큐 90 은 2026-10-26 교차 대조로 검증 — `계획_AI개발/T3_섹토리얼_교차검증.md`), 끝나면 GR-2 단독으로 돌아간다.
- **S-scan 게이트 끌기 (sscan-gate-drag-linear)** — GR-2 단독, 스캔 0 · 빔 0, 조정 패널 '게이트' 탭. 좌표는 앱과 같은 식으로 따로 계산한 S-scan 화면 창(부채꼴 + 2 %)과 빔 기하로 정한다(게이트 A 시작선 = 빔 0 깊이 11.0 mm 의 수평선, x = 빔 20 선 위 15 mm). ① 선에 올리면 툴팁 '게이트 A 시작 (깊이 11.0 mm)'·커서 `row-resize`. ② 3 px 움직임은 초안 없음, 15 mm 까지 끄는 동안은 A-scan 다이아몬드만 15.0 mm(패널 값·'조정됨'·C-scan 그대로), 손을 떼면 패널 시작 `15.0`·폭 그대로·'조정됨'·C-scan 그림이 바뀌고 A% 가 따로 계산한 새 창(깊이 15~33 mm, 그 빔의 파일 폭 유지 → 창 [154, 710), 11.80 %)과 ±0.05, 끌기 뒤 click 은 빔을 바꾸지 않는다. ③ 끌다가 Esc → 값·C-scan·빔 그대로. ④ 선을 누르고 빔 방향으로 3 px(6 px 미만) 움직인 클릭 = 빔 고르기(빔 번호 21 ±1), 게이트 그대로. ⑤ 빔 0 으로 돌아가 Ctrl+Z 한 번 → 패널 값이 파일값, '조정됨' 없음, C-scan 이 처음 그림과 바이트 단위로 같고 A% 도 처음 값.

## 라벨 모드 단계 (계획_라벨링 1b, 2026-10-07 검토 반영)

- **캔버스 비교 규칙** — `snapCanvases()` 는 `.viewer` 안 모든 캔버스의 해시 목록(`all`·`count`)과 S/C/A-scan 대표 캔버스를 돌려준다. 라벨 덮개는 영상 위에 겹친 `.vplot__overlay` 캔버스라 `overlayOf()` 로 따로 본다. Electron 에서 캔버스 크기가 바뀐 뒤 **첫 그림**은 반투명 점선(게이트·커서)의 바이트가 다시 그린 것과 다를 수 있어(GPU·CPU 래스터 차이), 비교 전에는 `snapAfterRedraw()`(→ 한 칸 갔다 ← 로 돌아와 다시 그림)로 찍는다.
- **켜고 끄기 (label-mode-toggle-same-canvas)** — L 로 켜면 '라벨' 눌림·오른쪽 패널·도구 묶음·키 안내 '라벨 모드…', 도구 키 3 = 길이. 끄면 S/C/A-scan 과 모든 캔버스 해시가 켜기 전과 같고 덮개 캔버스가 없어야 한다(보통 모드 바이트 그대로).
- **S-scan 확대 (label-sscan-zoom)** — 보통 모드 휠은 S-scan 을 바꾸지 않고, 라벨 모드 휠·눈금자 끌기는 깊이·V 축을 바꾸며, 끄면 보통 창('조정됨' 없음), 다시 켜면 확대 그대로, Z 로 풂.
- **점 찍기 (label-point-click)** — 따로 계산한 화면 창에서 빔 20(60°) 샘플 400 자리를 누른다('최대 진폭' 점은 국소 최대로 붙으므로 '위 팁' 차례로). 패널의 점 = 그 V·실제 깊이·레그, 현재 빔 60°, 영상 위 자홍 점 덮개(덮개 캔버스), A-scan 클릭 = 시간 커서 읽기값, Ctrl+Z = 점 되돌림, 끄면 처음 그림.
- **패널 흐름 (label-panel-flow, 저장하지 않음)** — '새 기록' → N = 최대 진폭 점(± 2 칸·± 2 빔 최대로 커서가 옮겨 갈 수 있음) → 찍을 점 목록이 다음 칸으로 → R → 커서 6칸 → '이 길이로' = 6.0 mm. 앱 제안은 그 뒤에만(값 또는 '제안 불가' 이유, 2인 모드면 숨김 글). 화면의 파란 버튼은 하나(상단바 '파일 가져오기'는 라벨 모드에서 보조 모양). 초안 지우기 → 끈 뒤 그림은 켜기 전과 같다.
- **1280×800 (min-window-label)** — 패널 열림·접힘, A-B-C-S + S-scan 확대('확대' 표시, '파일값으로' 없음)에서 가로 스크롤 없음, 측정값 줄 한 줄, 영상 칸 최소 크기(열림 ≥ 80, 접힘 ≥ 100, A-B-C-S 확대 ≥ 60), 라벨 모드 도구막대는 두 줄까지.
- **도구 포커스 (label-tool-focus-arrow)** — 패널 도구를 마우스로 누른 뒤 → 는 스캔을 옮기고(도구가 바뀌지 않음) R 이 듣는다. 패널 버튼에 포커스를 둔 채 L 로 꺼도 포커스가 영상에 남아 ← 가 듣는다.
- **라벨 스크럽 성능 (label-scrub-perf)** — 1440×900 '모두', N·R 로 초안을 둔 채 ←/→ 40번: 덮개 캔버스가 있고 키 → 다음 프레임 95 % ≤ 50 ms. 2026-10-07 맥: 95 % 14.3 ms · 가운데 9.4 ms (보통 모드 scrub-perf 15.1 ms 와 같은 수준).

## OPD 단계 (2026-10-07)

- **열기 (open-opd-tp14)** — 1280×800 에서 `TP14-ROOT-L-01.opd` 를 연다(가져오지 않았으면 건너뜀). 첫 커서 = 게이트 A C-scan 최대 칸(독립 계산, 216.0 mm), 대조 전 칩 글자가 정확히 'OmniPC 대조 전 (OPD 섹토리얼 · 스큐 90 · 진폭 눈금)' 이고 한 줄(`getClientRects().length === 1`), 'OPD 읽기 주의'·'색표: 내장'·'엔코더 동기'·'자동 변환·학습 내보내기 막힘'·'시편 형상 추정'·'읽기 규칙 opd-structure v4' 글자가 보이고 가로 스크롤 없음(2026-10-07 반박 검토: 읽기 규칙 4 에서 동기 칸·게이트 문턱을 읽게 되어 예전 기대 글자 '스캔 축 동기 모름'·'v2'·'문턱'을 고침).
- **OmniPC 캡처 자리 (opd-tp14-278-65)** — 278 mm·65° 에서 A% 32.3 ±0.1(앱 32.4, '추정 눈금' 붙음), '문턱 모름' 없음(파일 Gate 레코드 A 10 % — 화면과 같음), 실제 깊이(OmniPC DA^) 22.45 ±0.5(앱 22.48), CL 기준 ViA^ 2.21 ±0.5(앱 2.19). C-scan·S-scan 캔버스를 PNG 로 남긴다.

## OmniPC 조사 반영 단계 (2026-10-07)

- **A-scan 기준선 (level-lines-toggle)** — 1440×900, X3 Skew90 39 mm·54°, 조정 패널 '색표' → '색 범위'. 보통 모드는 기본 끔이라 기준선 캔버스(`.vplot__levels`)가 없고, 'A-scan 기준선' 을 켜면 그 캔버스만 생기고 영상 캔버스는 바이트 그대로, 끄면 사라지고 그대로. 선 x 는 따로 계산한 기록 −8 dB·평가 −14 dB(Ref = 기준 진폭 × 10^((이득 − 기준 이득)/20)) 위치와 ±1 px, 선은 2개뿐('Ref' 선은 그리지 않음 — 100 % 축에서는 어차피 축 밖). 라벨 모드는 기본 켬, 끄면 다시 없음.
- **이전·다음 파일 (file-nav-prev-next)** — PL23864_TOP_R_01·02.opd 를 함께 가져왔을 때만(없으면 건너뜀, 둘이 플랜 순서에서 이웃이 아니어도 건너뜀). 범위는 같은 플랜 전체(시편 → 파일 이름 순, 2026-10-07 기본값 (가)) — 자리 'n/N' 은 그 플랜 파일 목록을 앱과 같은 순서로 세어 맞춘다. 1280×800 보통 모드에서 '◀ n/N ▶'(첫 파일이면 ◀ 꺼짐), 도구막대 한 줄(높이 ≤ 40 px)·가로 스크롤 없음. 라벨 모드에서 N(초안 점 하나)·=(이득 +1 dB) → `]` → 02 가 라벨 모드로 다음 자리·초안 없음·'조정됨' 없음(마지막 파일이면 ▶ 꺼짐) → 라벨 패널 단추에 포커스를 둔 `[` 는 파일을 넘기지 않음 → 영상에서 `[` → 01 이 라벨 모드로, 초안 점 1개·'조정됨' 그대로. 끝나면 초안 지우기·파일값으로·라벨 끔. (작업 이벤트 순서 '파일 닫기 → 열기' 는 이 단계에서 보지 않는다 — 작업 이벤트를 읽는 IPC 가 없음.)
