import { describe, expect, it } from 'vitest'
import { POST_RULES_VERSION } from '@shared/imaging/postprocess'
import {
  CONFIDENCE,
  GEOMETRIC_IMPERFECTION_ISO,
  ISO_6520_1,
  LABEL_CODE_TABLES,
  LABEL_COLUMNS,
  LABEL_COORD_RULES_VERSION,
  LABEL_ENTITY_FIELDS,
  LABEL_EXPORT_FIELDS,
  LABEL_SCHEMA_VERSION,
  LABEL_SHEETS,
  MAX_MESSAGES,
  METALLURGICAL_TYPE,
  METALLURGICAL_TYPE_INFO,
  PROPOSAL_DEFECT_CLASS,
  WELD_SIDE,
  WELD_ZONE_TO_PROPOSAL,
  boolFromCell,
  codeFromCell,
  codesOf,
  columnId,
  columnsOf,
  defaultCharacterOf,
  enumCodeFromCell,
  fieldAt,
  findColumnByHeader,
  isPathRequired,
  isoCodeOf,
  isoLabel,
  labelSetId,
  newFileAlignment,
  newIndicationRecord,
  newLabelExport,
  newObservationRow,
  newPhysicalDefect,
  newReviewInterval,
  newWorkEvent,
  normalizeCell,
  parseLabelExport,
  parseLabelExportJson,
  sameLabelSet,
  serializeLabelExport,
  truthTierOfSource,
  validateIndicationRecord,
  validatePhysicalDefect,
  validateReviewInterval,
  isIsoDateTime,
  HEIGHT_METHOD_IN_SPEC,
  type AnyCheck,
  type AnyFields,
  type IndicationRecord,
  type LabelExportFile,
  type MetallurgicalType
} from '@shared/labels'

// ───────────────────────────── 시료 ─────────────────────────────

const SHA_A = 'a3f1'.repeat(16)
const SHA_B = '0b9e'.repeat(16)
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const T0 = '2026-10-20T14:05:00+09:00'

/** 모든 저장 단위와 기록 구분을 하나씩 담은 내보내기 파일 (경고가 나오지 않게 맞춘 값) */
function sampleExport(): LabelExportFile {
  // 앱에서 찍은 결함: 앵커 + 상하 팁 높이 + 제안 기록
  const anchored = newIndicationRecord({
    uuid: uuid(1),
    sha256: SHA_A,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    pcId: 'pc-lab',
    createdAt: T0,
    updatedAt: T0,
    revision: 3,
    versions: [
      { pcId: 'pc-home', edits: 1 },
      { pcId: 'pc-lab', edits: 2 }
    ],
    anchors: [
      {
        id: 'p1',
        role: 'peak',
        anchor: { groupId: 0, scanIndex: 135.4, beam: 12.25, sample: 410.5, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: true },
        leg: 2,
        displayGainDb: 0,
        mm: { scanMm: 135.4, vMm: -3.2, depthMm: 7.1 }
      },
      {
        id: 'p2',
        role: 'tip-top',
        anchor: { groupId: 0, scanIndex: 135, beam: 11.6, sample: 395.0, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: true },
        leg: 2,
        displayGainDb: 6,
        mm: { scanMm: 135, vMm: -3.6, depthMm: 6.2 }
      },
      {
        id: 'p3',
        role: 'tip-bottom',
        anchor: { groupId: 0, scanIndex: 135, beam: 12.9, sample: 428.0, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: true },
        leg: 2,
        displayGainDb: 6,
        mm: { scanMm: 135, vMm: -2.9, depthMm: 8.4 }
      }
    ],
    derived: { scanStartMm: 120, scanEndMm: 148, vMinMm: -3.6, vMaxMm: -2.9, depthTopMm: 6.2, depthBottomMm: 8.4 },
    defectType: 'lof-sidewall',
    isoCode: '4011',
    typeConfidence: 'probable',
    character: { value: 'planar' },
    surface: 'embedded',
    location: { zone: 'sidewall', side: 'L' },
    length: { valueMm: 28, method: 'eval-level', groupId: 0, beam: 12 },
    height: { method: 'tip-tip', valueMm: 2.2, pointIds: ['p2', 'p3'] },
    signal: {
      maxAmplitudePct: 200,
      refDb: 1.9,
      refDbVerified: false,
      saturated: true,
      exceedsEvaluationLevel: true,
      exceedsRecordingLevel: true,
      peak: { groupId: 0, beam: 12.25, angleDeg: 58.5, scanMm: 135.4, depthMm: 7.1 }
    },
    suggestions: [
      {
        target: 'length',
        rule: 'eval-level',
        ruleDb: -14,
        suggestedMm: 26.5,
        finalMm: 28,
        acceptedUnchanged: false,
        correctionMm: 1.5,
        shownAfterExpert: true
      }
    ],
    knowledge: { designValueSeen: false, specimenKnown: true, aiDevParticipant: false },
    physicalDefectId: 'D2',
    groupingId: 'g-1',
    viewSnapshot: { gainDb: 6, gate: { startMm: 7, lengthMm: 14 }, palette: [0, 100] },
    note: '측벽 융합불량. Skew 270 에서 포화'
  })

  // 엑셀에서 가져온 결함: 앵커 없이 mm 만
  const imported = newIndicationRecord({
    uuid: uuid(2),
    sha256: SHA_A,
    labelerId: 'lee',
    guidelineVersion: 'v1',
    externalRef: '4',
    derived: { scanStartMm: 239, scanEndMm: 268, depthTopMm: 5.5, depthBottomMm: 7 },
    defectType: 'slag',
    isoCode: '301',
    typeConfidence: 'certain',
    character: { value: 'volumetric' },
    surface: 'embedded',
    pointLike: true,
    location: { zone: 'body' },
    signal: { maxAmplitudePct: 48.5, refDb: -10.3, refDbVerified: true, saturated: false },
    existenceConfidence: 'probable'
  })

  // 형상 에코 (루트)
  const echo = newIndicationRecord({
    uuid: uuid(3),
    sha256: SHA_A,
    labelerId: 'kim',
    guidelineVersion: 'v1',
    kind: 'geometric-echo',
    derived: { scanStartMm: 0, scanEndMm: 300 },
    geometricEcho: { kind: 'root', fromSuggestion: true }
  })

  // 형상 불완전 (언더컷), 전문기관 판독
  const imperfection = newIndicationRecord({
    uuid: uuid(4),
    sha256: SHA_B,
    labelerId: 'agency-1',
    guidelineVersion: 'v1',
    readerSource: 'agency',
    readerDetail: { organization: '전문기관 A', qualification: 'UT Level II' },
    kind: 'geometric-imperfection',
    derived: { scanStartMm: 40, scanEndMm: 52 },
    geometricImperfection: { kind: 'undercut' }
  })

  // 일렬 체적 → 면상
  const aligned = newIndicationRecord({
    uuid: uuid(5),
    sha256: SHA_B,
    labelerId: 'lee',
    guidelineVersion: 'v1',
    derived: { scanStartMm: 191, scanEndMm: 230 },
    defectType: 'porosity-cluster',
    isoCode: '2013',
    character: { value: 'planar', alignedVolumetric: true, expertConfirmed: true },
    length: { valueMm: 39, method: '6db-curvature', uncorrectedMm: 41.2 },
    height: { method: 'unmeasurable' }
  })

  return newLabelExport(
    { appVersion: '0.1.0', exportedAt: T0, pcId: 'pc-lab' },
    {
      labelers: [
        { id: 'kim', name: '김 전문가', qualification: 'UT Level III', organization: null },
        { id: 'lee', name: '이 전문가', qualification: 'UT Level II', organization: null },
        { id: 'agency-1', name: '전문기관 판독자', qualification: 'UT Level II', organization: '전문기관 A' }
      ],
      physicalDefects: [
        newPhysicalDefect({
          id: 'D2',
          specimenId: 'TP03',
          design: { type: 'lof-sidewall', zone: 'sidewall', side: 'L', centerMm: 135, lengthMm: 25, heightMm: 2 },
          source: 'pcn-sheet',
          confirmation: 'design-only',
          note: '00_결함정보.docx 위치 135 (중심 추정)'
        }),
        newPhysicalDefect({
          id: 'S1',
          specimenId: 'TP03',
          source: 'none',
          confirmation: 'unknown',
          dataOrigin: 'synthetic',
          parentId: 'D2',
          generatorTool: 'civa',
          generatorVersion: '2025'
        })
      ],
      fileAlignments: [
        newFileAlignment({
          sha256: SHA_A,
          fileName: '12T-SV-01-Cap on.nde',
          specimenId: 'TP03',
          datumKind: 'plate-edge',
          datumUMm: 0,
          direction: 1,
          skew90Side: 'L',
          thicknessMm: 12,
          enteredBy: 'kim'
        }),
        newFileAlignment({
          sha256: SHA_B,
          fileName: '관 시편.nde',
          datumKind: 'pipe-12-oclock',
          direction: -1,
          thicknessMm: 6.4,
          outerDiameterMm: 558.8,
          overlapStartMm: 1755,
          overlapEndMm: 1790
        })
      ],
      records: [anchored, imported, echo, imperfection, aligned],
      observations: [
        newObservationRow({
          recordUuid: uuid(1),
          groupId: 0,
          leg: 2,
          projected: { scanStartMm: 120, scanEndMm: 148, beamMin: 9, beamMax: 15, sampleMin: 380, sampleMax: 440 },
          search: { maxAmplitudePct: 200, beam: 12, scanMm: 135, scanStartMm: 118, scanEndMm: 150 },
          saturated: true,
          status: 'visible',
          expertConfirmed: true
        }),
        newObservationRow({ recordUuid: uuid(1), groupId: 1, leg: 1, status: 'weak', saturated: false })
      ],
      reviewIntervals: [
        newReviewInterval({
          uuid: uuid(11),
          sha256: SHA_A,
          labelerId: 'kim',
          guidelineVersion: 'v1',
          kind: 'reviewed',
          groupId: 0,
          scanStartMm: 0,
          scanEndMm: 300,
          gate: { depthTopMm: 0, depthBottomMm: 12, legMin: 1, legMax: 2 }
        }),
        newReviewInterval({
          uuid: uuid(12),
          sha256: SHA_A,
          labelerId: 'kim',
          guidelineVersion: 'v1',
          kind: 'quality-bad',
          scanStartMm: 280,
          scanEndMm: 300,
          reason: 'coupling'
        }),
        newReviewInterval({
          uuid: uuid(13),
          sha256: SHA_A,
          labelerId: 'kim',
          guidelineVersion: 'v1',
          kind: 'below-threshold',
          groupId: 1,
          scanStartMm: 89,
          scanEndMm: 92
        })
      ],
      workEvents: [
        newWorkEvent({ uuid: uuid(21), sessionId: 's-1', labelerId: 'kim', kind: 'file-open', tool: 'omnipc', sha256: SHA_A, at: T0 }),
        newWorkEvent({
          uuid: uuid(22),
          sessionId: 's-1',
          labelerId: 'kim',
          kind: 'report',
          tool: 'omnipc',
          sha256: SHA_A,
          at: '2026-10-20T15:30:00+09:00',
          detail: { minutes: 12 }
        }),
        newWorkEvent({ uuid: uuid(23), sessionId: 's-1', labelerId: 'kim', kind: 'session-end', at: '2026-10-20T06:31:00Z' })
      ]
    }
  )
}

const HANGUL = /[가-힣]/

function expectKorean(msgs: readonly string[]): void {
  for (const m of msgs) expect(m, m).toMatch(HANGUL)
}

/** 파일을 고쳐 다시 검사 (JSON 왕복한 사본을 고친다) */
function parseWith(mutate: (f: Record<string, unknown> & { records: Record<string, unknown>[] }) => void) {
  const f = JSON.parse(serializeLabelExport(sampleExport())) as Record<string, unknown> & { records: Record<string, unknown>[] }
  mutate(f)
  return parseLabelExport(f)
}

function rec(f: { records: Record<string, unknown>[] }, i: number): Record<string, unknown> {
  const r = f.records[i]
  if (!r) throw new Error(`no record ${i}`)
  return r
}

// ───────────────────────────── 왕복 ─────────────────────────────

describe('왕복 (만들기 → JSON → 가져오기)', () => {
  it('모든 저장 단위가 그대로 돌아오고 오류·경고가 없다', () => {
    const file = sampleExport()
    const r = parseLabelExportJson(serializeLabelExport(file))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.value).toEqual(file)
  })

  it('다시 내보내면 바이트가 같다 (같은 파일을 다시 가져와도 결과가 같음)', () => {
    const text = serializeLabelExport(sampleExport())
    const once = parseLabelExportJson(text)
    expect(once.ok).toBe(true)
    const again = serializeLabelExport(once.value!)
    expect(again).toBe(text)
    expect(serializeLabelExport(parseLabelExportJson(again).value!)).toBe(text)
  })

  it('가져온 값은 입력과 다른 사본이다', () => {
    const input = JSON.parse(serializeLabelExport(sampleExport())) as LabelExportFile
    const r = parseLabelExport(input)
    expect(r.value).not.toBe(input)
    expect(r.value!.records).not.toBe(input.records)
    ;(r.value!.records[0]!.signal as { maxAmplitudePct: number }).maxAmplitudePct = 1
    expect(input.records[0]!.signal.maxAmplitudePct).toBe(200)
  })

  it('헤더는 지금 버전 상수를 쓴다', () => {
    const f = sampleExport()
    expect(f.format).toBe('paut-labels')
    expect(f.schemaVersion).toBe(LABEL_SCHEMA_VERSION)
    expect(f.rulesVersion).toBe(LABEL_COORD_RULES_VERSION)
  })

  it('좌표 규칙 버전은 imaging 의 POST_RULES_VERSION 을 그대로 쓴다', () => {
    expect(LABEL_COORD_RULES_VERSION).toBe(POST_RULES_VERSION)
  })

  it('레코드별 검사도 같은 기록을 통과시킨다', () => {
    for (const r of sampleExport().records) {
      const v = validateIndicationRecord(r)
      expect(v.errors, r.uuid).toEqual([])
      expect(v.warnings, r.uuid).toEqual([])
      expect(v.value).toEqual(r)
    }
  })
})

// ───────────────────────────── 모르는 칸 보존 ─────────────────────────────

describe('모르는 칸 보존', () => {
  it('최상위·기록·묶음·목록 원소의 모르는 칸을 버리지 않고 경고만 한다', () => {
    const r = parseWith((f) => {
      f['futureHeader'] = { by: 'v1.1' }
      const r0 = rec(f, 0)
      r0['aiScore'] = 0.87
      ;(r0['signal'] as Record<string, unknown>)['echoDynamic'] = 'II'
      ;((r0['anchors'] as Record<string, unknown>[])[0] as Record<string, unknown>)['pressure'] = [1, 2, { k: null }]
      rec(f, 1)['aiScore'] = 0.12
    })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
    const v = r.value as unknown as Record<string, unknown> & { records: Record<string, unknown>[] }
    expect(v['futureHeader']).toEqual({ by: 'v1.1' })
    expect(rec(v, 0)['aiScore']).toBe(0.87)
    expect((rec(v, 0)['signal'] as Record<string, unknown>)['echoDynamic']).toBe('II')
    expect(((rec(v, 0)['anchors'] as Record<string, unknown>[])[0] as Record<string, unknown>)['pressure']).toEqual([1, 2, { k: null }])
    expect(r.warnings).toContain('모르는 칸을 그대로 보존합니다: records[].aiScore (2곳)')
    expect(r.warnings).toContain('모르는 칸을 그대로 보존합니다: futureHeader (1곳)')
    expect(r.warnings).toContain('모르는 칸을 그대로 보존합니다: records[].signal.echoDynamic (1곳)')
    expectKorean(r.warnings)
    // 다시 내보내도 남는다
    const again = parseLabelExportJson(serializeLabelExport(r.value!))
    expect((again.value as unknown as Record<string, unknown>)['futureHeader']).toEqual({ by: 'v1.1' })
  })

  it("'__proto__' 같은 칸 이름도 프로토타입을 건드리지 않고 보존한다", () => {
    const text = serializeLabelExport(sampleExport()).replace('"format"', '"__proto__": {"polluted": true},\n  "format"')
    const r = parseLabelExportJson(text)
    expect(r.ok).toBe(true)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype)
    expect(Object.hasOwn(r.value!, '__proto__')).toBe(true)
  })

  it('빠진 선택 칸은 null 로 채우고 경고한다. 빠진 필수 칸은 오류다', () => {
    const r = parseWith((f) => {
      delete rec(f, 1)['surface']
      delete (rec(f, 1)['signal'] as Record<string, unknown>)['peak']
    })
    expect(r.ok).toBe(true)
    expect(r.value!.records[1]!.surface).toBeNull()
    expect(r.value!.records[1]!.signal.peak).toBeNull()
    expect(r.warnings).toContain('빠진 선택 칸을 빈 값(null)으로 채웠습니다: records[].surface (1곳)')

    const bad = parseWith((f) => {
      delete rec(f, 1)['existenceConfidence']
    })
    expect(bad.ok).toBe(false)
    expect(bad.value).toBeNull()
    expect(bad.errors).toEqual(['지시 기록 2번째 › 존재 확신도: 칸이 없습니다 [records[1].existenceConfidence]'])
  })
})

// ───────────────────────────── 잘못된 값 ─────────────────────────────

describe('잘못된 값은 한국어 오류', () => {
  it('UUID·sha256·유한수·열거값·글자·참거짓', () => {
    const r = parseWith((f) => {
      rec(f, 0)['uuid'] = 'not-a-uuid'
      rec(f, 1)['uuid'] = 'ABCDEF00-0000-4000-8000-00000000000B'
      rec(f, 1)['sha256'] = SHA_A.toUpperCase()
      rec(f, 2)['sha256'] = 'abc'
      ;(rec(f, 0)['signal'] as Record<string, unknown>)['maxAmplitudePct'] = '200'
      ;(rec(f, 0)['derived'] as Record<string, unknown>)['scanStartMm'] = null
      rec(f, 1)['defectType'] = 'crack'
      rec(f, 1)['deleted'] = 'false'
      rec(f, 2)['labelerId'] = '  '
      rec(f, 3)['revision'] = 0
      ;(rec(f, 4)['length'] as Record<string, unknown>)['valueMm'] = -1
      rec(f, 4)['anchors'] = {}
      f['exportedAt'] = '2026-10-20 14:05'
    })
    expect(r.ok).toBe(false)
    expect(r.value).toBeNull()
    expectKorean(r.errors)
    const has = (s: string): void => {
      expect(
        r.errors.some((e) => e.includes(s)),
        `${s}\n${r.errors.join('\n')}`
      ).toBe(true)
    }
    has('지시 기록 1번째 › 기록 UUID: UUID 형식(소문자 8-4-4-4-12)이 아닙니다 (받은 값: "not-a-uuid") [records[0].uuid]')
    has('[records[1].uuid]')
    has('지시 기록 2번째 › 원본 SHA-256: SHA-256(소문자 16진수 64자)이 아닙니다')
    has('[records[2].sha256]')
    has('지시 기록 1번째 › 신호 › 최대 진폭 (%FSH): 유한한 숫자여야 합니다 (받은 값: "200") [records[0].signal.maxAmplitudePct]')
    has('지시 기록 1번째 › 파생 위치 › 스캔 시작 (mm): 비어 있으면 안 됩니다')
    has('지시 기록 2번째 › 결함 종류: 정해진 값이 아닙니다 (받은 값: "crack", 쓸 수 있는 값: crack-root,')
    has('지시 기록 2번째 › 삭제 표시: 참/거짓(true/false)이어야 합니다')
    has('지시 기록 3번째 › 라벨러 ID: 비어 있으면 안 됩니다')
    has('지시 기록 4번째 › revision: 1 이상이어야 합니다 (받은 값: 0)')
    has('지시 기록 5번째 › 길이 › 길이 (mm): 0 이상이어야 합니다 (받은 값: -1)')
    has('지시 기록 5번째 › 앵커 점: 목록이어야 합니다')
    has('내보낸 시각: 시각은 시간대가 붙은 ISO 8601 이어야 합니다')
  })

  it('JSON 이 아닌 수(NaN·Infinity)와 저장할 수 없는 값', () => {
    const f = sampleExport()
    const r0 = f.records[0]!
    r0.derived.depthTopMm = Number.NaN
    r0.signal.refDb = Number.POSITIVE_INFINITY
    r0.viewSnapshot = { fn: () => 1 }
    const r = parseLabelExport(f)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('지시 기록 1번째 › 파생 위치 › 실제 깊이 위 (mm): 유한한 숫자여야 합니다 (받은 값: null) [records[0].derived.depthTopMm]')
    expect(r.errors.some((e) => e.includes('[records[0].signal.refDb]'))).toBe(true)
    expect(r.errors.some((e) => e.includes('JSON 으로 저장할 수 없는 값입니다 (function)'))).toBe(true)
    expectKorean(r.errors)
  })

  it('서로 모순되는 칸', () => {
    const r = parseWith((f) => {
      const r0 = rec(f, 0)
      ;(r0['height'] as Record<string, unknown>)['pointIds'] = ['p2', 'p9']
      ;(r0['suggestions'] as Record<string, unknown>[])[0]!['acceptedUnchanged'] = true
      r0['geometricEcho'] = { kind: 'root', fromSuggestion: false }
      const r1 = rec(f, 1)
      ;(r1['derived'] as Record<string, unknown>)['scanStartMm'] = 300
      r1['anchors'] = [
        {
          id: 'q',
          role: 'peak',
          anchor: { groupId: 0, scanIndex: 1, beam: 1, sample: 1, coordRulesVersion: 1, groupVerified: true },
          leg: null,
          displayGainDb: null,
          mm: null
        }
      ]
      rec(f, 2)['geometricEcho'] = null
      rec(f, 3)['defectType'] = 'slag'
      ;(rec(f, 4)['height'] as Record<string, unknown>)['valueMm'] = 2
      rec(f, 0)['coordSource'] = 'app-anchor'
      ;(f['reviewIntervals'] as Record<string, unknown>[])[1]!['reason'] = null
      ;(f['reviewIntervals'] as Record<string, unknown>[])[2]!['reason'] = 'noise'
    })
    expect(r.ok).toBe(false)
    expectKorean(r.errors)
    const expected = [
      "지시 기록 1번째 › 높이: 높이 점 'p9' 가 앵커 점에 없습니다 [records[0].height]",
      '지시 기록 1번째 › 제안 기록 1번째: 고치지 않고 수락했는데 수정량이 1.5 mm 입니다 [records[0].suggestions[0]]',
      '지시 기록 1번째: 결함 기록에는 형상 에코·형상 불완전 세부를 넣지 않습니다 [records[0]]',
      '지시 기록 2번째 › 앵커 점: 가져온 mm 기록(imported-mm)에는 앵커 점이 없어야 합니다 [records[1].anchors]',
      '지시 기록 2번째 › 파생 위치: 스캔 범위: 시작(300)이 끝(268)보다 큽니다 [records[1].derived]',
      '지시 기록 3번째: 형상 에코 기록에는 형상 에코 세부(루트·캡·모드 변환·기타)가 있어야 합니다 [records[2]]',
      '지시 기록 4번째: 형상 에코·형상 불완전 기록에는 결함 종류를 넣지 않습니다 [records[3]]',
      "지시 기록 5번째 › 높이: '측정 불가'인데 높이 값이 있습니다 [records[4].height]",
      '검토 구간 2번째: 품질 불량 구간에는 사유(커플링·누락·포화·잡음·시간 범위·감도)가 있어야 합니다 [reviewIntervals[1]]',
      '검토 구간 3번째: 품질 불량 사유는 품질 불량 구간에만 씁니다 [reviewIntervals[2]]'
    ]
    for (const e of expected) expect(r.errors, r.errors.join('\n')).toContain(e)
  })

  it('앱에서 찍은 기록에 앵커가 없으면 오류', () => {
    const r = validateIndicationRecord({ ...sampleExport().records[1]!, coordSource: 'app-anchor' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('앵커 점: 앱에서 찍은 기록(app-anchor)에 앵커 점이 없습니다 [anchors]')
  })

  it('확인할 것은 경고로 (오류 아님)', () => {
    const r = parseWith((f) => {
      const r0 = rec(f, 0)
      ;(r0['signal'] as Record<string, unknown>)['saturated'] = false
      r0['defectType'] = 'slag'
      r0['readerSource'] = 'ai'
      ;(r0['anchors'] as { anchor: { coordRulesVersion: number } }[])[0]!.anchor.coordRulesVersion = LABEL_COORD_RULES_VERSION + 1
      rec(f, 1)['defectType'] = null
      ;(f['reviewIntervals'] as Record<string, unknown>[])[0]!['gate'] = null
      f['rulesVersion'] = LABEL_COORD_RULES_VERSION + 1
      ;(f['observations'] as Record<string, unknown>[])[1]!['recordUuid'] = uuid(99)
      ;(f['records'] as unknown[]).push(JSON.parse(JSON.stringify(rec(f, 2))))
    })
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
    expectKorean(r.warnings)
    const has = (s: string): void => {
      expect(
        r.warnings.some((w) => w.includes(s)),
        `${s}\n${r.warnings.join('\n')}`
      ).toBe(true)
    }
    has('포화가 아니라고 되어 있습니다')
    has('판정 특성이 종류 기본값(체적)과 다릅니다')
    has('AI 판독 기록에 모델 버전이 없습니다')
    has('이 앱보다 새 좌표 규칙')
    has("결함 종류가 비어 있습니다 (모르면 '면상 추정'·'체적 추정')")
    has('검토 완료 구간에 게이트 깊이·레그 범위가 없습니다')
    has('내보낸 PC 의 좌표 규칙')
    has('관측 표 1행이 이 파일에 없는 기록을 가리킵니다')
    has(`같은 UUID 의 지시 기록 ${uuid(3)} 가 2개 있습니다 (충돌로 함께 보관)`)
  })

  it('오류가 많아도 상한까지만 적고 나머지는 개수로', () => {
    const f = JSON.parse(serializeLabelExport(sampleExport())) as { records: unknown[] }
    f.records = Array.from({ length: 300 }, () => ({}))
    const r = parseLabelExport(f)
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBe(MAX_MESSAGES + 1)
    expect(r.errors.at(-1)).toMatch(/^… 오류 \d+건 더 있습니다\.$/)
  })

  it('객체가 아니거나 JSON 이 깨진 경우', () => {
    expect(parseLabelExport([]).errors[0]).toMatch(/^라벨 파일이 JSON 객체가 아닙니다/)
    expect(parseLabelExport(null).ok).toBe(false)
    const broken = parseLabelExportJson('{"format": "paut-labels",')
    expect(broken.ok).toBe(false)
    expect(broken.errors[0]).toMatch(/^JSON 으로 읽을 수 없습니다/)
    expect(validateReviewInterval('x').errors[0]).toMatch(/^검토 구간: 객체가 아닙니다/)
  })
})

// ───────────────────────────── 버전 ─────────────────────────────

describe('스키마 버전', () => {
  it('더 새 schemaVersion 은 다른 칸을 보지 않고 거부한다', () => {
    const r = parseLabelExport({ format: 'paut-labels', schemaVersion: LABEL_SCHEMA_VERSION + 1, records: 'whatever' })
    expect(r.ok).toBe(false)
    expect(r.value).toBeNull()
    expect(r.errors).toEqual([
      `이 파일은 라벨 형식 v${LABEL_SCHEMA_VERSION + 1} 입니다. 이 앱은 v${LABEL_SCHEMA_VERSION} 까지만 읽습니다. 앱을 새 버전으로 올린 뒤 가져오세요.`
    ])
  })

  it('형식 이름이 다르거나 버전이 숫자가 아니면 거부', () => {
    expect(parseLabelExport({ format: 'coco', schemaVersion: 1 }).errors[0]).toMatch(/^PAUT 라벨 파일이 아닙니다/)
    expect(parseLabelExport({ format: 'paut-labels', schemaVersion: '1' }).errors[0]).toMatch(/^스키마 버전이 올바르지 않습니다/)
    expect(parseLabelExport({ format: 'paut-labels', schemaVersion: 0 }).ok).toBe(false)
    expect(parseLabelExport({ format: 'paut-labels', schemaVersion: 1.5 }).ok).toBe(false)
  })
})

// ───────────────────────────── 엑셀 양식 칸 ─────────────────────────────

/** 칸 정의 안의 모든 열거값 검사 */
function* enumChecks(fields: AnyFields): Generator<{ table: string; codes: readonly string[] }> {
  for (const f of Object.values(fields)) yield* enumChecksOf(f.check)
}
function* enumChecksOf(c: AnyCheck): Generator<{ table: string; codes: readonly string[] }> {
  if (c.t === 'enum') yield c
  else if (c.t === 'array') yield* enumChecksOf(c.of)
  else if (c.t === 'object') yield* enumChecks(c.fields)
}

const FORMAT_OF_CHECK: Record<string, string> = {
  number: 'number',
  'one-of': 'number',
  string: 'text',
  enum: 'enum',
  bool: 'bool',
  'iso-datetime': 'time'
}

describe('엑셀 양식 칸 (columns.ts)', () => {
  it('시트마다 key·머리글이 겹치지 않고, 전체 칸 이름도 유일하다', () => {
    expect(new Set(LABEL_SHEETS.map((s) => s.id)).size).toBe(LABEL_SHEETS.length)
    expect(new Set(LABEL_SHEETS.map((s) => s.name)).size).toBe(LABEL_SHEETS.length)
    expect(LABEL_SHEETS.map((s) => s.name)).toEqual(['판독자', '파일', '지시', '검토구간', '물리결함', '작업시간'])
    for (const s of LABEL_SHEETS) {
      const cols = columnsOf(s.id)
      expect(cols.length, s.name).toBeGreaterThan(0)
      expect(new Set(cols.map((c) => c.key)).size, s.name).toBe(cols.length)
      expect(new Set(cols.map((c) => c.header)).size, s.name).toBe(cols.length)
      expect(new Set(cols.map((c) => normalizeCell(c.header))).size, s.name).toBe(cols.length)
      // 첫 칸은 파일명 또는 시편 ID (사람이 줄을 찾는 칸)
      expect(['fileName', 'specimenId', 'labelerId']).toContain(cols[0]!.key)
    }
    expect(new Set(LABEL_COLUMNS.map(columnId)).size).toBe(LABEL_COLUMNS.length)
  })

  it('칸마다 한국어 머리글·도움말 한 줄이 있다', () => {
    for (const c of LABEL_COLUMNS) {
      expect(c.header.trim(), columnId(c)).not.toBe('')
      expect(c.help, columnId(c)).toMatch(HANGUL)
      expect(c.help, columnId(c)).not.toMatch(/\n/)
    }
  })

  it('지시 시트는 계획의 칸을 모두 갖는다', () => {
    const keys = columnsOf('indication').map((c) => c.key)
    for (const k of [
      'fileName',
      'group',
      'scanStartMm',
      'scanEndMm',
      'peakScanMm',
      'peakAngleDeg',
      'peakDepthMm',
      'vMinMm',
      'vMaxMm',
      'depthTopMm',
      'depthBottomMm',
      'maxAmplitudePct',
      'refDb',
      'saturated',
      'defectType',
      'character',
      'surface',
      'zone',
      'side',
      'lengthMm',
      'lengthMethod',
      'heightMethod',
      'heightMm',
      'existenceConfidence',
      'typeConfidence',
      'designValueSeen',
      'physicalDefectId',
      'note'
    ]) {
      expect(keys).toContain(k)
    }
    expect(columnsOf('worktime').map((c) => c.key)).toEqual(
      expect.arrayContaining(['fileName', 'startedAt', 'endedAt', 'reportMinutes'])
    )
  })

  it('모든 enum 칸이 codes.ts 표와 맞고, 스키마 칸의 열거값과도 같다', () => {
    for (const c of LABEL_COLUMNS) {
      const id = columnId(c)
      expect(c.format === 'enum', id).toBe(c.enumTable !== null)
      if (c.enumTable === null) {
        expect(c.enumValues, id).toEqual([])
        continue
      }
      const table = LABEL_CODE_TABLES[c.enumTable] as Readonly<Record<string, string>>
      expect(c.enumValues, id).toEqual(codesOf(table).map((code) => ({ code, label: table[code] })))
      if (!c.target) continue
      const f = fieldAt(c.target.entity, c.target.path)!
      if (c.target.via === 'signed-unit') {
        expect(f.check.t, id).toBe('one-of')
        const values = (f.check as { values: readonly number[] }).values
        expect(c.enumValues.map((v) => Number(v.code)).sort(), id).toEqual([...values].sort())
      } else if (c.target.via === undefined || c.target.via === 'event-tool') {
        expect(f.check, id).toMatchObject({ t: 'enum', table: c.enumTable })
        expect((f.check as { codes: readonly string[] }).codes, id).toEqual(codesOf(table))
      }
    }
  })

  it('칸 정의의 열거값은 이름 붙은 표와 코드가 같다', () => {
    const all = [...enumChecks(LABEL_EXPORT_FIELDS as unknown as AnyFields)]
    expect(all.length).toBeGreaterThan(20)
    for (const e of all) {
      const table = LABEL_CODE_TABLES[e.table as keyof typeof LABEL_CODE_TABLES]
      expect(table, e.table).toBeDefined()
      expect(e.codes, e.table).toEqual(codesOf(table as Readonly<Record<string, string>>))
    }
  })

  it('필수 칸이 스키마의 필수 칸과 맞다', () => {
    for (const c of LABEL_COLUMNS) {
      const id = columnId(c)
      if (!c.target) {
        expect(c.required, id).toBe(false)
        continue
      }
      const f = fieldAt(c.target.entity, c.target.path)
      expect(f, `${id} → ${c.target.entity}.${c.target.path}`).not.toBeNull()
      if (c.target.via !== undefined) continue
      const requiredInSchema = isPathRequired(c.target.entity, c.target.path)
      const mustFill = requiredInSchema && c.emptyValue === undefined && !c.appFilled
      expect(c.required, `${id}: 스키마 필수 ${requiredInSchema}, 기본값 ${String(c.emptyValue)}, 앱 채움 ${String(c.appFilled)}`).toBe(
        mustFill
      )
    }
    // 바꿔 넣는 칸 중 필수인 것: 라벨러 ID·판독 단계(→ 모든 줄), 파일명(→ sha256), 작업 시작·끝(→ 이벤트 시각)
    const requiredVia = LABEL_COLUMNS.filter((c) => c.target?.via !== undefined && c.required).map(columnId)
    expect(requiredVia.sort()).toEqual(
      [
        'reader.labelerId',
        'reader.readingStage',
        'indication.fileName',
        'review.fileName',
        'worktime.fileName',
        'worktime.startedAt',
        'worktime.endedAt'
      ].sort()
    )
    for (const id of requiredVia) {
      const c = LABEL_COLUMNS.find((x) => columnId(x) === id)!
      expect(isPathRequired(c.target!.entity, c.target!.path) || c.target!.path === 'sha256', id).toBe(true)
    }
  })

  it('칸 형식이 스키마 칸의 검사와 맞고, 빈 칸 기본값은 그 칸에 들어갈 수 있다', () => {
    for (const c of LABEL_COLUMNS) {
      if (!c.target || c.target.via !== undefined) continue
      const id = columnId(c)
      const f = fieldAt(c.target.entity, c.target.path)!
      let t = f.check.t as string
      if (t === 'uuid' || t === 'sha256' || t === 'iso6520') t = 'string'
      expect(FORMAT_OF_CHECK[t], id).toBe(c.format)
      if (c.emptyValue !== undefined) {
        if (f.check.t === 'enum') expect(f.check.codes, id).toContain(c.emptyValue)
        if (f.check.t === 'bool') expect(typeof c.emptyValue, id).toBe('boolean')
        if (f.check.t === 'string') expect(typeof c.emptyValue, id).toBe('string')
      }
    }
  })

  it('머리글·열거값 글자로 칸과 코드를 찾는다', () => {
    expect(findColumnByHeader('indication', ' 스캔  시작(mm) ')?.key).toBe('scanStartMm')
    expect(findColumnByHeader('indication', '없는 칸')).toBeNull()
    const side = findColumnByHeader('indication', '좌우')!
    expect(enumCodeFromCell(side, '왼쪽 (L)')).toBe('L')
    expect(enumCodeFromCell(side, '왼쪽')).toBe('L')
    expect(enumCodeFromCell(side, 'r')).toBe('R')
    const type = findColumnByHeader('indication', '결함 종류')!
    expect(enumCodeFromCell(type, '융합불량 (측벽)')).toBe('lof-sidewall')
    expect(enumCodeFromCell(type, '균열')).toBeNull() // 넷 중 무엇인지 모름
    expect(enumCodeFromCell(type, '면상 추정')).toBe('planar-presumed')
    const h = findColumnByHeader('indication', '높이 입력 방식')!
    expect(enumCodeFromCell(h, '-6 dB 높이')).toBe('6db')
    expect(enumCodeFromCell(h, '−6dB높이')).toBe('6db')
    expect(enumCodeFromCell(h, '노정 시간')).toBe('transit-time')
    expect(enumCodeFromCell(findColumnByHeader('indication', '메모')!, '확실')).toBeNull()
    expect(boolFromCell('예')).toBe(true)
    expect(boolFromCell(' 아니오 ')).toBe(false)
    expect(boolFromCell('TRUE')).toBe(true)
    expect(boolFromCell('')).toBeNull()
    expect(boolFromCell('글쎄')).toBeNull()
  })

  it('모든 표의 표시 이름이 서로 겹치지 않아 글자 → 코드가 한 가지로 정해진다', () => {
    for (const [name, raw] of Object.entries(LABEL_CODE_TABLES)) {
      const table = raw as Readonly<Record<string, string>>
      const codes = codesOf(table)
      const keys = new Set<string>()
      for (const code of codes) {
        for (const k of new Set([normalizeCell(code), normalizeCell(table[code]!)])) {
          expect(keys.has(k), `${name}: ${k}`).toBe(false)
          keys.add(k)
        }
        expect(codeFromCell(table, table[code]!), `${name}.${code}`).toBe(code)
        expect(codeFromCell(table, code), `${name}.${code}`).toBe(code)
      }
    }
  })
})

// ───────────────────────────── 코드 표 ─────────────────────────────

describe('코드 표 (codes.ts)', () => {
  it('판정 특성 기본값: 균열·융합불량·용입불량 = 면상, 기공·슬래그 = 체적', () => {
    const types = codesOf(METALLURGICAL_TYPE)
    for (const t of types) {
      const expected = /^(crack|lof)-|^incomplete-penetration$|^planar-presumed$/.test(t) ? 'planar' : 'volumetric'
      expect(defaultCharacterOf(t), t).toBe(expected)
    }
    expect(defaultCharacterOf('slag')).toBe('volumetric')
    expect(defaultCharacterOf('porosity-cluster')).toBe('volumetric')
  })

  it('ISO 6520-1 코드는 모두 표에 있고, 원문 대조 전(verified: false)으로 표시된다', () => {
    for (const [t, info] of Object.entries(METALLURGICAL_TYPE_INFO)) {
      if (info.iso === null) {
        expect(['planar-presumed', 'volumetric-presumed']).toContain(t)
        continue
      }
      expect(ISO_6520_1[info.iso], t).toBeDefined()
      expect(isoCodeOf(t as MetallurgicalType)?.code).toBe(info.iso)
    }
    for (const code of Object.values(GEOMETRIC_IMPERFECTION_ISO)) expect(ISO_6520_1[code]).toBeDefined()
    for (const [code, info] of Object.entries(ISO_6520_1)) {
      expect(info.code).toBe(code)
      expect(info.verified).toBe(false)
      expect(isoLabel(code)).toMatch(/\(원문 대조 전\)$/)
    }
    expect(isoLabel('4011')).toBe('4011 측벽 융합불량 (원문 대조 전)')
    expect(isoLabel('9999')).toBe('9999 (표에 없음)')
    // 2차 출처로 본 코드
    for (const code of ['1011', '2011', '301', '4011', '4012', '4013', '4021']) expect(ISO_6520_1[code]?.basis, code).toBe('secondary')
  })

  it('제안서 대응: 결함 5종이 모두 쓰이고, 위치는 캡 = Cap · 몸체·측벽 = Center · 루트 = Root', () => {
    const used = new Set(Object.values(METALLURGICAL_TYPE_INFO).map((i) => i.proposalClass))
    for (const c of codesOf(PROPOSAL_DEFECT_CLASS)) expect(used.has(c), c).toBe(true)
    expect(METALLURGICAL_TYPE_INFO['crack-toe'].proposalCrackSubtype).toBe('toe')
    expect(WELD_ZONE_TO_PROPOSAL).toEqual({ cap: 'cap', body: 'center', sidewall: 'center', root: 'root', 'toe-haz': null })
  })

  it('정답 계층: 인증·설계 > 2인 합의 > 1인, PCN 시트는 1인 판독', () => {
    expect(truthTierOfSource('manufacturer-report')).toBe('certified')
    expect(truthTierOfSource('design-drawing')).toBe('certified')
    expect(truthTierOfSource('pcn-sheet')).toBe('single')
    expect(truthTierOfSource('none')).toBeNull()
  })

  it('표의 한국어 이름', () => {
    expect(CONFIDENCE).toEqual({ certain: '확실', probable: '보통', uncertain: '불확실' })
    expect(WELD_SIDE.L).toBe('왼쪽 (L)')
    for (const [name, raw] of Object.entries(LABEL_CODE_TABLES)) {
      if (name === 'PROPOSAL_LOCATION') continue // 제안서 표기 그대로
      for (const label of Object.values(raw as Record<string, string>)) {
        expect(label, `${name}: ${label}`).toMatch(/[가-힣]|^RT$|^AI$|^OmniPC$|^PCN/)
      }
    }
  })
})

// ───────────────────────────── 기본값 · 라벨 세트 ─────────────────────────────

describe('기본값 만들기 · 라벨 세트', () => {
  it('최소 입력으로 만든 기록이 검사를 통과한다', () => {
    const r: IndicationRecord = newIndicationRecord({ uuid: uuid(7), sha256: SHA_A, labelerId: 'kim', guidelineVersion: 'v1' })
    expect(r.coordSource).toBe('imported-mm')
    expect(r.derived.coordRulesVersion).toBeNull()
    const v = validateIndicationRecord(r)
    expect(v.errors).toEqual([])
    // 종류가 비어 있다는 경고와, 스캔 범위가 기본값(0~0) 그대로라는 경고만
    expect(v.warnings).toEqual([
      "결함 종류가 비어 있습니다 (모르면 '면상 추정'·'체적 추정')",
      '파생 위치: 스캔 범위가 0~0 mm 입니다 (기본값 그대로일 수 있음) [derived]'
    ])
  })

  it('라벨 세트 = (sha256, 라벨러, 지침서 버전, 판독 단계) — 같은 사람의 블라인드·대조 기록은 다른 세트', () => {
    const [a, b] = sampleExport().records
    expect(labelSetId(a!)).toBe(`${SHA_A}|kim|v1|blind`)
    expect(sameLabelSet(a!, b!)).toBe(false)
    expect(sameLabelSet(a!, { sha256: SHA_A, labelerId: 'kim', guidelineVersion: 'v1', readingStage: 'blind' })).toBe(true)
    expect(sameLabelSet(a!, { sha256: SHA_A, labelerId: 'kim', guidelineVersion: 'v1', readingStage: 'reconciled' })).toBe(false)
  })

  it('저장 단위 이름으로 칸 정의를 찾는다', () => {
    expect(Object.keys(LABEL_ENTITY_FIELDS).sort()).toEqual(
      ['FileAlignment', 'IndicationRecord', 'ObservationRow', 'PhysicalDefect', 'ReviewInterval', 'WorkEvent'].sort()
    )
    expect(fieldAt('IndicationRecord', 'anchors.anchor.beam')?.label).toBe('빔')
    expect(fieldAt('IndicationRecord', 'derived.nope')).toBeNull()
    expect(isPathRequired('IndicationRecord', 'derived.scanStartMm')).toBe(true)
    expect(isPathRequired('IndicationRecord', 'geometricEcho.kind')).toBe(false)
    expect(isPathRequired('ReviewInterval', 'gate.legMin')).toBe(false)
  })
})

// ───────────────────────────── 검토 반영 (2026-10-06) ─────────────────────────────

describe('의미 검사 보강', () => {
  it('ISO 6520-1 코드: 표에 없음·종류와 다름·형상 에코에 코드 → 경고', () => {
    const r = parseWith((f) => {
      rec(f, 1)['isoCode'] = '4011' // 슬래그인데 측벽 융합불량 코드
      rec(f, 2)['isoCode'] = '4011' // 형상 에코에 결함 코드
      rec(f, 3)['isoCode'] = '9999' // 표에 없음 (언더컷 기대값 501)
    })
    expect(r.errors).toEqual([])
    const has = (s: string): void => expect(r.warnings.some((w) => w.includes(s)), `${s}\n${r.warnings.join('\n')}`).toBe(true)
    has('결함 종류의 코드(301)와 다릅니다 (받은 값: 4011)')
    has('형상 에코(정상 형상)에는 ISO 6520-1 결함 코드를 붙이지 않습니다')
    has('코드 9999 가 우리 ISO 6520-1 표에 없습니다')
    has('형상 불완전 세부의 코드(501)와 다릅니다')
  })

  it('기록 기준 초과인데 평가 기준 미만이면 오류', () => {
    const r = parseWith((f) => {
      const sig = rec(f, 1)['signal'] as Record<string, unknown>
      sig['exceedsEvaluationLevel'] = false
      sig['exceedsRecordingLevel'] = true
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('기록 기준을 넘었는데 평가 기준은 못 넘었다고'))).toBe(true)
  })

  it('음수 깊이·0~0 스캔·대조 단계인데 설계값 안 봄 → 경고', () => {
    const r = parseWith((f) => {
      ;(rec(f, 1)['derived'] as Record<string, unknown>)['depthTopMm'] = -5
      ;(rec(f, 3)['derived'] as Record<string, unknown>)['scanStartMm'] = 0
      ;(rec(f, 3)['derived'] as Record<string, unknown>)['scanEndMm'] = 0
      rec(f, 0)['readingStage'] = 'reconciled'
    })
    expect(r.errors).toEqual([])
    const has = (s: string): void => expect(r.warnings.some((w) => w.includes(s)), `${s}\n${r.warnings.join('\n')}`).toBe(true)
    has('실제 깊이 위가 음수입니다 (-5 mm)')
    has('스캔 범위가 0~0 mm 입니다')
    has("대조·확정 단계 기록인데 '설계값 봤는지'가 아니오입니다")
  })

  it('물리 결함: 중심이 시작~끝 밖, 길이 ≠ 끝 − 시작, 출처 없음 + 설계만 → 경고', () => {
    const p = newPhysicalDefect({ id: 'D1', specimenId: 'S', confirmation: 'design-only', design: { startMm: 10, endMm: 20, centerMm: 100, lengthMm: 50 } })
    const v = validatePhysicalDefect(p)
    expect(v.errors).toEqual([])
    expect(v.warnings.some((w) => w.includes('중심(100)이 시작~끝(10~20) 밖'))).toBe(true)
    expect(v.warnings.some((w) => w.includes('길이(50)가 끝 − 시작(10)과'))).toBe(true)
    expect(v.warnings.some((w) => w.includes("출처가 '없음'인데 확인 수준이 '설계만'"))).toBe(true)
  })

  it('없는 날짜·시각은 ISO 시각이 아니다', () => {
    expect(isIsoDateTime('2026-02-30T10:00:00+09:00')).toBe(false)
    expect(isIsoDateTime('2026-13-01T10:00+09:00')).toBe(false)
    expect(isIsoDateTime('2026-10-20T24:00:00+09:00')).toBe(false)
    expect(isIsoDateTime('2028-02-29T10:00:00Z')).toBe(true)
    expect(isIsoDateTime('2026-10-20T14:05+09:00')).toBe(true)
  })

  it('모르는 칸이 아주 많아도 경고는 상한까지만', () => {
    const r = parseWith((f) => {
      for (let i = 0; i < 1000; i++) f[`x${i}`] = i
    })
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBe(MAX_MESSAGES + 1)
    expect(r.warnings.at(-1)).toMatch(/^… 경고 \d+건 더 있습니다\.$/)
  })

  it('지시 기록의 물리 결함 ID 가 가리키는 결함이 없거나 시편을 모르면 경고', () => {
    const r = parseWith((f) => {
      rec(f, 0)['physicalDefectId'] = 'ZZZ'
      rec(f, 3)['physicalDefectId'] = 'D1' // SHA_B 파일 정렬에는 시편 ID 가 없음
    })
    expect(r.errors).toEqual([])
    expect(r.warnings).toContain('이 파일에 없는 물리 결함을 가리키는 지시 기록이 있습니다: TP03/ZZZ')
    expect(r.warnings.some((w) => w.includes('1건은 파일 정렬(시편 ID)이 없어'))).toBe(true)
  })

  it('버전 목록: 같은 PC 두 번은 오류, 합이 revision 과 다르면 경고, 자동 풀림은 검토 완료에만', () => {
    const r = parseWith((f) => {
      rec(f, 0)['versions'] = [
        { pcId: 'pc-lab', edits: 1 },
        { pcId: 'pc-lab', edits: 2 }
      ]
    })
    expect(r.errors.some((e) => e.includes("PC 'pc-lab' 가 두 번 나옵니다"))).toBe(true)
    const w = parseWith((f) => {
      rec(f, 0)['revision'] = 5
      ;(f['reviewIntervals'] as Record<string, unknown>[])[1]!['released'] = true
    })
    expect(w.errors).toEqual([])
    expect(w.warnings.some((x) => x.includes('고친 횟수 합(3)이 revision(5)과 다릅니다'))).toBe(true)
    expect(w.warnings.some((x) => x.includes("'자동 풀림'은 검토 완료 구간에만"))).toBe(true)
  })
})

describe('높이 방식 · 표면', () => {
  it('시방서 15절 방법만 표 14 판정에 쓴다 (−6 dB 높이는 참고)', () => {
    expect(HEIGHT_METHOD_IN_SPEC).toEqual({ 'tip-tip': true, 'tip-surface': true, 'transit-time': true, '6db': false, unmeasurable: false })
  })

  it("표면은 표면 열림/내재 두 값, '점 같은 지시'는 따로 참/거짓", () => {
    const surface = findColumnByHeader('indication', '표면')!
    expect(surface.enumValues.map((v) => v.code)).toEqual(['surface-breaking', 'embedded'])
    expect(findColumnByHeader('indication', '점 같은 지시')?.target?.path).toBe('pointLike')
  })
})

describe('엑셀 양식 칸 — 입력 검사·조건부 필수', () => {
  it('숫자 칸은 모두 범위가 있고, 그 범위가 스키마 검사 안에 든다', () => {
    for (const c of LABEL_COLUMNS) {
      const id = columnId(c)
      if (c.format !== 'number') continue
      expect(c.rule?.min, id).toBeDefined()
      expect(c.rule?.max, id).toBeDefined()
      if (!c.target) continue
      const f = fieldAt(c.target.entity, c.target.path)!
      if (f.check.t !== 'number') continue
      if (f.check.min !== undefined) expect(c.rule!.min!, id).toBeGreaterThanOrEqual(f.check.min)
      if (f.check.max !== undefined) expect(c.rule!.max!, id).toBeLessThanOrEqual(f.check.max)
      if (f.check.int) expect(c.rule!.int, id).toBe(true)
    }
  })

  it('끝 ≥ 시작 칸과 조건부 필수 칸은 같은 시트의 칸·코드를 가리킨다', () => {
    for (const c of LABEL_COLUMNS) {
      const id = columnId(c)
      const keys = columnsOf(c.sheet).map((x) => x.key)
      if (c.rule?.atLeastKey) {
        expect(keys, id).toContain(c.rule.atLeastKey)
        const other = columnsOf(c.sheet).find((x) => x.key === c.rule!.atLeastKey)!
        expect(other.format, id).toBe(c.format)
      }
      if (c.requiredWhen) {
        const other = columnsOf(c.sheet).find((x) => x.key === c.requiredWhen!.key)
        expect(other, id).toBeDefined()
        for (const code of c.requiredWhen.codes) expect(other!.enumValues.map((v) => v.code), id).toContain(code)
        if (c.requiredWhen.fallback !== undefined) expect(c.enumValues.map((v) => v.code), id).toContain(c.requiredWhen.fallback)
      }
    }
    // 형상 에코 세부는 비면 '기타', 품질 불량 사유·형상 불완전 세부는 대신할 값이 없음
    expect(findColumnByHeader('indication', '형상 에코 세부')?.requiredWhen?.fallback).toBe('other')
    expect(findColumnByHeader('review', '품질 불량 사유')?.requiredWhen?.fallback).toBeUndefined()
    expect(findColumnByHeader('indication', '보정 전 길이 (mm)')?.requiredWhen?.codes).toEqual(['6db-curvature'])
  })

  it("검토구간 게이트 깊이는 '펼친 깊이'라고 머리글에 적혀 있다", () => {
    expect(findColumnByHeader('review', '게이트 깊이 위 (mm, 펼친 깊이)')?.target?.path).toBe('gate.depthTopMm')
    expect(fieldAt('ReviewInterval', 'gate.depthTopMm')?.label).toMatch(/펼친 깊이/)
  })

  it("'판독자' 시트는 한 줄이고 라벨 세트 키 칸(라벨러·판독 단계·지침서 버전)을 갖는다", () => {
    const reader = LABEL_SHEETS.find((s) => s.id === 'reader')!
    expect(reader.maxRows).toBe(1)
    const keys = columnsOf('reader').map((c) => c.key)
    expect(keys).toEqual(expect.arrayContaining(['labelerId', 'readingStage', 'guidelineVersion', 'readerSource', 'organization', 'qualification']))
    for (const c of columnsOf('reader')) expect(c.target?.via, columnId(c)).toBe('sheet-meta')
    expect(findColumnByHeader('indication', 'Ref 대비 (dB, 앱 계산)')?.appFilled).toBe(true)
  })
})
