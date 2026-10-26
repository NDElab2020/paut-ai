/**
 * 3단계 검수 계산 (순수 함수, 런타임 의존성 없음 — main · renderer · 테스트 공용).
 * 문서: 계획_라벨링/평가_정의_v1.md 2절(시험 세트 3단계)·3~5절(단위·매칭·지표)·10절(보고 양식)·부록 A(쌍 판정 표),
 *       지침서_v1.md 13절(2인 독립 라벨, Level III 조정).
 *
 *   compare.ts    compareLabelSets — 두 라벨 세트 비교(2인 일치도 · AI 대 정답 · 전문기관 대비). 행(짝·A 만·B 만)과 요약
 *   adjudicate.ts buildFinalSet — Level III 결정(A 채택·B 채택·합침·결함 아님·보류) → 확정 세트 기록·검토 구간
 *                 finalReviewIntervals — 확정 검토 구간(두 사람 검토 완료의 교집합 등)
 *   design.ts     checkAgainstDesign — 물리 결함 표(설계값)와 대조: 미검출·추가 발견·종류 불일치
 *   report.ts     buildEvaluationReport · sensitivityGrid — 10절 보고서 객체, X·Y 민감도
 *   csv.ts        comparisonRowsCsv(부록 A) · designCheckCsv · evaluationReportCsv
 *   uuid.ts       uuidV5 · adjudicationUuid — 결정적 UUID (core 의 stableUuid 와 같은 계산, node:crypto 없이)
 *
 * 흐름(시험 세트): ① 블라인드 2인 → compareLabelSets(A, B) 로 일치도·쌍 판정 표 → ② Level III 가 행마다 결정하고
 *   설계값과 대조(checkAgainstDesign) → ③ buildFinalSet 으로 확정 세트(판독 단계 'final') → AI 평가는
 *   compareLabelSets(확정, AI, { purpose: 'accuracy' }) → buildEvaluationReport.
 * 측정 제안은 이 계산에 들어가지 않는다(2인 독립 모드에서는 화면이 숨김 — settings.labelBlindMode).
 */
export * from './compare'
export * from './adjudicate'
export * from './design'
export * from './report'
export * from './csv'
export * from './uuid'
