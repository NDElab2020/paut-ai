/** 화면 표시용 형식·라벨. 단위는 숫자 뒤 한 칸, 범위는 en dash (PAUT_DESIGN.md 3절). */
import type {
  BeamFormation,
  ImportBatchStatus,
  ImportItemStatus,
  ImportVerdict,
  ProbeRole,
  ProgressPhase,
  SpecCategory,
  SpecimenIdSource,
  SpecimenShape,
  Technique
} from '@shared/types'

export const DASH = '—'

export type StatusTone = 'new' | 'attention' | 'ok' | 'muted' | 'error'

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return v.toFixed(digits).replace('-', '−')
}

/** 정수면 소수점 없이, 아니면 한 자리 */
export function deg(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1)
  return `${s.replace('-', '−')}°`
}

export function signedMm(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const s = Math.abs(v).toFixed(1)
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s} mm`
}

export function angleRange(r: { startDeg: number | null; stopDeg: number | null; stepDeg: number | null } | null): string {
  if (!r || r.startDeg === null) return DASH
  const span = r.stopDeg === null || r.stopDeg === r.startDeg ? deg(r.startDeg) : `${deg(r.startDeg).slice(0, -1)}–${deg(r.stopDeg)}`
  return r.stepDeg ? `${span} / ${deg(r.stepDeg)}` : span
}

/** ISO 문자열의 기록된 현지 시각 그대로 'YYYY-MM-DD HH:mm' */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso
}

export function date(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : DASH
}

export function shortHash(h: string | null | undefined, n = 8): string {
  if (!h) return DASH
  const body = h.replace(/^fp\d+:/, '')
  return body.length > n * 2 ? `${body.slice(0, n)}…${body.slice(-4)}` : body
}

export function joinPath(root: string | null | undefined, rel: string): string {
  if (!root) return rel
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

export const SHAPE_LABEL: Record<SpecimenShape, string> = {
  plate: '판재',
  pipe: '배관',
  bar: '봉재',
  unspecified: '지정 안 됨',
  unknown: '알 수 없음'
}

export const TECHNIQUE_LABEL: Record<Technique, string> = {
  PA: 'PA',
  UT: 'UT',
  TFM: 'TFM',
  FMC: 'FMC',
  PWI: 'PWI',
  ToFD: 'ToFD',
  other: '기타'
}

export const FORMATION_LABEL: Record<BeamFormation, string> = {
  sectorial: '섹터',
  linear: '선형',
  compound: '복합',
  none: '',
  other: '기타'
}

export const ROLE_LABEL: Record<ProbeRole, string> = {
  pulseEcho: '펄스에코',
  pulser: '송신',
  receiver: '수신'
}

export const CATEGORY_LABEL: Record<SpecCategory, string> = {
  specimen: '시편·용접',
  probe: '탐촉자·웨지',
  position: '위치',
  beam: '빔',
  structure: '구성'
}

const WAVE_LABEL: Record<string, string> = {
  TransversalVertical: '횡파(SV)',
  TransversalHorizontal: '횡파(SH)',
  Transversal: '횡파',
  Longitudinal: '종파'
}

export function waveLabel(v: string | null): string {
  return v ? (WAVE_LABEL[v] ?? v) : DASH
}

const SYMMETRY_LABEL: Record<string, string> = { Symmetric: '대칭', Left: '왼쪽', Right: '오른쪽' }

export function symmetryLabel(v: string | null): string {
  return v ? (SYMMETRY_LABEL[v] ?? v) : DASH
}

export const VERDICT: Record<ImportVerdict, { label: string; tone: StatusTone }> = {
  'new-plan': { label: '새 플랜', tone: 'new' },
  'match-existing': { label: '기존 플랜에 추가', tone: 'ok' },
  'missing-copy': { label: '사본 복원', tone: 'attention' },
  duplicate: { label: '중복', tone: 'muted' },
  unsupported: { label: '보류(미지원)', tone: 'muted' },
  error: { label: '오류', tone: 'error' }
}

export const VERDICT_ORDER: readonly ImportVerdict[] = ['new-plan', 'match-existing', 'missing-copy', 'duplicate', 'unsupported', 'error']

export const ITEM_STATUS: Record<ImportItemStatus, { label: string; tone: StatusTone }> = {
  copied: { label: '복사됨', tone: 'ok' },
  restored: { label: '복원됨', tone: 'ok' },
  'skipped-duplicate': { label: '중복 건너뜀', tone: 'muted' },
  'skipped-excluded': { label: '제외함', tone: 'muted' },
  'skipped-unsupported': { label: '보류(미지원)', tone: 'muted' },
  failed: { label: '실패', tone: 'error' }
}

export const BATCH_STATUS: Record<ImportBatchStatus, { label: string; tone: StatusTone }> = {
  completed: { label: '완료', tone: 'ok' },
  partial: { label: '일부 실패', tone: 'attention' },
  failed: { label: '실패', tone: 'error' },
  cancelled: { label: '취소됨', tone: 'muted' },
  interrupted: { label: '중단됨', tone: 'muted' }
}

export const SOURCE_LABEL: Record<SpecimenIdSource, string> = {
  'device-filename': '장비 원본 이름에서',
  filename: '파일명에서 추정',
  manual: '직접 입력'
}

/** 시편 묶음 줄 등 문장 속에서 쓰는 ID 출처 */
export const SOURCE_ID_LABEL: Record<SpecimenIdSource, string> = {
  'device-filename': '장비 원본 이름에서 찾은 ID',
  filename: '파일명에서 추정한 ID',
  manual: '직접 입력한 ID'
}

export const PHASE_LABEL: Record<ProgressPhase, string> = {
  scan: '파일 찾는 중',
  read: '셋업 읽는 중',
  hash: '해시 계산 중',
  match: '스캔플랜 비교 중',
  copy: '복사 중',
  verify: '검증 중',
  catalog: '카탈로그 기록 중',
  done: '마무리 중'
}

export function count(n: number, unit = '개'): string {
  return `${n.toLocaleString('ko-KR')}${unit}`
}
