/**
 * 검수 결과 CSV (순수 함수, 런타임 의존성 없음). 엑셀에서 바로 열 수 있게 기본으로 UTF-8 BOM 과 CRLF 를 쓴다.
 *   comparisonRowsCsv  비교 행 = 평가 정의 부록 A 의 Level III 쌍 판정 표 (마지막 두 칸 '같은 지시'·'메모'는 빈칸)
 *   designCheckCsv     설계값 대조 표 (짝지어짐·미검출·추가 발견·종류 불일치)
 *   evaluationReportCsv 평가 보고서 (평가 정의 10절 양식, 절마다 제목 줄 + 표, 절 사이 빈 줄)
 *
 * 칸 규칙: 숫자는 소수 셋째 자리까지(뒤 0 은 떼고, −0 은 0), 비율은 % 로 소수 첫째 자리까지, 참/거짓은 예/아니오,
 * 값 없음은 빈칸. 글자 칸이 = + - @ 로 시작하면 앞에 ' 를 붙여 엑셀이 수식으로 읽지 않게 한다.
 */
import {
  CONFIDENCE,
  JUDGMENT_CHARACTER,
  METALLURGICAL_TYPE,
  PROPOSAL_DEFECT_CLASS,
  REVIEW_KIND,
  type ProposalDefectClass
} from '../codes'
import type { DepthSource } from '../match'
import type { ConfusionTable, ProportionCI } from '../metrics'
import type { Confidence, JudgmentCharacter, MetallurgicalType, ReviewIntervalKind } from '../types'
import type { CompareResult, ReviewRowKind, ReviewUnit, RowOutcome } from './compare'
import { DESIGN_ROW_STATUS_LABEL, type DesignCheckResult } from './design'
import { LIST_KIND_LABEL, type EvaluationReport } from './report'

export type CsvCell = string | number | boolean | null | undefined

export interface CsvOptions {
  /** 맨 앞 UTF-8 BOM (엑셀이 한글을 바로 읽게). 기본 true */
  bom?: boolean
  /** 줄 끝. 기본 CRLF (RFC 4180) */
  eol?: '\r\n' | '\n'
  /** 숫자 소수 자리 (기본 3) */
  digits?: number
}

/** 숫자 → 글자 (소수 digits 자리 반올림, 뒤 0 뗌, −0 → 0, 무한·NaN → 빈칸) */
export function formatNumber(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return ''
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  const t = (Object.is(r, -0) ? 0 : r).toFixed(digits)
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t
}

/** 비율(0~1) → % 글자 (소수 첫째 자리) */
export function formatPercent(v: number | null): string {
  return v === null ? '' : formatNumber(v * 100, 1)
}

/** 칸 하나 */
export function csvCell(v: CsvCell, digits = 3): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (typeof v === 'number') return formatNumber(v, digits)
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 표 → CSV 글자 */
export function toCsv(rows: readonly (readonly CsvCell[])[], opts: CsvOptions = {}): string {
  const eol = opts.eol ?? '\r\n'
  const digits = opts.digits ?? 3
  const body = rows.map((r) => r.map((c) => csvCell(c, digits)).join(',')).join(eol)
  return `${opts.bom === false ? '' : '﻿'}${body}${eol}`
}

// ───────────────────────────── 이름표 ─────────────────────────────

export const ROW_KIND_LABEL: Readonly<Record<ReviewRowKind, string>> = { pair: '짝', 'only-a': 'A 만', 'only-b': 'B 만' }

export const ROW_OUTCOME_LABEL: Readonly<Record<RowOutcome, string>> = {
  match: '짝 (셈함)',
  'match-b-reference': 'B 참고 단위와만 짝 (미검출로 셈)',
  'match-reference': 'A 참고 단위와 짝 (셈하지 않음)',
  'a-only': 'A 만 (미검출)',
  'b-only': 'B 만 (오검출)',
  zone: 'B 만, A 참고 구역 (셈하지 않음)',
  'outside-coverage': '검토 범위 밖 (따로 셈)',
  reference: '참고 단위 (셈하지 않음)'
}

export const DEPTH_SOURCE_LABEL: Readonly<Record<DepthSource, string>> = {
  range: '깊이 위·아래',
  peak: '최대 진폭 깊이',
  design: '설계값'
}

const typeName = (t: MetallurgicalType | null): string | null => (t === null ? null : METALLURGICAL_TYPE[t])
const charName = (c: JudgmentCharacter | null): string | null => (c === null ? null : JUDGMENT_CHARACTER[c])
const confName = (c: Confidence | null | undefined): string | null => (c === null || c === undefined ? null : CONFIDENCE[c])
const zoneName = (z: ReviewIntervalKind | null): string | null => (z === null ? null : REVIEW_KIND[z])
const depthSrc = (u: ReviewUnit | null): string | null => (u?.item.depthSource ? DEPTH_SOURCE_LABEL[u.item.depthSource] : null)
const join = (xs: readonly string[] | undefined): string | null => (xs && xs.length > 0 ? xs.join(' · ') : null)

// ───────────────────────────── 비교 행 (부록 A) ─────────────────────────────

export const COMPARISON_CSV_HEADER: readonly string[] = [
  '쌍 ID',
  '구분',
  '판정',
  '파일명',
  'A 라벨러',
  'A 지시 번호',
  'B 라벨러',
  'B 지시 번호',
  '셈함',
  '스캔 간격 (mm)',
  '스캔 겹침 (mm)',
  '깊이 중심 차 (mm)',
  'A 깊이 출처',
  'B 깊이 출처',
  '스캔 중심 차 (mm)',
  '길이 차 (mm)',
  '높이 차 (mm)',
  'A 스캔 시작 (mm)',
  'A 스캔 끝 (mm)',
  'B 스캔 시작 (mm)',
  'B 스캔 끝 (mm)',
  'A 깊이 중심 (mm)',
  'B 깊이 중심 (mm)',
  'A 길이 (mm)',
  'B 길이 (mm)',
  'A 높이 (mm)',
  'B 높이 (mm)',
  'A 종류',
  'B 종류',
  '1단 일치 (면상/체적)',
  '2단 일치 (제안서 5종)',
  '종류 그대로 일치',
  '종류 확신도 불확실',
  'A 존재 확신도',
  'B 존재 확신도',
  'A 종류 확신도',
  'B 종류 확신도',
  '후보 있었음',
  '참고 구역',
  '검토 범위 밖',
  '같은 지시 (Level III: 같음/다름/모름)',
  '메모 (Level III)'
]

/** 비교 행 → 부록 A 쌍 판정 표 CSV */
export function comparisonRowsCsv(c: CompareResult, opts: CsvOptions = {}): string {
  const rows: CsvCell[][] = [[...COMPARISON_CSV_HEADER]]
  for (const r of c.rows) {
    const a = r.a
    const b = r.b
    const files = [...new Set([...(a?.fileNames ?? []), ...(b?.fileNames ?? [])])]
    rows.push([
      r.id,
      ROW_KIND_LABEL[r.kind],
      ROW_OUTCOME_LABEL[r.outcome],
      join(files),
      a?.labelerId ?? (r.kind === 'only-b' ? null : c.labelers.a),
      join(a?.refs),
      b?.labelerId ?? (r.kind === 'only-a' ? null : c.labelers.b),
      join(b?.refs),
      r.counted,
      r.geometry?.scanGapMm,
      r.geometry?.scanOverlapMm,
      r.geometry?.depthCenterDiffMm,
      depthSrc(a),
      depthSrc(b),
      r.diff.scanCenter,
      r.diff.length,
      r.diff.height,
      a?.item.scanStartMm,
      a?.item.scanEndMm,
      b?.item.scanStartMm,
      b?.item.scanEndMm,
      a?.item.depthCenterMm,
      b?.item.depthCenterMm,
      a?.item.lengthMm,
      b?.item.lengthMm,
      a?.item.heightMm,
      b?.item.heightMm,
      typeName(a?.item.defectType ?? null),
      typeName(b?.item.defectType ?? null),
      r.agreement?.character.agree,
      r.agreement?.proposalClass.agree,
      r.agreement?.type.agree,
      r.agreement ? r.agreement.typeUncertain : null,
      confName(a?.existenceConfidence),
      confName(b?.existenceConfidence),
      confName(a?.item.typeConfidence),
      confName(b?.item.typeConfidence),
      r.kind === 'pair' ? null : r.hadCandidate,
      zoneName(r.zone),
      r.kind === 'pair' ? null : r.outsideCoverage,
      null,
      null
    ])
  }
  return toCsv(rows, opts)
}

// ───────────────────────────── 설계값 대조 ─────────────────────────────

export const DESIGN_CSV_HEADER: readonly string[] = [
  '행 ID',
  '판정',
  '판정 세부',
  '물리 결함',
  '설계 종류',
  '설계 시작 (시편 mm)',
  '설계 끝 (시편 mm)',
  '설계 길이 (mm)',
  '셈함',
  '파일명',
  '지시 번호',
  '라벨러',
  '기록 시작 (시편 mm)',
  '기록 끝 (시편 mm)',
  '기록 길이 (mm)',
  '기록 종류',
  '1단 일치 (면상/체적)',
  '2단 일치 (제안서 5종)',
  '종류 불일치',
  '스캔 중심 차 (mm, 기록 − 설계)',
  '길이 차 (mm, 기록 − 설계)',
  '기록의 물리 결함 ID',
  'ID 불일치',
  '검토 범위 밖',
  '참고 구역',
  '원인·메모 (Level III)'
]

export function designCheckCsv(d: DesignCheckResult, opts: CsvOptions = {}): string {
  const rows: CsvCell[][] = [[...DESIGN_CSV_HEADER]]
  for (const r of d.rows) {
    const u = r.unit
    rows.push([
      r.id,
      DESIGN_ROW_STATUS_LABEL[r.status],
      ROW_OUTCOME_LABEL[r.outcome],
      r.defectKey,
      typeName(r.design?.defectType ?? null),
      r.design?.scanStartMm,
      r.design?.scanEndMm,
      r.design?.lengthMm,
      r.counted,
      join(u?.fileNames),
      join(u?.refs),
      u?.labelerId,
      u?.item.scanStartMm,
      u?.item.scanEndMm,
      u?.item.lengthMm,
      typeName(u?.item.defectType ?? null),
      r.agreement?.character.agree,
      r.agreement?.proposalClass.agree,
      r.status === 'matched' ? r.typeMismatch : null,
      r.scanCenterDiffMm,
      r.lengthDiffMm,
      join(r.recordDefectKeys),
      r.idMismatch,
      r.outsideCoverage,
      zoneName(r.zone),
      null
    ])
  }
  return toCsv(rows, opts)
}

// ───────────────────────────── 보고서 ─────────────────────────────

function ciCells(ci: ProportionCI | null): CsvCell[] {
  if (ci === null) return [null, null, null, null]
  return [ci.x, ci.n, formatPercent(ci.p), ci.lower === null ? null : `${formatPercent(ci.lower)}~${formatPercent(ci.upper)}`]
}

function confusionRows<T extends string>(title: string, t: ConfusionTable<T>, names: Readonly<Record<T, string>>): CsvCell[][] {
  const rows: CsvCell[][] = [[title], ['정답(A) \\ 예측(B)', ...t.classes.map((c) => names[c])]]
  t.classes.forEach((c, i) => rows.push([names[c], ...(t.matrix[i] ?? [])]))
  rows.push(['쌍 수', t.total], ['일치율 (%)', formatPercent(t.agreement)], ['kappa', t.kappa.kappa])
  rows.push(['A 종류 모름으로 뺀 쌍', t.unknownA], ['B 종류 모름으로 뺀 쌍', t.unknownB], ['종류 확신도 불확실로 뺀 쌍', t.typeUncertain])
  return rows
}

/** 평가 보고서 → CSV (절마다 제목 줄) */
export function evaluationReportCsv(r: EvaluationReport, opts: CsvOptions = {}): string {
  const h = r.header
  const rows: CsvCell[][] = []
  const gap = (): void => {
    rows.push([])
  }
  rows.push(['[머리]'], ['항목', '값'])
  rows.push(
    ['무엇 대비', h.name],
    ['A (정답 쪽)', h.labelers.a],
    ['B (예측 쪽)', h.labelers.b],
    ['데이터셋 버전', h.datasetVersion],
    ['시험 세트 잠금 날짜', h.testSetLockedAt],
    ['정답 계층', h.truthTierLabel],
    ['매칭 규칙', `v${h.matchRulesVersion}`],
    ['X 스캔 간격 (mm)', h.scanGapMm],
    ['Y 깊이 중심 차 (mm)', h.depthDiffMm],
    ['X·Y 동결 날짜', h.matchFrozenAt ?? '잠정값 (동결 전)'],
    ['검수 계산 규칙', `v${h.reviewRulesVersion}`],
    ['좌표 틀', h.frame],
    ['비교 단위', h.unit],
    ['검토 범위', h.coverageRule],
    ['구간 단위 길이 (mm)', h.gradingUnitMm],
    ['지침서 버전', h.guidelineVersion],
    ['모델 버전', h.modelVersion],
    ['독립 물리 결함 수', h.physicalDefects.total],
    ['  면상', h.physicalDefects.planar],
    ['  체적', h.physicalDefects.volumetric],
    ['  종류 모름', h.physicalDefects.unknown],
    ['시편 수', h.specimens],
    ['용접부 수', h.welds],
    ['검토 길이 (m)', h.reviewedLengthM],
    ['가설 정렬 섞임', h.alignmentAssumed]
  )
  gap()
  rows.push(['[검출]'])
  rows.push([
    '범주',
    '물리 결함 수',
    '찾은 물리 결함',
    '물리 결함 단위 재현율 (%)',
    '95 % 구간 (%)',
    '지시 단위 맞힘',
    '지시 단위 정답 수',
    '지시 단위 재현율 (%)',
    '95 % 구간 (%)',
    '미검출 중 참고 예측과만 맞음',
    '짝을 잃음',
    '검토 범위 밖이라 뺀 정답',
    '불확실 정답 수',
    '그 가운데 낸 수'
  ])
  for (const d of r.detection) {
    const dr = ciCells(d.defectRecall)
    const ir = ciCells(d.indicationRecall)
    rows.push([
      d.label,
      d.physicalDefects,
      d.foundDefects,
      dr[2],
      dr[3],
      ir[0],
      ir[1],
      ir[2],
      ir[3],
      d.missesMatchedToReference,
      d.missesLostCompetition,
      d.truthOutsideCoverage,
      d.uncertainTruths,
      d.uncertainEmitted
    ])
  }
  gap()
  const fp = r.falsePositives
  rows.push(['[오검출]'])
  rows.push(['오검출', '용접부 수', '용접부당', '검토 길이 (mm)', 'm당', '참고 정답과 맞아 뺌', '참고 구역이라 뺌', '검토 범위 밖이라 뺌'])
  rows.push([fp.falsePositives, fp.welds, fp.perWeld, fp.inspectedLengthMm, fp.perMeter, fp.predMatchedToReference, fp.predInZone, fp.predOutsideCoverage])
  gap()
  rows.push(['[위치·크기] 예측 − 정답 (mm)'])
  rows.push(['칸', 'n', 'MAE', '치우침', '95 % 분위', 'RMSE', '최대', '사람 간 MAE'])
  for (const e of r.errors) rows.push([e.label, e.stats.n, e.stats.mae, e.stats.bias, e.stats.p95Abs, e.stats.rmse, e.stats.maxAbs, e.humanMae])
  gap()
  rows.push(...confusionRows('[종류 1단] 면상 / 체적', r.types.character, JUDGMENT_CHARACTER))
  gap()
  rows.push(...confusionRows('[종류 2단] 제안서 5종', r.types.proposalClass, PROPOSAL_DEFECT_CLASS as Readonly<Record<ProposalDefectClass, string>>))
  gap()
  rows.push(['[구간 단위]'])
  if (r.grading) {
    const g = r.grading
    rows.push(
      ['칸 길이 (mm)', g.unitMm],
      ['전체 칸', g.units],
      ['쓴 칸', g.used],
      ['참고 단위로 뺀 칸', g.excludedReference],
      ['품질 불량으로 뺀 칸', g.excludedQuality],
      ['', 'B 결함', 'B 없음'],
      ['A 결함', g.table[0][0], g.table[0][1]],
      ['A 없음', g.table[1][0], g.table[1][1]],
      ['kappa', g.kappa.kappa],
      ['구간 단위 정확도·일치율 (%)', formatPercent(g.accuracy)],
      ['결함 없는 칸 / 결함 칸 (A)', g.negativesPerPositive]
    )
  } else rows.push(['검토 범위를 몰라 내지 않음'])
  gap()
  const p = r.pod
  rows.push(['[POD] (길이 기준)'])
  rows.push(
    ['물리 결함 수', p.defects],
    ['찾음 (hit)', p.hits],
    ['놓침 (miss)', p.misses],
    ['한쪽 95 % 하한 (%)', formatPercent(p.lowerBound95)],
    ['90/95 에 필요한 결함 수 (지금 놓침 수 기준)', p.requiredFor9095],
    ['전부 찾음 (곡선 추정 불가)', p.allHit],
    ['메모', p.note]
  )
  gap()
  rows.push(['[민감도] X·Y 를 바꾼 결과'])
  if (r.sensitivity && r.sensitivity.length > 0) {
    rows.push(['X (mm)', 'Y (mm)', '지시 단위 재현율 (%)', '95 % 구간 (%)', '물리 결함 단위 재현율 (%)', '오검출', 'F1'])
    for (const s of r.sensitivity) {
      const ir = ciCells(s.indicationRecall)
      const dr = ciCells(s.defectRecall)
      rows.push([s.scanGapMm, s.depthDiffMm, ir[2], ir[3], dr[2], s.falsePositives, s.f1])
    }
  } else rows.push(['계산하지 않음'])
  gap()
  rows.push(['[놓침·오검출 목록]'])
  rows.push(['행 ID', '구분', '참고 예측과만 맞음', '파일명', '스캔 시작 (mm)', '스캔 끝 (mm)', '깊이 중심 (mm)', '길이 (mm)', '높이 (mm)', '종류', '판정 특성', '원인 (SNR·비드 형상 간섭·커플링 불량·모드 변환 등)'])
  for (const l of r.list) {
    rows.push([
      l.rowId,
      LIST_KIND_LABEL[l.kind],
      l.matchedToReference,
      join(l.fileNames),
      l.scanStartMm,
      l.scanEndMm,
      l.depthCenterMm,
      l.lengthMm,
      l.heightMm,
      typeName(l.defectType),
      charName(l.character),
      l.cause === '' ? null : l.cause
    ])
  }
  if (r.design) {
    gap()
    const d = r.design
    rows.push(['[설계값 대조]'])
    rows.push(
      ['정답 계층 기준', d.minTierLabel],
      ['설계 결함 수', d.defects],
      ['셈하는 설계 결함', d.countedDefects],
      ['짝지어짐', d.matched],
      ['미검출', d.missed],
      ['  그 가운데 검토 범위 밖', d.missedOutsideCoverage],
      ['추가 발견', d.extra],
      ['종류 불일치', d.typeMismatches],
      ['물리 결함 ID 불일치', d.idMismatches],
      ['물리 결함 단위 재현율 (%)', ciCells(d.recall)[2]],
      ['95 % 구간 (%)', ciCells(d.recall)[3]]
    )
  }
  gap()
  rows.push(['[확인 사항]'])
  if (r.warnings.length === 0) rows.push(['없음'])
  for (const w of r.warnings) rows.push([w])
  return toCsv(rows, opts)
}
