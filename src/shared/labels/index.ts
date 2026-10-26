/**
 * 결함 라벨 기록 스키마 v1 (main · renderer · 테스트 공용, 런타임 의존성 없음).
 * 계획: 계획_라벨링/계획.md, 규격: 계획_라벨링/규격_초안.md 1·2절, 평가: 계획_라벨링/평가_정의_v1.md.
 *   types.ts    저장 단위 다섯 가지 + 내보내기 파일 타입, 버전 상수
 *   codes.ts    열거값 코드 ↔ 한국어 이름, ISO 6520-1 표(원문 대조 전), 제안서 대응, 정답 계층
 *   validate.ts parseLabelExport·레코드별 검사 (한국어 오류·경고, 모르는 칸 보존)
 *   columns.ts  전문가용 엑셀 양식 칸 (0단계 OmniPC 판독)
 *   factory.ts  기본값 만들기, 라벨 세트 키
 *   versions.ts 병합 순서 판단 (버전 벡터)
 *   levels.ts   진폭 기준(시방서 표 13): Ref 대비 dB, 평가·기록 기준 초과
 *   spans.ts    틀 좌표 구간 (겹침·합치기·교집합)
 *   match.ts    지시 매칭 v1
 *   metrics.ts  평가 지표 v1
 *   grouping.ts 그룹 짓기(시방서 그림 5·6)·누적 길이·점 지시 수
 *   derive/     기록 → 학습 라벨 계산 (관측 표·세 상태 장면·상자·A-scan 구간·형상 에코 후보·길이 제안)
 */
export * from './types'
export * from './codes'
export * from './validate'
export * from './columns'
export * from './factory'
export * from './versions'
export * from './levels'
export * from './spans'
export * from './match'
export * from './metrics'
export * from './grouping'
export * from './derive'
