/**
 * OPD 라벨링 (OPD_조사/판단.md 7절 7단계, 실데이터가 있는 PC 에서만, 원시데이터는 복사·읽기만):
 *   1) TP14-ROOT-L 사본에 앱 기록(앵커 = 그룹·스캔 칸·빔·샘플)을 저장하고 JSON 내보내기 → 다른 저장소에 가져오기 → 같은 기록 (라벨은 OPD 에서도 됨)
 *   2) derive 는 'OmniPC 와 대조 전' 으로 막힌다 (VERIFIED 의 OPD 표가 빔 — 지금 규칙 그대로)
 *   3) 학습 내보내기는 OPD 파일을 이유(대조 전 + OPD 이유 — '대조 전'은 한 번만)와 함께 건너뛴다
 *   4) 시험 전용 allowUnverified 로 PCN 포화 지시(12 mm 판 TP01 136 IP · TP02 198 SWLF · TP04 180 SWLF — 스큐 270 섹토리얼·리니어 90·리니어 270):
 *      (가) 기록 = 보고서 구간 그대로면 상자는 기록 ±3 mm(상자 여유)에 묶인다 → 이 시험이 보이는 것은 '보고서 구간 양 끝까지 포화 신호가 있다'뿐이다
 *          (위치 정확도 시험이 아님 — 2026-10-07 검토 지적)
 *      (나) 기록을 보고서 ±10 mm 로 넓히면 데이터로 정한 양성 범위가 보고서 구간을 덮는다. 보고서보다 넓은 만큼(TP02 끝 +10 mm 등)은
 *          'Distance from Datum' 해석·스캔축 어긋남과 함께 8단계 확인 항목으로 남긴다(콘솔 기록)
 *      TP13 159 Root LF 는 25 mm 판이라 시방서 표 13 범위 밖 — allowUnverified 여도 진폭 기준이 없어 막힌다(두께 이유).
 *      PCN 은 기준 이득이 0 이라 Ref 를 모르므로(null) 시험용 Ref 80 %FSH 를 준다 — 포화 지시라 문턱과 무관하게 양성이다.
 *   5) 대조를 마친 것처럼(시험 전용으로 verified 를 켜고 blockReason 을 지움) 내보내면 meta.json·manifest 에 형식·읽기 규칙·추정 눈금이 들어간다
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runTrainingExport, type TrainingSourceFile } from '@core/labels/export'
import { readOpdViewerChunk, readOpdViewerInfo, readStoredViewerChunk } from '@core/opd/viewer'
import { createAppService, type AppService } from '@core/service'
import { DEFAULT_TRAINING_SET_RULE, type TrainingExportRequest } from '@shared/api'
import { createGateCscan, fillGateCscan, findGate, foldDepth, type ViewerGroup, type ViewerVolumeChunk } from '@shared/imaging'
import { LABEL_COORD_RULES_VERSION, newIndicationRecord, newReviewInterval, type AnchorPoint, type IndicationRecord, type LabelSetKey, type MetallurgicalType } from '@shared/labels'
import { amplitudeFromChunks, anchorToPoint, derivedFromPoints, runDerive } from '@shared/labels/derive'
import { OPD_FILES, opdPath } from '../../paths'
import { createOpdStore } from './viewerKit'

const TP14 = opdPath(OPD_FILES.tp14RootL)
const HAS_TP14 = existsSync(TP14)

const work = mkdtempSync(join(tmpdir(), 'paut-opd-labels-'))
const storeA = join(work, '저장소A')
const storeB = join(work, '저장소B')
const outParent = join(work, '학습')
let a: AppService
let b: AppService

const LABELER = 'kim-l2'
const UUID = '00000000-0000-4000-8000-0000000000a1'
const UNVERIFIED = 'OmniPC 와 대조 전인 그룹이라 자동 변환을 막습니다.'

afterAll(() => {
  a?.close()
  b?.close()
  rmSync(work, { recursive: true, force: true })
})

/** 화면에서 '최대 진폭' 점을 찍은 것처럼: 그 칸·빔의 게이트 A 최대 샘플에 앵커 */
function peakAnchorRecord(g: ViewerGroup, chunk: ViewerVolumeChunk, thicknessMm: number, set: LabelSetKey, scanIndex: number, beam: number): IndicationRecord {
  const gate = findGate(g, g.cscanGateId)!
  const cs = createGateCscan(g, gate.id)
  fillGateCscan(cs, g, gate, chunk)
  const sample = cs.peakSample[scanIndex * g.shape[1] + beam]!
  expect(sample).toBeGreaterThanOrEqual(0)
  const anchor = { groupId: g.id, scanIndex, beam, sample, coordRulesVersion: LABEL_COORD_RULES_VERSION, groupVerified: g.verified }
  const pos = anchorToPoint(g, anchor, thicknessMm)!
  const point: AnchorPoint = { id: 'p1', role: 'peak', anchor, leg: pos.leg, displayGainDb: 0, mm: { scanMm: pos.scanMm, vMm: pos.vMm, depthMm: pos.depthMm } }
  return newIndicationRecord({
    ...set,
    uuid: UUID,
    defectType: 'lof-root',
    anchors: [point],
    derived: derivedFromPoints([point], LABEL_COORD_RULES_VERSION)!,
    note: 'OPD 시험 기록 (TP14 278 mm · 65°)'
  })
}

describe.skipIf(!HAS_TP14)('OPD 라벨: 기록 저장 · JSON 왕복 · derive 막힘 · 학습 내보내기 건너뜀 (TP14-ROOT-L)', () => {
  let sha256 = ''
  let fileId = 0
  let set: LabelSetKey
  let rec: IndicationRecord
  let g: ViewerGroup
  let chunk: ViewerVolumeChunk
  let thicknessMm = 0

  beforeAll(async () => {
    sha256 = createOpdStore(storeA, [TP14])[0]!.sha256
    createOpdStore(storeB, [TP14])
    mkdirSync(outParent)
    a = createAppService({ settingsPath: join(work, 'ud-a', 'settings.json') })
    b = createAppService({ settingsPath: join(work, 'ud-b', 'settings.json') })
    await a.setStoreRoot(storeA)
    await b.setStoreRoot(storeB)
    fileId = (await a.listFiles({ limit: 10 })).items[0]!.id
    const open = await a.viewerOpen(fileId)
    g = open.info.groups[0]!
    thicknessMm = open.info.specimen.thicknessMm!
    chunk = await a.viewerChunk(fileId, open.key, g.id, 0, g.shape[0])
    set = { sha256, labelerId: LABELER, guidelineVersion: 'v1', readingStage: 'blind' }
    rec = peakAnchorRecord(g, chunk, thicknessMm, set, 278, 20)
    await a.labels.registerLabeler({ id: LABELER, name: '김 판독', qualification: 'UT Level II', organization: null })
    await a.labels.setSession({ labelerId: LABELER })
  }, 60_000)

  it('앱 기록(앵커)을 저장한다 — 앵커 = (그룹 0, 스캔 칸 278, 빔 20, 샘플), 찍을 때 대조 전, mm = 화면 측정값 자리', async () => {
    expect(rec.anchors[0]!.anchor).toMatchObject({ groupId: 0, scanIndex: 278, beam: 20, groupVerified: false })
    // 65° 빔 게이트 A 최대 = OmniPC 화면 ViA^ 2.21 · DA^ 22.45 자리 (±0.5 mm)
    expect(Math.abs(rec.anchors[0]!.mm!.vMm - 2.21)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(rec.anchors[0]!.mm!.depthMm - 22.45)).toBeLessThanOrEqual(0.5)
    expect(rec.derived).toMatchObject({ scanStartMm: 278, scanEndMm: 278 })
    await a.labels.saveRecord(rec)
    const saved = (await a.labels.listRecords({ sha256 })).filter((r) => r.uuid === UUID)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.anchors).toEqual(rec.anchors)
    expect(saved[0]!.derived).toEqual(rec.derived)
    expect(saved[0]!.coordSource).toBe('app-anchor')
  })

  it('JSON 내보내기 → 다른 저장소(같은 OPD 사본)에 가져오기 → 같은 기록', async () => {
    const out = join(work, 'labels.json')
    await a.labels.exportJsonFile({ kind: 'all' }, out, '0.1.0-test')
    const doc = JSON.parse(readFileSync(out, 'utf8')) as { records: IndicationRecord[] }
    expect(doc.records.map((r) => r.uuid)).toContain(UUID)
    const imp = await b.labels.importJsonFile(out)
    expect(imp).toBeTruthy()
    const got = (await b.labels.listRecords({ sha256 })).find((r) => r.uuid === UUID)!
    const mine = (await a.labels.listRecords({ sha256 })).find((r) => r.uuid === UUID)!
    expect(got).toBeTruthy()
    for (const k of ['sha256', 'labelerId', 'readingStage', 'kind', 'defectType', 'coordSource', 'anchors', 'derived', 'revision', 'versions', 'note'] as const) {
      expect(got[k], k).toEqual(mine[k])
    }
    // 같은 파일을 다시 가져와도 그대로(멱등)
    await b.labels.importJsonFile(out)
    expect((await b.labels.listRecords({ sha256 })).filter((r) => r.uuid === UUID)).toHaveLength(1)
  })

  it('derive 는 대조 전으로 막힌다 (형식 이유 blockReason 을 넘겨도 대조 전 판정이 먼저)', () => {
    const run = runDerive({
      sha256,
      thicknessMm,
      weld: null,
      groups: [{ group: g, amplitude: amplitudeFromChunks(g, [chunk]), blockReason: g.blockReason ?? null }],
      labelSet: set,
      records: [rec]
    })
    expect(run.result.groups).toEqual([expect.objectContaining({ groupId: 0, verified: false, blocked: UNVERIFIED })])
    expect(run.result.scenes).toEqual([])
  })

  it('학습 내보내기는 OPD 파일을 이유와 함께 건너뛴다 (진폭을 읽지 않음)', async () => {
    const req: TrainingExportRequest = {
      sha256s: [sha256],
      setRule: { ...DEFAULT_TRAINING_SET_RULE, blindLabelerId: LABELER },
      options: { amplitude: true, images: true, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep', fixedExportedAt: '2026-10-07T12:00:00+09:00' }
    }
    const r = await a.labels.exportTraining(req, outParent, '0.1.0-test')
    expect(r.files).toHaveLength(1)
    const f = r.files[0]!
    expect([f.status, f.folder]).toEqual(['skipped', null])
    expect(f.reason).toContain(`모든 그룹이 막혔습니다: ${UNVERIFIED}`)
    // derive 이유가 이미 '대조 전'이라 형식 이유의 '대조 전' 항목은 빼고 붙인다 (같은 말 두 번 X)
    expect(f.reason).toContain('OPD 파일이라 자동 변환·학습 내보내기를 막습니다: 진폭 눈금 추정(raw 255 = 250 %, 캡처 O1·O2 대조 전)')
    expect(f.reason).not.toContain('시편 형상 모름')
    expect(f.reason).not.toContain('OmniPC 대조 전(OPD')
    expect(f.groups).toEqual([{ groupId: 0, name: 'PA 1', blocked: expect.stringContaining('게이트 A 일치율을 판정하지 못함') }])
    expect(r.totals).toMatchObject({ files: 1, exported: 0, skipped: 1, blockedGroups: 1 })
    const m = JSON.parse(readFileSync(join(r.path, 'manifest.json'), 'utf8'))
    expect(m.files).toEqual([])
    expect(m.skipped).toEqual([expect.objectContaining({ sha256, reason: f.reason })])
    expect(m.blockedGroups).toEqual([expect.objectContaining({ sha256, groupId: 0, reason: expect.stringContaining(UNVERIFIED) })])
  })
})

// ───────────────────────────── allowUnverified (시험 전용): PCN 포화 지시 ─────────────────────────────

interface PcnCase {
  file: string
  /** PCN 보고서: 위치(시작) · 길이 · 깊이 · TWE · 종류 (3_화면대조.md 3절) */
  startMm: number
  lengthMm: number
  depthMm: number
  tweMm: number
  type: MetallurgicalType
  label: string
}

const PCN: PcnCase[] = [
  { file: '02_라벨완료/PCN교육/TP01/TP01-ROOT-R-01.opd', startMm: 136, lengthMm: 22, depthMm: 10, tweMm: 2, type: 'incomplete-penetration', label: 'TP01 136 IP (섹토리얼 · 스큐 270)' },
  { file: '02_라벨완료/PCN교육/TP02/TP02-SW-L-01.opd', startMm: 198, lengthMm: 25, depthMm: 3, tweMm: 3, type: 'lof-sidewall', label: 'TP02 198 SWLF (리니어 · 스큐 90)' },
  { file: '02_라벨완료/PCN교육/TP04/TP04-SW-R-01.opd', startMm: 180, lengthMm: 24, depthMm: 3, tweMm: 3, type: 'lof-sidewall', label: 'TP04 180 SWLF (리니어 · 스큐 270)' }
]
const TP13_ROOT_R = '02_라벨완료/PCN교육/TP13/TP13-ROOT-R-01.opd'
const TEST_REF_PCT = 80
const TOL_MM = 3
/** 기록 구간을 보고서보다 넓히는 폭 (데이터로 양성 범위를 정하게) */
const WIDEN_MM = 10

/** 보고서 값으로 적은 전문가 기록 (V 모름, 스캔 구간은 보고서 ± widenMm) + 검토 구간 전체 */
async function pcnRun(file: string, c: { startMm: number; lengthMm: number; depthMm: number; tweMm: number; type: MetallurgicalType }, widenMm = 0) {
  const path = opdPath(file)
  const info = await readOpdViewerInfo(path)
  const g = info.groups[0]!
  const chunk = await readOpdViewerChunk(path, g, 0, g.shape[0])
  const t = info.specimen.thicknessMm!
  const set: LabelSetKey = { sha256: 'b'.repeat(64), labelerId: 'pcn-report', guidelineVersion: 'v1', readingStage: 'reconciled' }
  const rec = newIndicationRecord({
    ...set,
    uuid: '00000000-0000-4000-8000-0000000000b1',
    defectType: c.type,
    derived: { scanStartMm: c.startMm - widenMm, scanEndMm: c.startMm + c.lengthMm + widenMm, vMinMm: null, vMaxMm: null, depthTopMm: c.depthMm, depthBottomMm: Math.min(t, c.depthMm + c.tweMm) },
    length: { valueMm: c.lengthMm + 2 * widenMm, method: 'eval-level' }
  })
  const iv = newReviewInterval({ ...set, uuid: '00000000-0000-4000-9000-0000000000b1', kind: 'reviewed', scanStartMm: 0, scanEndMm: (g.shape[0] - 1) * g.scan.resolutionMm })
  const run = runDerive({
    sha256: set.sha256,
    thicknessMm: t,
    weld: null,
    groups: [{ group: g, amplitude: amplitudeFromChunks(g, [chunk]), blockReason: g.blockReason ?? null, refPctOverride: TEST_REF_PCT }],
    labelSet: set,
    records: [rec],
    reviewIntervals: [iv],
    rules: { allowUnverified: true }
  })
  return { info, g, run, t }
}

for (const c of PCN) {
  describe.skipIf(!existsSync(opdPath(c.file)))(`allowUnverified (시험 전용): PCN 포화 지시 ${c.label}`, () => {
    it(`보고서 구간 ${c.startMm} ~ ${c.startMm + c.lengthMm} mm 양 끝까지 포화 신호가 있다 (기록 = 보고서 구간, 상자는 기록 ±${TOL_MM} mm 여유에 묶임 — 위치 정확도 시험 아님)`, async () => {
      const { g, run, t } = await pcnRun(c.file, c)
      const res = run.result
      expect(g.verified).toBe(false)
      expect(res.groups[0]!.blocked).toBeNull()
      const pos = res.scenes.filter((s) => s.state === 'positive')
      expect(pos.length).toBeGreaterThan(0)
      const end = c.startMm + c.lengthMm
      const first = pos[0]!.scanMm
      const last = pos.at(-1)!.scanMm
      expect(Math.abs(first - c.startMm), `첫 양성 ${first}`).toBeLessThanOrEqual(TOL_MM)
      expect(Math.abs(last - end), `끝 양성 ${last}`).toBeLessThanOrEqual(TOL_MM)
      // 모든 양성 장면에 상자가 있고 (포화 지시), 상자 칸들은 그 장면 스캔 자리
      for (const s of pos) {
        const boxes = s.objects.filter((o) => o.status === 'positive' && o.box)
        expect(boxes.length, `${s.scanMm} mm`).toBeGreaterThan(0)
        expect(s.scanMm).toBeGreaterThanOrEqual(c.startMm - TOL_MM)
        expect(s.scanMm).toBeLessThanOrEqual(end + TOL_MM)
      }
      // C-scan 상자 (기록 × 그룹)도 같은 범위, 최대 = 포화 (250 % 추정 눈금)
      const cb = res.records[0]!.cscanBoxes
      expect(cb).toHaveLength(1)
      expect(Math.abs(cb[0]!.scanStartMm - c.startMm)).toBeLessThanOrEqual(TOL_MM)
      expect(Math.abs(cb[0]!.scanEndMm - end)).toBeLessThanOrEqual(TOL_MM)
      expect(cb[0]!.peakPct).toBe(250)
      // 가장 센 상자의 최대 칸을 접은 깊이가 보고서 깊이 ~ 깊이 + TWE 의 ±2 mm 안
      let best: { pct: number; depth: number } | null = null
      for (const s of pos) {
        for (const o of s.objects) {
          if (!o.box || o.status !== 'positive') continue
          const bm = g.beams[o.box.peakBeam]!
          const unfolded = ((bm.t0Us + o.box.peakSample * g.ultrasound.resolutionUs) * bm.velocityMps) / 2000 * Math.cos((bm.angleDeg * Math.PI) / 180)
          if (!best || o.box.peakPct > best.pct) best = { pct: o.box.peakPct, depth: foldDepth(unfolded, t).depthMm }
        }
      }
      expect(best).not.toBeNull()
      expect(best!.depth).toBeGreaterThanOrEqual(c.depthMm - 2)
      expect(best!.depth).toBeLessThanOrEqual(c.depthMm + c.tweMm + 2)
    })

    it(`기록을 보고서 ±${WIDEN_MM} mm 로 넓혀도 데이터로 정한 양성 범위가 보고서 구간을 덮는다 (넓은 만큼은 8단계 확인 항목)`, async () => {
      const { run } = await pcnRun(c.file, c, WIDEN_MM)
      const pos = run.result.scenes.filter((s) => s.state === 'positive')
      expect(pos.length).toBeGreaterThan(0)
      const end = c.startMm + c.lengthMm
      const first = pos[0]!.scanMm
      const last = pos.at(-1)!.scanMm
      // 보고서 구간 양 끝(±3 mm) 까지 양성이 이어진다 — 데이터가 정한 범위
      expect(first, `첫 양성 ${first}`).toBeLessThanOrEqual(c.startMm + TOL_MM)
      expect(last, `끝 양성 ${last}`).toBeGreaterThanOrEqual(end - TOL_MM)
      console.info(`[OPD PCN ±${WIDEN_MM} mm] ${c.label}: 보고서 ${c.startMm}~${end} mm, 데이터 양성 ${first}~${last} mm (시작 ${first - c.startMm >= 0 ? '+' : ''}${first - c.startMm}, 끝 ${last - end >= 0 ? '+' : ''}${last - end} mm)`)
    })
  })
}

describe.skipIf(!existsSync(opdPath(TP13_ROOT_R)))('allowUnverified (시험 전용): TP13 159 Root LF — 25 mm 판은 시방서 표 13 범위 밖', () => {
  it('대조 전은 넘어가지만 진폭 기준(표 13)이 없어 두께 이유로 막힌다', async () => {
    const { run, t } = await pcnRun(TP13_ROOT_R, { startMm: 159, lengthMm: 22, depthMm: 23, tweMm: 2, type: 'lof-root' })
    expect(t).toBe(25)
    expect(run.result.groups[0]!.blocked).toBe('기준 감도(Ref)를 추정할 수 없거나 두께가 시방서 표 13 범위 밖이라 진폭 기준을 정할 수 없습니다.')
    expect(run.result.scenes).toEqual([])
  })
})

// ───────────────────────────── 대조를 마친 뒤의 내보내기 모양 (시험 전용으로 verified 를 켬) ─────────────────────────────

const SEC25 = opdPath(OPD_FILES.sec25sr1_01)

describe.skipIf(!existsSync(SEC25))('학습 내보내기 meta.json·manifest 의 OPD 칸 (8단계 대조 뒤 모양, 시험 전용)', () => {
  it('nde 칸에 formatFamily·읽기 규칙·스캔축 동기·추정 눈금, 그룹에 자체 점검, manifest files[].format', async () => {
    const sha = 'c'.repeat(64)
    const set: LabelSetKey = { sha256: sha, labelerId: 'park-l3', guidelineVersion: 'v1', readingStage: 'final' }
    const rec = newIndicationRecord({
      ...set,
      uuid: '00000000-0000-4000-8000-0000000000c1',
      defectType: 'slag',
      derived: { scanStartMm: 100, scanEndMm: 130, vMinMm: -10, vMaxMm: 10, depthTopMm: 1, depthBottomMm: 6 },
      length: { valueMm: 30, method: 'eval-level' }
    })
    const src: TrainingSourceFile = {
      sha256: sha,
      fileName: 'sr1_01.opd',
      specimenId: 'SEC25-2',
      weldId: null,
      split: 'train',
      path: SEC25,
      selection: { candidates: ['x'], chosen: 'x', reason: '시험' },
      labelSet: set,
      labeler: { id: 'park-l3', name: '박 판독', qualification: null, organization: null },
      records: [rec],
      reviewIntervals: [newReviewInterval({ ...set, uuid: '00000000-0000-4000-9000-0000000000c1', kind: 'reviewed', scanStartMm: 0, scanEndMm: 800 })],
      observations: [],
      alignment: null,
      physicalDefects: [],
      pendingConflicts: 0
    }
    const r = await runTrainingExport({
      operationId: 'TX-opd-meta',
      outDir: join(work, 'opd-meta'),
      files: [src],
      options: { amplitude: false, images: false, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep' },
      setRule: DEFAULT_TRAINING_SET_RULE,
      blindModeLabelerId: null,
      split: { unit: 'specimen', testLocked: false, testLockedAt: null },
      appVersion: '0.1.0-test',
      pcId: 'pc-test',
      exportedAt: '2026-10-07T12:00:00+09:00',
      reader: {
        // 시험 전용: 대조를 마친 조합처럼 verified 를 켜고 형식 이유를 지운다 (실제 VERIFIED 표는 비어 있음)
        info: async (p) => {
          const info = await readOpdViewerInfo(p)
          for (const g of info.groups) {
            g.verified = true
            g.blockReason = null
            g.blockReasons = []
          }
          return info
        },
        chunk: (p, g, a, n) => readStoredViewerChunk(p, g, a, n)
      }
    })
    expect(r.files.map((f) => [f.status, f.reason])).toEqual([['exported', null]])
    const meta = JSON.parse(readFileSync(join(r.path, r.files[0]!.folder!, 'meta.json'), 'utf8'))
    expect(meta.nde).toEqual({
      formatFamily: 'opd',
      version: 'OPD · MXU - 4.4R4', // 인천 SEC25-2 는 MXU 4.4R4 (PCN 은 4.4R5)
      reader: { name: 'opd-structure', version: 4 },
      scanSync: 'encoder',
      ampScale: { rawMax: 255, unitMax: 250, estimated: true }
    })
    expect(meta.groups[0]).toMatchObject({ verified: true, blocked: null, ampScale: { rawMax: 255, unitMax: 250, estimated: true }, formatBlockReason: null })
    expect(meta.groups[0].selfCheck).toMatchObject({ passed: { gateA: true, snell: true } })
    const m = JSON.parse(readFileSync(join(r.path, 'manifest.json'), 'utf8'))
    expect(m.files[0].format).toEqual({ ...meta.nde })
  })
})
