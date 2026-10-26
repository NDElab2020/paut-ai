/**
 * 전문가 엑셀(기록양식 v1) 가져오기 — parseLabelWorkbook.
 * 픽스처: tests/fixtures/labels/*.xlsx (make_fixtures.py 가 양식 원본에 시험 값을 채워 만듦, openpyxl).
 * 문맥: X3 12T-SV 4개 파일(가짜 sha256, 실데이터와 같은 그룹·이득 — 마지막 describe 가 실데이터로 대조).
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashFile } from '@core/storage/hash'
import { readNdeFile } from '@core/nde'
import { readViewerInfo } from '@core/nde/viewer'
import {
  fileNameKey,
  labelColumnsFingerprint,
  makeFileFinder,
  parseLabelWorkbook,
  stableUuid,
  uuidKey,
  type LabelWorkbookContext,
  type LabelWorkbookFile,
  type LabelWorkbookImport
} from '@core/labels/xlsx'
import {
  LABEL_SHEETS,
  columnsOf,
  newLabelExport,
  parseLabelExport,
  sheetHeaders,
  type IndicationRecord,
  type LabelSheetId
} from '@shared/labels'
import { HAS_X3 } from '../nde/fixtures'
import { X3_FILES } from '../../paths'
import { NOW, X3, X3_GROUPS, buildXlsx, fixture, serial, x3Context, type KitCell, type X3Entry } from './xlsxKit'

const [F1, F2, F3, F4] = X3 as [X3Entry, X3Entry, X3Entry, X3Entry]
const read = (name: string): Buffer => readFileSync(fixture(name))
const parse = (name: string, ctx: LabelWorkbookContext = x3Context()): LabelWorkbookImport => parseLabelWorkbook(read(name), ctx)

/** 결과 전체가 validate.ts 의 내보내기 파일 검사를 통과하는지 */
function bundleCheck(r: LabelWorkbookImport): ReturnType<typeof parseLabelExport> {
  const file = newLabelExport(
    { appVersion: 'test', exportedAt: '2026-10-22T10:00:00+09:00', pcId: 'pc-test' },
    {
      labelers: r.labeler ? [{ id: r.labeler.id, name: r.labeler.name, qualification: r.labeler.qualification, organization: r.labeler.organization }] : [],
      physicalDefects: r.physicalDefects,
      fileAlignments: r.alignments,
      records: r.records,
      reviewIntervals: r.reviews,
      workEvents: r.events
    }
  )
  return parseLabelExport(JSON.parse(JSON.stringify(file)))
}

const byRef = (r: LabelWorkbookImport, sha: string, ref: string | null): IndicationRecord => {
  const hit = r.records.find((x) => x.sha256 === sha && x.externalRef === ref)
  if (!hit) throw new Error(`기록 없음 ${sha.slice(0, 4)} ${ref}`)
  return hit
}

describe('판독자용 양식 (블라인드, X3 4개 파일)', () => {
  const r = parse('x3_blind_kim.xlsx')

  it('오류 없이 가져오고, 결과 전체가 스키마 검사를 통과한다', () => {
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
    const check = bundleCheck(r)
    expect(check.errors).toEqual([])
    expect(check.ok).toBe(true)
    expect([r.records.length, r.reviews.length, r.events.length, r.alignments.length, r.physicalDefects.length]).toEqual([9, 5, 10, 4, 0])
  })

  it("'판독자' 시트 한 줄이 라벨러·라벨 세트가 된다", () => {
    expect(r.labeler).toEqual({
      id: 'kim-l2',
      name: 'kim-l2',
      qualification: 'UT Level II',
      organization: null,
      readingStage: 'blind',
      guidelineVersion: 'v1',
      readerSource: 'expert'
    })
    expect(r.labelSets).toEqual(
      [F1, F2, F3, F4].map((f) => ({ sha256: f.sha256, labelerId: 'kim-l2', guidelineVersion: 'v1', readingStage: 'blind' }))
    )
    expect(r.form).toMatchObject({ labelForm: 'v1', blind: true, templateStage: 'blind', schemaVersion: '1' })
  })

  it('양식 칸 지문 = 앱 칸 지문 (생성기와 같은 계산)', () => {
    expect(r.form.fingerprint).toBe(labelColumnsFingerprint())
    expect(r.form.appFingerprint).toBe(labelColumnsFingerprint())
    expect(r.warnings.some((w) => w.includes('칸 정의가 바뀌었습니다'))).toBe(false)
  })

  it("'파일' 시트 → 파일 정렬 (가설 기준점, 두께)", () => {
    expect(r.alignments.map((a) => [a.sha256, a.fileName, a.specimenId])).toEqual(X3.map((f) => [f.sha256, f.fileName, f.specimenId]))
    expect(r.alignments[0]).toMatchObject({
      datumUMm: 0,
      direction: 1,
      alignmentAssumed: true,
      thicknessMm: 12,
      datumKind: null,
      enteredBy: 'kim-l2',
      versions: [{ pcId: 'pc-test', edits: 1 }],
      revision: 1,
      pcId: 'pc-test',
      updatedAt: '2026-10-22T10:00:00+09:00',
      deleted: false
    })
  })

  it('지시 1 (모든 칸) — 기대 기록과 같다', () => {
    const expected: IndicationRecord = {
      uuid: 'c4a5fad8-7a85-569b-bac3-28b1b059f7d1',
      sha256: F1.sha256,
      secondaryFingerprint: null,
      labelerId: 'kim-l2',
      guidelineVersion: 'v1',
      readingStage: 'blind',
      revision: 1,
      versions: [{ pcId: 'pc-test', edits: 1 }],
      deleted: false,
      pcId: 'pc-test',
      createdAt: '2026-10-22T10:00:00+09:00',
      updatedAt: '2026-10-22T10:00:00+09:00',
      readerSource: 'expert',
      readerDetail: { organization: null, qualification: 'UT Level II', modelVersion: null },
      externalRef: '1',
      kind: 'defect',
      coordSource: 'imported-mm',
      anchors: [],
      derived: { scanStartMm: 30, scanEndMm: 46, vMinMm: -8, vMaxMm: -5.5, depthTopMm: 0.5, depthBottomMm: 3, coordRulesVersion: null },
      recheckNeeded: false,
      existenceConfidence: 'certain',
      defectType: 'crack-toe',
      isoCode: '1013',
      typeConfidence: 'probable',
      character: { value: 'planar', alignedVolumetric: false, expertConfirmed: false },
      surface: 'surface-breaking',
      pointLike: false,
      location: { zone: 'toe-haz', side: 'L', noBevelOverlay: false },
      // 길이 잰 그룹이 비어 최대 진폭 그룹(0)
      length: { valueMm: 16, method: 'eval-level', uncorrectedMm: null, groupId: 0, beam: null, angleDeg: 62, thresholdPct: 32 },
      height: { method: 'tip-tip', valueMm: 2.5, pointIds: [] },
      signal: {
        maxAmplitudePct: 87.5,
        // Ref = 80 × 10^((24.7 − 18.7)/20) = 159.6 %FSH → 20·log10(87.5/159.6) = −5.22 dB
        refDb: -5.22,
        refDbVerified: false,
        saturated: false,
        exceedsEvaluationLevel: true,
        // 길이 16 > t 12 → 기록 기준 Ref −14 dB
        exceedsRecordingLevel: true,
        peak: { groupId: 0, beam: null, angleDeg: 62, scanMm: 38, depthMm: 2.1 }
      },
      suggestions: [],
      knowledge: { designValueSeen: null, specimenKnown: null, aiDevParticipant: null },
      physicalDefectId: null,
      groupingId: null,
      viewSnapshot: null,
      geometricEcho: null,
      geometricImperfection: null,
      note: '시험용 값'
    }
    expect(byRef(r, F1.sha256, '1')).toEqual(expected)
    // UUID = v5(이름공간, 'indication|sha|라벨러|지침서|단계|지시 번호') — 이름공간을 바꾸면 이 값이 바뀐다(가져온 기록과 이어지지 않음)
    expect(stableUuid(uuidKey(['indication', F1.sha256, 'kim-l2', 'v1', 'blind', 'ref:1']))).toBe(expected.uuid)
  })

  it('나머지 지시: 포화·다른 길이 그룹, 형상 에코, 장비 원본 파일명, 그룹 빔, 일렬 체적, 형상 불완전, 번호 없음', () => {
    expect(byRef(r, F1.sha256, '2')).toMatchObject({
      signal: { maxAmplitudePct: 200, saturated: true, refDb: 1.96, exceedsEvaluationLevel: true, exceedsRecordingLevel: true, peak: { groupId: 1, angleDeg: 55 } },
      length: { valueMm: 18, groupId: 0, angleDeg: 58 },
      defectType: 'lof-sidewall',
      isoCode: '4011',
      height: { method: 'unmeasurable', valueMm: null }
    })
    expect(byRef(r, F1.sha256, '3')).toMatchObject({
      kind: 'geometric-echo',
      geometricEcho: { kind: 'root', fromSuggestion: false },
      defectType: null,
      isoCode: null,
      derived: { scanStartMm: 0, scanEndMm: 300 },
      // 길이를 몰라 기록 기준(−8/−14 dB)을 정하지 못함: −11 dB 는 둘 사이
      signal: { refDb: -11, exceedsEvaluationLevel: true, exceedsRecordingLevel: null },
      note: '레그 1·2 경계'
    })
    // 장비 원본 파일명 '12T-SV-PL23840-i15-CAP20' 으로 적은 줄 → 02 파일
    expect(byRef(r, F2.sha256, '1')).toMatchObject({ defectType: 'crack-root', isoCode: '1011', knowledge: { designValueSeen: true }, height: { method: 'tip-surface' } })
    expect(byRef(r, F2.sha256, '2').geometricEcho).toEqual({ kind: 'other', fromSuggestion: false })
    // 그룹이 비어도 두 그룹 Ref 가 같아 계산된다
    expect(byRef(r, F3.sha256, '1')).toMatchObject({ signal: { peak: null, refDb: -0.54 }, defectType: 'incomplete-penetration', isoCode: '4021', length: { groupId: null } })
    expect(byRef(r, F4.sha256, '1')).toMatchObject({
      character: { value: 'planar', alignedVolumetric: true, expertConfirmed: true },
      pointLike: true,
      isoCode: '200',
      existenceConfidence: 'probable'
    })
    expect(byRef(r, F4.sha256, '2')).toMatchObject({ kind: 'geometric-imperfection', geometricImperfection: { kind: 'undercut' }, isoCode: '501', existenceConfidence: 'uncertain' })
    const noRef = byRef(r, F3.sha256, null)
    // 엑셀 'Ref 대비' 칸의 3.5 는 쓰지 않고 앱이 계산: 20·log10(20/159.6) = −18.04 → 평가 기준(−14) 미만
    expect(noRef.signal).toMatchObject({ refDb: -18.04, exceedsEvaluationLevel: false, exceedsRecordingLevel: false })
    expect(noRef.uuid).toBe(stableUuid(uuidKey(['indication', F3.sha256, 'kim-l2', 'v1', 'blind', 'row:11'])))
    expect(noRef.derived.depthTopMm).toBeNull()
  })

  it('경고는 시트·행·칸 위치를 붙인다 (빈 줄 10행은 건너뜀)', () => {
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        "'지시' 시트 6행 R열 '형상 에코 세부': '기록 구분' 칸이 '형상 에코' 인데 비어 있어 '기타'(으)로 가져옵니다",
        "'지시' 시트 11행 L열 '실제 깊이 위 (mm)': '기록 구분' 칸이 '결함' 이면 적어야 합니다 (비어 있음)",
        "'지시' 시트 11행 O열 'Ref 대비 (dB, 앱 계산)': 앱이 계산하는 칸이라 적은 값(3.5)은 쓰지 않습니다",
        "'지시' 시트 11행 B열 '지시 번호': 지시 번호가 비어 행 번호로 기록을 가립니다. 줄 순서를 바꿔 다시 가져오면 다른 기록이 됩니다",
        "'검토구간' 시트 6행: 검토 완료 구간에 게이트 깊이·레그 범위가 없습니다 ('결함 없음' 예시를 뽑을 범위가 정해지지 않음)"
      ])
    )
    expect(r.warnings.some((w) => w.includes('10행'))).toBe(false)
    expect(r.warnings.some((w) => w.includes('파일 이득으로 추정한 값'))).toBe(true)
  })

  it('검토구간: 검토 완료(그룹·게이트) · 품질 불량(모든 그룹) · 기준 미만 지시', () => {
    expect(r.reviews.map((v) => [v.sha256, v.kind, v.groupId, v.scanStartMm, v.scanEndMm, v.gate, v.reason])).toEqual([
      [F1.sha256, 'reviewed', 0, 0, 300, { depthTopMm: 7, depthBottomMm: 28, legMin: 1, legMax: 3 }, null],
      [F1.sha256, 'reviewed', 1, 0, 300, { depthTopMm: 7, depthBottomMm: 28, legMin: 1, legMax: 3 }, null],
      [F2.sha256, 'quality-bad', null, 280, 300, null, 'coupling'],
      [F3.sha256, 'below-threshold', 0, 100, 104, null, null],
      [F4.sha256, 'reviewed', null, 0, 300, null, null]
    ])
    expect(r.reviews[2]).toMatchObject({ labelerId: 'kim-l2', guidelineVersion: 'v1', readingStage: 'blind', released: false, note: '끝부분 접촉 불량' })
  })

  it('작업시간 → 작업 이벤트 (열기·닫기·보고서·라벨 추가 작업·쉰 시간, 한국 시간)', () => {
    const f1 = r.events.filter((e) => e.sha256 === F1.sha256)
    expect(f1.map((e) => [e.kind, e.at, e.detail])).toEqual([
      ['file-open', '2026-10-20T14:05:00+09:00', { note: '지시 2 애매, 약 10분' }],
      ['file-close', '2026-10-20T15:40:00+09:00', null],
      ['report', '2026-10-20T15:40:00+09:00', { minutes: 10 }],
      ['label-extra', '2026-10-20T15:40:00+09:00', { minutes: 20 }],
      ['idle', '2026-10-20T15:40:00+09:00', { minutes: 5 }]
    ])
    expect(new Set(f1.map((e) => e.sessionId)).size).toBe(1)
    expect(f1[0]).toMatchObject({ labelerId: 'kim-l2', readingStage: 'blind', tool: 'omnipc', pcId: 'pc-test' })
    // 글자로 적은 시각
    expect(r.events.filter((e) => e.sha256 === F2.sha256).map((e) => [e.kind, e.at])).toEqual([
      ['file-open', '2026-10-21T09:00:00+09:00'],
      ['file-close', '2026-10-21T09:50:00+09:00'],
      ['label-extra', '2026-10-21T09:50:00+09:00']
    ])
    expect(r.events.filter((e) => e.sha256 === F3.sha256).map((e) => e.kind)).toEqual(['file-open', 'file-close'])
  })

  it('같은 엑셀을 다시 가져오면 같은 결과·같은 UUID (시각·PC 가 달라도 UUID 는 같음)', () => {
    expect(parse('x3_blind_kim.xlsx')).toEqual(r)
    const other = parse('x3_blind_kim.xlsx', x3Context({ now: new Date('2027-01-01T00:00:00Z'), pcId: 'pc-other' }))
    expect(other.records.map((x) => x.uuid)).toEqual(r.records.map((x) => x.uuid))
    expect(other.reviews.map((x) => x.uuid)).toEqual(r.reviews.map((x) => x.uuid))
    expect(other.events.map((x) => x.uuid)).toEqual(r.events.map((x) => x.uuid))
    expect(other.records[0]?.versions).toEqual([{ pcId: 'pc-other', edits: 1 }])
    const all = [...r.records, ...r.reviews, ...r.events].map((x) => x.uuid)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('OPD 파일 이름 (.opd 확장자는 있어도 없어도 같은 파일)', () => {
  it('열쇠: 끝의 .nde·.opd 를 뗀다 — 확장자 없이 적은 엑셀 이름도 OPD 사본을 찾는다', () => {
    expect(fileNameKey('TP14-ROOT-L-01')).toBe('tp14-root-l-01')
    expect(fileNameKey('TP14-ROOT-L-01.opd')).toBe('tp14-root-l-01')
    expect(fileNameKey('C:\\data\\TP14-ROOT-L-01.OPD')).toBe('tp14-root-l-01')
    expect(fileNameKey('12T-SV-01-Cap on.nde')).toBe('12t-sv-01-cap on')
    expect(fileNameKey('x.oud')).toBe('x.oud')
    const opd: LabelWorkbookFile = { sha256: 'aa'.repeat(32), fileName: 'TP14-ROOT-L-01.opd', groups: [{ id: 0, name: 'PA 1', technique: 'pa-sectorial', skewDeg: 90, gainDb: 33.6, referenceGainDb: null, referenceAmplitudePct: 80 }], thicknessMm: 25, specimenId: 'TP14' }
    const finder = makeFileFinder([{ names: [opd.fileName, 'TP14-ROOT-L-##'], file: opd }])
    for (const n of ['TP14-ROOT-L-01', 'TP14-ROOT-L-01.opd', 'tp14-root-l-01.OPD']) expect(finder.findFiles(n).map((f) => f.sha256), n).toEqual([opd.sha256])
    // 같은 이름의 .nde 와 .opd 가 함께 있으면 둘 다 걸려 미리보기가 고르게 한다
    const nde: LabelWorkbookFile = { ...opd, sha256: 'bb'.repeat(32), fileName: 'TP14-ROOT-L-01.nde' }
    const both = makeFileFinder([{ names: [opd.fileName], file: opd }, { names: [nde.fileName], file: nde }])
    expect(both.findFiles('TP14-ROOT-L-01').map((f) => f.fileName).sort()).toEqual(['TP14-ROOT-L-01.nde', 'TP14-ROOT-L-01.opd'])
  })

  it('X3 판독 양식을 .opd 이름의 사본(같은 줄기)과 맞춰도 오류 없이 같은 기록이 된다', () => {
    const asOpd = X3.map((e) => ({ ...e, fileName: e.fileName.replace(/\.nde$/, '.opd') }))
    const r = parse('x3_blind_kim.xlsx', x3Context({}, asOpd))
    const base = parse('x3_blind_kim.xlsx')
    expect(r.errors).toEqual([])
    expect(r.records.map((x) => [x.sha256, x.externalRef, x.uuid])).toEqual(base.records.map((x) => [x.sha256, x.externalRef, x.uuid]))
  })
})

describe('대조용 양식 (설계값 대조)', () => {
  const r = parse('x3_reconciled_kim.xlsx')
  const blind = parse('x3_blind_kim.xlsx')

  it('물리결함 11건을 가져오고, 모든 줄은 설계값 봤음', () => {
    expect(r.errors).toEqual([])
    expect(bundleCheck(r).errors).toEqual([])
    expect(r.labeler?.readingStage).toBe('reconciled')
    expect(r.physicalDefects).toHaveLength(11)
    expect(r.physicalDefects[0]).toMatchObject({
      id: 'D1',
      specimenId: 'PL23833',
      design: { type: 'crack-toe', zone: 'toe-haz', centerMm: 38, startMm: null },
      source: 'none',
      confirmation: 'unknown',
      dataOrigin: 'measured',
      versions: [{ pcId: 'pc-test', edits: 1 }]
    })
    expect(r.records.map((x) => [x.externalRef, x.knowledge.designValueSeen, x.physicalDefectId, x.readingStage])).toEqual([
      ['1', true, 'D1', 'reconciled'],
      ['C1', true, 'D3', 'reconciled']
    ])
    expect(r.warnings).toContain("'지시' 시트 2행 AJ열 '설계값 봤는지': 판독 단계가 '설계값 대조'라 '설계값 봤음'으로 가져옵니다")
  })

  it('같은 파일·라벨러·지시 번호라도 판독 단계가 다르면 다른 기록(다른 라벨 세트)', () => {
    expect(byRef(r, F1.sha256, '1').uuid).not.toBe(byRef(blind, F1.sha256, '1').uuid)
    expect(r.labelSets).toEqual([{ sha256: F1.sha256, labelerId: 'kim-l2', guidelineVersion: 'v1', readingStage: 'reconciled' }])
  })
})

describe('오류 위치', () => {
  it('필수 칸 빠짐·잘못된 열거값·그룹 없음·모르는 파일·범위·두께·조건부 필수·번호 겹침·숫자 아님·시각', () => {
    const r = parse('x3_errors.xlsx')
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual([
      "'지시' 시트 2행 E열 '스캔 시작 (mm)': 필수 칸이 비어 있습니다",
      "'지시' 시트 3행 C열 '기록 구분': 목록에 없는 값입니다 (받은 값: '결함임'. 고를 수 있는 값: 결함 / 형상 에코 / 형상 불완전)",
      "'지시' 시트 4행 D열 '그룹 (기법·Skew)': 이 파일에 '리니어 Skew 90' 그룹이 없습니다 (파일의 그룹: Skew90(0): 섹토리얼 90°, Skew270(1): 섹토리얼 270°)",
      "'지시' 시트 5행 A열 '파일명': 이 파일을 '파일' 시트에서도, 앱에서도 찾지 못했습니다. 파일명을 '파일' 시트와 같게 적습니다",
      "'지시' 시트 6행 F열 '스캔 끝 (mm)': '스캔 시작 (mm)'(30)보다 작을 수 없습니다 (받은 값: 20)",
      "'지시' 시트 7행 M열 '실제 깊이 아래 (mm)': 그 파일 두께(12 mm)보다 클 수 없습니다 (실제 깊이, 받은 값: 15)",
      "'지시' 시트 8행: 형상 불완전 기록에는 형상 불완전 세부(단차·과다용입·루트 오목·언더컷)가 있어야 합니다",
      "'지시' 시트 10행 B열 '지시 번호': 같은 파일의 지시 번호 'E8' 줄이 9행에도 있습니다. 지시마다 다른 번호를 적습니다",
      "'지시' 시트 11행 N열 '최대 진폭 (%FSH)': 숫자가 아닙니다 (받은 값: '87%'). 단위는 빼고 숫자만 적습니다",
      "'검토구간' 시트 2행: 품질 불량 구간에는 사유(커플링·누락·포화·잡음·시간 범위·감도)가 있어야 합니다",
      "'검토구간' 시트 3행 H열 '레그 최소': 정수로 적습니다 (받은 값: 1.5)",
      "'작업시간' 시트 2행 C열 '판독 끝': '판독 시작'(2026-10-20 15:00)보다 작을 수 없습니다 (받은 값: 2026-10-20 14:00)",
      "'작업시간' 시트 3행 B열 '판독 시작': 시각이 없습니다 (날짜와 시각을 함께 적습니다: 2026-10-20 14:05) (받은 값: '2026-10-20')"
    ])
    // 바른 줄(9행)은 미리보기용으로 남는다 — ok 가 false 라 저장하지 않음
    expect(r.records.map((x) => x.externalRef)).toEqual(['E8'])
    // 오류 줄의 경고는 내지 않는다 (8행 조건부 필수 경고 없음)
    expect(r.warnings.some((w) => w.includes("'지시' 시트 8행"))).toBe(false)
  })

  it('라벨러 ID 가 비면 막는다 (아무것도 가져오지 않음)', () => {
    const r = parse('x3_no_labeler.xlsx')
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toBe("'판독자' 시트 2행 A열 '라벨러 ID': 필수 칸이 비어 있습니다")
    expect([r.records, r.alignments, r.reviews, r.events]).toEqual([[], [], [], []])
    expect(r.labeler).toBeNull()
  })

  it('머리글이 양식과 다르면 오류 (칸 지문 불일치)', () => {
    const r = parse('x3_bad_header.xlsx')
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual([
      "'지시' 시트 1행 E열: 머리글이 양식과 다릅니다 (받은 값: '스캔 시작', 양식: '스캔 시작 (mm)'). 머리글 글자·순서를 바꾸지 않습니다"
    ])
    expect(r.records).toEqual([])
  })

  it('손상된 zip·엑셀이 아닌 파일은 던지지 않고 오류로 돌려준다', () => {
    const buf = read('x3_blind_kim.xlsx')
    const truncated = parseLabelWorkbook(buf.subarray(0, buf.length - 100), x3Context())
    expect(truncated.ok).toBe(false)
    expect(truncated.errors[0]).toMatch(/^엑셀 파일을 열 수 없습니다: 엑셀 파일이 손상되었습니다/)
    // 가운데를 망가뜨리면 항목을 풀 때 손상으로 나온다
    const broken = Buffer.from(buf)
    for (let i = 2000; i < 2400; i++) broken[i] = 0
    const b = parseLabelWorkbook(broken, x3Context())
    expect(b.ok).toBe(false)
    expect(b.errors[0]).toMatch(/손상|읽지 못했습니다/)
    expect(parseLabelWorkbook(Buffer.from('not a zip at all'), x3Context()).errors[0]).toContain('엑셀(xlsx) 파일이 아닙니다')
  })
})

// ───────────────────────────── 엑셀 방식으로 저장한 양식 (공유 문자열) ─────────────────────────────

type Rows = Partial<Record<LabelSheetId, Array<Record<string, KitCell>>>>

/** columns.ts 머리글로 양식 모양 통합 문서를 만든다 (안내·목록 시트 없음, 엑셀처럼 공유 문자열) */
function kitWorkbook(rows: Rows, opts: { omit?: LabelSheetId[]; extraHeader?: boolean; props?: Record<string, string> } = {}): Buffer {
  return buildXlsx(
    LABEL_SHEETS.filter((s) => !opts.omit?.includes(s.id)).map((s) => {
      const keys = columnsOf(s.id).map((c) => c.key)
      const header: KitCell[] = [...sheetHeaders(s.id), ...(opts.extraHeader && s.id === 'indication' ? ['내 메모'] : [])]
      return { name: s.name, rows: [header, ...(rows[s.id] ?? []).map((r) => keys.map((k) => r[k] ?? null))] }
    }),
    { customProps: opts.props }
  )
}

const READER = [{ labelerId: 'park-l3', readingStage: '확정 (Level III)', readerSource: '전문기관', organization: '○○검사', qualification: 'PAUT Level III' }]

describe('엑셀에서 다시 저장한 양식 (공유 문자열·숫자 셀·참거짓 셀·날짜 일련번호)', () => {
  it('확정 단계·전문기관 판독, +1 을 숫자로, 포화를 참거짓 셀로', () => {
    const buf = kitWorkbook(
      {
        reader: READER,
        file: [{ fileName: F1.fileName, direction: 1, thicknessMm: 12, alignmentAssumed: false }],
        indication: [
          {
            fileName: F1.fileName,
            externalRef: 7,
            kind: '결함',
            group: '섹토리얼 Skew 270',
            scanStartMm: '30.5',
            scanEndMm: 40,
            maxAmplitudePct: 210,
            saturated: true,
            defectType: '슬래그',
            existenceConfidence: '보통'
          }
        ],
        worktime: [{ fileName: F1.fileName, startedAt: { date: serial(2026, 11, 2, 9, 30) }, endedAt: { date: serial(2026, 11, 2, 10, 0) }, tool: '우리 앱' }]
      },
      { extraHeader: true, props: { 'paut.columnsFingerprint': '000000000000' } }
    )
    const r = parseLabelWorkbook(buf, x3Context())
    expect(r.errors).toEqual([])
    expect(r.labeler).toMatchObject({ id: 'park-l3', readingStage: 'final', readerSource: 'agency', organization: '○○검사' })
    expect(r.alignments[0]).toMatchObject({ direction: 1, alignmentAssumed: false })
    const rec = r.records[0]!
    expect(rec).toMatchObject({
      externalRef: '7',
      readingStage: 'final',
      readerSource: 'agency',
      readerDetail: { organization: '○○검사', qualification: 'PAUT Level III' },
      derived: { scanStartMm: 30.5, scanEndMm: 40 },
      signal: { maxAmplitudePct: 210, saturated: true, peak: { groupId: 1 } },
      knowledge: { designValueSeen: true },
      isoCode: '301'
    })
    // 210 %FSH(포화, 하한) → 20·log10(210/159.6) = +2.38 dB 이상
    expect(rec.signal.refDb).toBe(2.38)
    expect(r.events.map((e) => [e.kind, e.at, e.tool, e.readingStage])).toEqual([
      ['file-open', '2026-11-02T09:30:00+09:00', 'app', 'final'],
      ['file-close', '2026-11-02T10:00:00+09:00', 'app', 'final']
    ])
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        "'지시' 시트 1행: 양식에 없는 칸은 가져오지 않습니다 (AM열 '내 메모')",
        expect.stringContaining('양식을 만든 뒤 앱의 칸 정의가 바뀌었습니다 (양식 지문 000000000000')
      ])
    )
    expect(bundleCheck(r).errors).toEqual([])
  })

  it('시트가 빠지면 오류', () => {
    const r = parseLabelWorkbook(kitWorkbook({ reader: READER }, { omit: ['worktime'] }), x3Context())
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/^'작업시간' 시트가 없습니다/)
  })

  it('판독자 시트에 두 줄이면 막는다', () => {
    const r = parseLabelWorkbook(kitWorkbook({ reader: [...READER, { labelerId: 'x', readingStage: '블라인드 (설계값 안 봄)' }] }), x3Context())
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toBe("'판독자' 시트 3행: '판독자' 시트는 1줄만 적습니다 (이 파일의 모든 줄에 붙는 값)")
  })

  it("'파일' 시트에 없는 파일명은 앱에서 찾아 잇고 경고, 앱에도 없지만 SHA-256 을 적은 파일은 sha 로만 잇는다", () => {
    const unknownSha = 'ab'.repeat(32)
    const r = parseLabelWorkbook(
      kitWorkbook({
        reader: READER,
        file: [{ fileName: 'other.nde', sha256: unknownSha.toUpperCase(), thicknessMm: 10 }],
        indication: [
          { fileName: F4.deviceFileName, externalRef: '1', kind: '결함', scanStartMm: 1, scanEndMm: 2, existenceConfidence: '확실', defectType: '슬래그', depthTopMm: 3, depthBottomMm: 4 },
          { fileName: 'other.nde', externalRef: '1', kind: '결함', scanStartMm: 1, scanEndMm: 2, existenceConfidence: '확실', defectType: '슬래그', depthTopMm: 3, depthBottomMm: 4, maxAmplitudePct: 50 }
        ]
      }),
      x3Context()
    )
    expect(r.errors).toEqual([])
    expect(r.records.map((x) => x.sha256)).toEqual([F4.sha256, unknownSha])
    // 앱에 없는 파일은 Ref 를 몰라 계산하지 않음
    expect(r.records[1]?.signal.refDb).toBeNull()
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        "'파일' 시트 2행 A열 '파일명': 앱 저장소에 없는 파일입니다. SHA-256 으로만 잇고, 그룹 번호 찾기·Ref 계산은 하지 않습니다",
        expect.stringMatching(/^'지시' 시트 2행 A열 '파일명': '파일' 시트에 없는 파일명입니다/)
      ])
    )
  })

  it('더 새 스키마 양식은 막는다', () => {
    const r = parseLabelWorkbook(kitWorkbook({ reader: READER }, { props: { 'paut.labelSchemaVersion': '99' } }), x3Context())
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/^이 엑셀은 라벨 형식 v99 양식입니다/)
  })

  it('블라인드인데 물리결함 줄이 있으면 경고, 같은 물리 결함 ID·같은 작업 시작은 오류, 작업 시간 합 검사', () => {
    const blindReader = [{ labelerId: 'kim-l2', readingStage: '블라인드 (설계값 안 봄)' }]
    const pd = { specimenId: 'PL23833', physicalDefectId: 'D1', source: '없음', confirmation: '미확인' }
    const r = parseLabelWorkbook(
      kitWorkbook({
        reader: blindReader,
        file: [{ fileName: F1.fileName, specimenId: 'PL23833' }],
        physical: [pd, pd, { ...pd, specimenId: 'PL99999', physicalDefectId: 'D9' }],
        worktime: [
          { fileName: F1.fileName, startedAt: '2026-10-20 14:00', endedAt: '2026-10-20 14:30', labelExtraMinutes: 25, idleMinutes: 10 },
          { fileName: F1.fileName, startedAt: '2026-10-20 14:00', endedAt: '2026-10-20 15:00' }
        ]
      }),
      x3Context()
    )
    expect(r.errors).toEqual([
      "'물리결함' 시트 3행 B열 '물리 결함 ID': 같은 시편의 물리 결함 ID 'D1' 줄이 2행에도 있습니다",
      "'작업시간' 시트 3행 B열 '판독 시작': 같은 파일·같은 시작 시각 줄이 2행에도 있습니다"
    ])
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^'물리결함' 시트에 설계값 3줄이 있는데 판독 단계가 블라인드입니다/),
        "'물리결함' 시트 4행 A열 '시편 ID': '파일' 시트에 없는 시편 ID 입니다",
        "'작업시간' 시트 2행: 라벨 추가 작업 시간 + 쉰 시간(35분)이 판독 시작~끝(30분)보다 깁니다"
      ])
    )
    expect(r.physicalDefects.map((p) => `${p.specimenId}/${p.id}`)).toEqual(['PL23833/D1', 'PL99999/D9'])
  })

  it('같은 이름 파일이 앱에 둘이면 물음 + 오류, SHA-256 을 적거나 미리보기에서 고르면(fileChoices) 그 파일', () => {
    const twin: X3Entry = { ...F1, sha256: 'ee'.repeat(32) }
    const ctx = x3Context({}, [F1, twin])
    const ind = [{ fileName: F1.fileName, externalRef: '1', kind: '결함', scanStartMm: 1, scanEndMm: 2, existenceConfidence: '확실' }]
    const a = parseLabelWorkbook(kitWorkbook({ reader: READER, file: [{ fileName: F1.fileName }], indication: ind }), ctx)
    expect(a.errors[0]).toBe(
      `'파일' 시트 2행 A열 '파일명': 같은 이름의 파일이 앱에 2개 있습니다 (${F1.sha256.slice(0, 12)}, ${twin.sha256.slice(0, 12)}…). 미리보기에서 어느 파일인지 고르거나 '파일' 시트 'SHA-256' 칸에 적습니다`
    )
    expect(a.fileQuestions).toHaveLength(1)
    expect(a.fileQuestions[0]!.candidates.map((c) => c.sha256)).toEqual([F1.sha256, twin.sha256])
    // '지시' 줄은 '파일' 시트 줄이 실패해 다시 물음을 남긴다(같은 물음 키) — 모든 오류가 물음에서 났다
    expect(a.questionErrors).toBe(a.errors.length)
    const key = a.fileQuestions[0]!.key
    const b = parseLabelWorkbook(kitWorkbook({ reader: READER, file: [{ fileName: F1.fileName, sha256: twin.sha256 }], indication: ind }), ctx)
    expect(b.errors).toEqual([])
    expect(b.records[0]?.sha256).toBe(twin.sha256)
    expect(b.fileMatch?.[twin.sha256]).toBe('sha256')
    const c = parseLabelWorkbook(kitWorkbook({ reader: READER, file: [{ fileName: F1.fileName }], indication: ind }), { ...ctx, fileChoices: { [key]: twin.sha256 } })
    expect(c.errors).toEqual([])
    expect(c.fileQuestions).toEqual([])
    expect(c.records[0]?.sha256).toBe(twin.sha256)
    expect(c.fileMatch?.[twin.sha256]).toBe('choice')
  })

  it('그룹을 읽지 못한 파일(groupsError)은 그 이유로 오류를 낸다 (엑셀 그룹 칸 탓이 아님)', () => {
    const files: LabelWorkbookFile[] = X3.map((e) => ({ sha256: e.sha256, groups: [], thicknessMm: 12, groupsError: '저장된 사본이 없습니다' }))
    const finder = makeFileFinder(files.map((f, i) => ({ names: [X3[i]!.fileName, X3[i]!.deviceFileName], file: f })))
    const a = parseLabelWorkbook(read('x3_blind_kim.xlsx'), { findFiles: finder.findFiles, pcId: 'pc-test', now: NOW })
    expect(a.ok).toBe(false)
    expect(a.errors[0]).toContain('그룹을 읽지 못해')
    expect(a.errors[0]).toContain('저장된 사본이 없습니다')
    expect(a.errors.some((e) => e.includes('그룹이 없습니다'))).toBe(false)
    expect(a.questionErrors).toBe(0)
  })

  it('버전 칸(versionSlot)을 주면 versions 에 그 칸을 쓴다', () => {
    const a = parseLabelWorkbook(read('x3_blind_kim.xlsx'), { ...x3Context(), versionSlot: 'pc-test:abcd1234' })
    expect(a.records[0]?.versions).toEqual([{ pcId: 'pc-test:abcd1234', edits: 1 }])
    expect(a.records[0]?.pcId).toBe('pc-test')
  })

  it('같은 기법·스큐 그룹이 둘이면 물음을 남기고, 답(groupChoices)을 주면 그 그룹으로', () => {
    const groups = [...X3_GROUPS, { id: 2, name: 'Skew90-2', technique: 'sectorial', skewDeg: 450, gainDb: 24.7, referenceGainDb: 18.7 }]
    const files: LabelWorkbookFile[] = X3.map((e) => ({ sha256: e.sha256, groups: e === F1 ? groups : X3_GROUPS, thicknessMm: 12 }))
    const finder = makeFileFinder(files.map((f, i) => ({ names: [X3[i]!.fileName, X3[i]!.deviceFileName], file: f })))
    const ctx: LabelWorkbookContext = { findFiles: finder.findFiles, pcId: 'pc-test', now: NOW }
    const a = parseLabelWorkbook(read('x3_blind_kim.xlsx'), ctx)
    expect(a.ok).toBe(false)
    expect(a.groupQuestions).toEqual([
      {
        key: `${F1.sha256}|sect-90`,
        sha256: F1.sha256,
        fileName: F1.fileName,
        code: 'sect-90',
        label: '섹토리얼 Skew 90',
        candidates: [
          { id: 0, name: 'Skew90' },
          { id: 2, name: 'Skew90-2' }
        ],
        where: [
          "'지시' 시트 2행 D열 '그룹 (기법·Skew)'",
          "'지시' 시트 3행 AC열 '길이 잰 그룹'",
          "'지시' 시트 4행 D열 '그룹 (기법·Skew)'",
          "'검토구간' 시트 2행 C열 '그룹 (기법·Skew)'"
        ]
      }
    ])
    expect(a.errors[0]).toBe(
      "'지시' 시트 2행 D열 '그룹 (기법·Skew)': 이 파일에 '섹토리얼 Skew 90' 그룹이 2개 있습니다 (Skew90(0), Skew90-2(2)). 미리보기에서 어느 그룹인지 고릅니다"
    )
    expect(a.questionErrors).toBe(a.errors.length)
    const b = parseLabelWorkbook(read('x3_blind_kim.xlsx'), { ...ctx, groupChoices: { [`${F1.sha256}|sect-90`]: 2 } })
    expect(b.errors).toEqual([])
    expect(byRef(b, F1.sha256, '1').signal.peak?.groupId).toBe(2)
    expect(byRef(b, F1.sha256, '2').length.groupId).toBe(2)
    expect(b.groupQuestions).toEqual([])
  })
})

// ───────────────────────────── 실데이터 문맥 ─────────────────────────────

describe.runIf(HAS_X3)('실데이터 X3 4개 파일로 만든 문맥', () => {
  it('셋업의 그룹·이득이 시험 문맥과 같고, 실제 sha256 으로 가져온다', async () => {
    const entries = []
    for (const path of X3_FILES) {
      const [sha256, info, nde] = await Promise.all([hashFile(path), readViewerInfo(path), readNdeFile(path)])
      const groups = info.groups.map((g) => ({
        id: g.id,
        name: g.name,
        technique: g.technique,
        skewDeg: [...new Set(g.beams.map((b) => b.skewDeg))].length === 1 ? g.beams[0]!.skewDeg : null,
        gainDb: g.gainDb,
        referenceGainDb: g.referenceGainDb,
        referenceAmplitudePct: g.referenceAmplitudePct
      }))
      expect(groups, basename(path)).toEqual(X3_GROUPS)
      expect(info.specimen.thicknessMm).toBe(12)
      entries.push({ names: [basename(path), nde.meta.deviceFileName], file: { sha256, groups, thicknessMm: info.specimen.thicknessMm } })
    }
    const finder = makeFileFinder(entries)
    const r = parseLabelWorkbook(read('x3_blind_kim.xlsx'), { findFiles: finder.findFiles, findFileBySha256: finder.findFileBySha256, pcId: 'pc-real', now: NOW })
    expect(r.errors).toEqual([])
    const shas = entries.map((e) => e.file.sha256)
    expect(new Set(r.records.map((x) => x.sha256))).toEqual(new Set(shas))
    // 장비 원본 파일명으로 적은 줄 → 02 파일의 실제 sha256
    expect(r.records.find((x) => x.defectType === 'crack-root')?.sha256).toBe(shas[1])
    expect(bundleCheck(r).errors).toEqual([])
  })
})
