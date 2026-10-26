/**
 * OmniPC 측정값(readings) 표 — 파일 키 → 화면 이름·우리말 설명·소수 자리 (L1). 런타임 의존성 없음.
 *
 * 근거 (허용 근거만 — OmniPC_조사/조사_보고.md 맨 위 '근거 정리'):
 *   - 뜻: 공개된 OmniScan MXU 설명서 4.4·5.6·5.8 의 측정값 정의(OmniPC_조사/3_웹문서.md 2절)를 우리말로 짧게 줄인 것. 설명서 문장을 옮기지 않았다.
 *   - 파일 키: 우리 .nde 의 비공개 ModelSetup `GroupSetup/ReadingSetup` 에 실제로 나온 글자(4_NDE설정.md 4.8).
 *   - 화면 이름: X3·X4 TF 캡처의 'Custom' 10칸과 순서까지 같은 10개만 [확인: 캡처]. 나머지는 키 글자로 미룬 이름이라 labelBasis 'estimated'.
 *   - 소수 자리: 캡처 표기 — 진폭 % 1자리(32.3 %), 위치·거리·dB 2자리(22.45 mm, −18.25 dB).
 * OmniPC 설치본에서 꺼낸 이름·설명문은 쓰지 않는다. 파일 키를 모르는 측정값(4.4 설명서에만 있는 RA^·LA^ 등)은 key = null.
 *
 * 주의: OmniPC 측정값의 U 는 초음파축(깊이·음로·시간)이고 스캔축은 S 다. 앱·NDE 좌표의 U(스캔 위치)와 글자만 같다 — 길이는 S(m−r).
 */

import type { ViewerGate } from './types'

/** 정의가 나오는 공개 설명서 판 */
export type ReadingManual = '4.4' | '5.6' | '5.8'

export interface ReadingInfo {
  /** 파일 ReadingType 키 (모르면 null) */
  key: string | null
  /** 앱에 보이는 이름 (빼기는 U+2212 '−', 예 'S(m−r)') */
  label: string
  /** OmniPC 화면 표기 그대로 (빼기는 ASCII '-', 예 'S(m-r)'. 6.6 은 I•U 를 가운뎃점으로 씀) */
  omnipcLabel: string
  /** 이름 근거: 'capture' = OmniPC 캡처로 확인, 'estimated' = 키 글자로 미룸(캡처로 확인 필요) */
  labelBasis: 'capture' | 'estimated'
  /** 단위 */
  unit: '%' | 'mm' | 'dB' | ''
  /** 표시 소수 자리 (진폭 % 1, 위치·거리·dB 2) */
  decimals: number
  /** 우리말 설명 (공개 설명서 정의 요약). 뜻을 모르면 '확인 필요' 문장 */
  description: string
  /** 정의가 나오는 설명서 판. 빈 배열 = 공개 정의 없음 */
  manuals: ReadingManual[]
  /** 확인 필요 메모 (캡처 번호 등) */
  note?: string
}

const ALL: ReadingManual[] = ['4.4', '5.6', '5.8']

/** 측정값 표. 앞 10개 = X3·X4 파일에 저장된 'Custom' 목록 순서 */
export const READINGS: readonly ReadingInfo[] = [
  {
    key: 'APercent',
    label: 'A%',
    omnipcLabel: 'A%',
    labelBasis: 'capture',
    unit: '%',
    decimals: 1,
    description: '게이트 A 안에서 가장 센 봉우리의 진폭(%FSH). 게이트의 봉우리 고르기(가장 큰 것·첫 것)를 따른다.',
    manuals: ALL
  },
  {
    key: 'DAPosition',
    label: 'DA^',
    omnipcLabel: 'DA^',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '게이트 A 지시를 낸 반사체의 시편 안 깊이. ^ = 봉우리 자리에서 잰 값.',
    manuals: ALL,
    note: '레그를 접은 깊이인지는 캡처 49 로 확인 전'
  },
  {
    key: 'PAPosition',
    label: 'PA^',
    omnipcLabel: 'PA^',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '시편 표면에서 웨지(탐촉자) 앞면부터 지시까지의 거리.',
    manuals: ALL
  },
  {
    key: 'SAPosition',
    label: 'SA^',
    omnipcLabel: 'SA^',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '시편 입사점부터 지시까지의 음로(소리가 지나간 길이).',
    manuals: ALL
  },
  {
    key: 'ViAPosition',
    label: 'ViA^',
    omnipcLabel: 'ViA^',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '지시의 인덱스축 체적 위치(부호 있음). 기준점은 보통 용접 중심선.',
    manuals: ALL
  },
  {
    key: 'Umr',
    label: 'U(m−r)',
    omnipcLabel: 'U(m-r)',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '초음파축(깊이·음로·시간 중 화면 단위)에서 측정 커서 − 기준 커서. 깊이 차라 스캔 방향 길이가 아니다(길이는 S(m−r)).',
    manuals: ALL
  },
  {
    key: 'Imr',
    label: 'I(m−r)',
    omnipcLabel: 'I(m-r)',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '인덱스축에서 측정 커서 − 기준 커서.',
    manuals: ALL
  },
  {
    key: 'IUmr',
    label: 'I•U(m−r)',
    omnipcLabel: 'I•U(m-r)',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '두 커서가 만드는 직사각형의 대각선 길이 = √(I(m−r)² + U(m−r)²).',
    manuals: ALL
  },
  {
    key: 'Im',
    label: 'I(m)',
    omnipcLabel: 'I(m)',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '측정 커서의 인덱스축 위치.',
    manuals: ALL
  },
  {
    key: 'Um',
    label: 'U(m)',
    omnipcLabel: 'U(m)',
    labelBasis: 'capture',
    unit: 'mm',
    decimals: 2,
    description: '측정 커서의 초음파축 위치(화면 단위).',
    manuals: ALL
  },
  // ── 키는 파일에 있으나 화면 이름은 키 글자로 미룬 것 (TFM·ToFD 예제 목록) ──
  {
    key: 'Sr',
    label: 'S(r)',
    omnipcLabel: 'S(r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '기준 커서의 스캔축 위치. 지시 길이를 잴 때 시작점.',
    manuals: ALL
  },
  {
    key: 'Sm',
    label: 'S(m)',
    omnipcLabel: 'S(m)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '측정 커서의 스캔축 위치. 지시 길이를 잴 때 끝점.',
    manuals: ALL
  },
  {
    key: 'Smr',
    label: 'S(m−r)',
    omnipcLabel: 'S(m-r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '스캔축에서 측정 커서 − 기준 커서 = 지시 길이. 앱 길이 도구(기준 커서 R → 현재 커서)와 같은 부호.',
    manuals: ALL,
    note: '화면 이름 S(m-r) 은 인천·TP14 .opd 캡처 목록에 보임(파일 키와 짝은 키 글자로 미룸)'
  },
  {
    key: 'Dm',
    label: 'D(m)',
    omnipcLabel: 'D(m)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '측정 커서(초음파축)의 시편 안 깊이.',
    manuals: ALL
  },
  {
    key: 'Dmr',
    label: 'D(m−r)',
    omnipcLabel: 'D(m-r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '두 커서의 시편 안 깊이 차.',
    manuals: ALL
  },
  {
    key: 'PercentMR',
    label: '%(m−r)',
    omnipcLabel: '%(m-r)',
    labelBasis: 'estimated',
    unit: '%',
    decimals: 1,
    description: '측정 커서 자리 진폭 − 기준 커서 자리 진폭.',
    manuals: ALL
  },
  {
    key: 'PercentUr',
    label: '%(U(r))',
    omnipcLabel: '%(U(r))',
    labelBasis: 'estimated',
    unit: '%',
    decimals: 1,
    description: '기준 커서(초음파축) 자리의 신호 진폭. 설명서 5.8 은 TOFD 그룹에서만 쓴다고 적는다.',
    manuals: ['4.4', '5.8']
  },
  {
    key: 'PercentUm',
    label: '%(U(m))',
    omnipcLabel: '%(U(m))',
    labelBasis: 'estimated',
    unit: '%',
    decimals: 1,
    description: '측정 커서(초음파축) 자리의 신호 진폭. 설명서 5.8 은 TOFD 그룹에서만 쓴다고 적는다.',
    manuals: ['4.4', '5.8']
  },
  {
    key: 'TOFDr',
    label: 'TOFD(r)',
    omnipcLabel: 'TOFD(r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: 'TOFD 보정된 그룹에서 기준 커서 자리의 깊이.',
    manuals: ALL
  },
  {
    key: 'TOFDm',
    label: 'TOFD(m)',
    omnipcLabel: 'TOFD(m)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: 'TOFD 보정된 그룹에서 측정 커서 자리의 깊이.',
    manuals: ALL
  },
  {
    key: 'TOFDmr',
    label: 'TOFD(m−r)',
    omnipcLabel: 'TOFD(m-r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: 'TOFD 보정된 그룹에서 두 커서의 깊이 차.',
    manuals: ALL
  },
  {
    key: 'AdBA',
    label: 'AdBA',
    omnipcLabel: 'AdBA',
    labelBasis: 'estimated',
    unit: 'dB',
    decimals: 2,
    description: '게이트 A 진폭(dB) − 게이트 A 문턱(dB). 문턱 대비 값이라 Ref(기준 감도) 대비가 아니다 — Ref 대비 칸에 쓰지 않는다.',
    manuals: ALL,
    note: '기준 이득을 켠 파일에서 화면 Gain 을 빼는지는 캡처 46 대조 전'
  },
  {
    key: 'AdBr',
    label: 'AdBr',
    omnipcLabel: 'AdBr',
    labelBasis: 'estimated',
    unit: 'dB',
    decimals: 2,
    description: '현재 신호 진폭과 기준(reference) 진폭의 차(dB). 기준 커서와는 관계없다.',
    manuals: ALL,
    note: '5.x 의 기준 진폭이 Ref. Amplitude(80 %)인지, 앱 Ref 대비 dB 와 같은 식인지는 캡처 46 대조 전'
  },
  {
    key: 'MaxPercentZ',
    label: 'MaxPercentZ',
    omnipcLabel: 'MaxPercentZ',
    labelBasis: 'estimated',
    unit: '%',
    decimals: 1,
    description: '뜻 확인 필요 — TFM 예제 파일의 저장 목록에만 있고 공개 설명서에서 정의를 찾지 못했다.',
    manuals: [],
    note: '화면 이름·뜻은 캡처 35 로 확인'
  },
  // ── 파일 키를 모르는 것: 앱 화면·문서에서 이름으로만 찾는다 ──
  {
    key: null,
    label: 'U(r)',
    omnipcLabel: 'U(r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '기준 커서의 초음파축 위치(화면 단위).',
    manuals: ALL
  },
  {
    key: null,
    label: 'I(r)',
    omnipcLabel: 'I(r)',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '기준 커서의 인덱스축 위치.',
    manuals: ALL
  },
  {
    key: null,
    label: 'VsA^',
    omnipcLabel: 'VsA^',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '지시의 스캔축 체적 위치(기준점에서 잰 스캔 좌표).',
    manuals: ALL
  },
  {
    key: null,
    label: 'AdBCurve',
    omnipcLabel: 'AdBCurve',
    labelBasis: 'estimated',
    unit: 'dB',
    decimals: 2,
    description: '게이트 A 봉우리와, 고른 크기 곡선(TCG·DAC 곡선) 자리 진폭의 차(dB).',
    manuals: ALL
  },
  {
    key: null,
    label: 'RA^',
    omnipcLabel: 'RA^',
    labelBasis: 'estimated',
    unit: 'mm',
    decimals: 2,
    description: '시편 표면에서 빔 출사점부터 지시까지의 거리. 4.4 설명서에만 있다.',
    manuals: ['4.4'],
    note: '6.6 에서 고를 수 있는지는 캡처 19'
  },
  {
    key: null,
    label: 'LA^',
    omnipcLabel: 'LA^',
    labelBasis: 'estimated',
    unit: '',
    decimals: 0,
    description: '출사점에서 반사체까지 빔이 튄 횟수(스킵 수). 4.4 설명서에만 있다.',
    manuals: ['4.4'],
    note: '6.6 에서 고를 수 있는지는 캡처 19'
  }
]

const BY_KEY = new Map(READINGS.filter((r) => r.key !== null).map((r) => [r.key!, r]))
const BY_LABEL = new Map(READINGS.flatMap((r) => [[r.label, r] as const, [r.omnipcLabel, r] as const]))

/** 파일 키 → 측정값 정보 (모르는 키는 null) */
export function readingByKey(key: string): ReadingInfo | null {
  return BY_KEY.get(key) ?? null
}

/** 화면 이름('S(m−r)'·'S(m-r)' 둘 다) → 측정값 정보 */
export function readingByLabel(label: string): ReadingInfo | null {
  return BY_LABEL.get(label) ?? null
}

/** 파일 키 → 앱 표시 이름 (모르는 키는 키 그대로) */
export function readingLabel(key: string): string {
  return readingByKey(key)?.label ?? key
}

/** 값 → 표시 글자 (소수 자리·단위). 값이 없으면 OmniPC 와 같은 'ND'(게이트 문턱을 넘은 신호 없음) */
export function formatReading(info: Pick<ReadingInfo, 'decimals' | 'unit'>, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'ND'
  const text = value.toFixed(info.decimals).replace('-', '−')
  return info.unit ? `${text} ${info.unit}` : text
}

/** 툴팁 글자: 설명 + 근거(설명서 판) + 확인 필요 메모 */
export function readingTooltip(info: ReadingInfo): string {
  const src = info.manuals.length ? `근거: MXU 설명서 ${info.manuals.join('·')}` : '근거: 공개 정의 없음'
  const name = info.labelBasis === 'capture' ? '' : ' · 화면 이름은 캡처 확인 전'
  return [`${info.label} — ${info.description}`, `${src}${name}`, info.note ? `확인 필요: ${info.note}` : null].filter((s): s is string => s !== null).join('\n')
}

/**
 * 게이트 측정값 이름을 게이트 설정에 맞춘다 (L5, 설명서 기호 규칙 — 3_웹문서.md 2.1):
 *   - 위치 기준이 문턱 교차(event 'edge')면 끝의 '^' → '/'  (예 DA^ → DA/)
 *   - 봉우리 고르기가 첫 봉우리(detection 'first')면 끝에 '1'  (예 DA^1, A%1)
 * 우리 데이터 파일은 모두 최대 봉우리·봉우리 기준이라 이름이 그대로다. 바뀌었으면 changed = true (화면에 '대조 전' 을 붙인다)
 */
export function gateReadingLabel(label: string, gate: Pick<ViewerGate, 'detection' | 'event'> | null | undefined): { label: string; changed: boolean } {
  if (!gate) return { label, changed: false }
  const positional = label.endsWith('^')
  const amplitude = /^[ABI]%$/.test(label)
  if (!positional && !amplitude) return { label, changed: false }
  let out = positional && gate.event === 'edge' ? `${label.slice(0, -1)}/` : label
  if (gate.detection === 'first') out += '1'
  return { label: out, changed: out !== label }
}
