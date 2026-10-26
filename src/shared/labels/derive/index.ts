/**
 * 기록 → 학습 라벨 계산 (2a 단계, 순수 함수, 런타임 의존성 없음). 규칙서: 계획_라벨링/규격_초안.md 3·4절.
 *   rules.ts       규칙 버전 LABEL_DERIVE_RULES_VERSION, 매개변수·기본값, 진폭 기준(%FSH)
 *   amplitude.ts   진폭 읽기 계약 GroupAmplitude (core: 조각, renderer: volumeStore, 시험: 함수)
 *   geometry.ts    칸 기하(빔 × 샘플 전수 정방향 계산), 영역·탐색 창 칸, U → 스캔 칸, 용접 자리
 *   anchors.ts     앵커 ↔ mm, 엑셀 기록의 앵커 추정, 좌표 규칙이 바뀐 기록 다시 계산·재확인 필요
 *   envelope.ts    스캔축 포락선 하나 (길이 제안 · 학습 에코 범위 공용), 길이 제안
 *   observation.ts 관측 표 (기록 × 그룹 × 레그)
 *   echo.ts        형상 에코 후보 (용접 형상 + 빔 피복률)
 *   scenes.ts      세 상태 장면 라벨 · 장면 상자 · C-scan 상자 · A-scan 구간
 *   derive.ts      파일 하나 계산(deriveFileLabels / runDerive), B-scan 상자, A-scan 라벨
 */
export * from './rules'
export * from './amplitude'
export * from './geometry'
export * from './anchors'
export * from './envelope'
export * from './context'
export * from './observation'
export * from './echo'
export * from './scenes'
export * from './derive'
