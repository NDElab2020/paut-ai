/**
 * 기록 → 학습 라벨 계산 — X3 12T-SV 실데이터 4개 (원시데이터는 읽기만).
 *
 * 결함정보 docx 11건(scripts/label-template/prefill_x3.json 'physical' = labels.py 와 같은 목록)으로 '가설 기록'을 만든다:
 *   스캔 = docx 위치 ± 10 mm, 실제 깊이 0 ~ 12 (두께 전체), V = 개선 범위(윗면 개선면 반폭 ± 6.77 mm).
 * 가설 기록은 위치·종류만 아는 문서로 만든 넓은 영역이라 전문가 기록이 아니다. 파이프라인 확인용이다(막힌 그룹 없음, 수치 보고).
 * 정답 확인은 부록 E(지침서_v1_부록_X3예시.md)의 그룹·레그·V·깊이로 만든 '좁은 기록'으로 한다(근사값, 전문가 기록 전):
 *   (b) 부록 E 의 '보임' 점마다 그 (그룹, 레그) 관측이 보임이고 최대 칸이 그 점 ± 1 mm 안.
 *       결함을 보지 못하는 그룹(#02 S90, #03 S270, #06 S270, #10 S90)에는 양성·약한 양성 객체가 없음(형상 띠를 결함으로 잡지 않음).
 *       양성 상자의 최대 칸은 기록 영역 ± (boxMarginMm + regionPadMm) 안. #04(기록 기준 미만)·#11(기본 그림에서 안 보임)은 양성 없음.
 *       포화 6건(#02·05·06·07·08·09)은 길이 '제안 불가(포화)'.
 *   Cap on 파일(01·02·04)의 높은 각도 띠가 형상 에코 후보로 잡히고, Cap off(03)는 덜 잡히는지.
 *   (d) 같은 입력 두 번 → 같은 출력 (JSON 비교)
 *   (e) 성능: 한 파일 전체 장면 라벨 계산 시간
 * PAUT_DERIVE_REPORT=<json 경로> 를 주면 수치 요약을 쓴다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import { bevelHalfWidth, createGateCscan, fillGateCscan, findGate, rawToPercent, type GateCscan, type ViewerFileInfo, type ViewerVolumeChunk } from '@shared/imaging'
import { newIndicationRecord, newReviewInterval, type IndicationRecord, type MetallurgicalType } from '@shared/labels'
import {
  amplitudeFromChunks,
  echoCandidateRecordFields,
  prepareDerive,
  runDerive,
  suggestGeometricEchoes,
  type DeriveFileInput,
  type DeriveRun,
  type EchoSuggestion
} from '@shared/labels/derive'
import { APP_ROOT, X3_FILES } from '../paths'

const HAS = X3_FILES.every((f) => existsSync(f))
const T = 12
const REPORT = process.env['PAUT_DERIVE_REPORT']

interface PhysRow {
  _docx: { file: string; text: string; positionMm: number }
  physicalDefectId: string
  designType: MetallurgicalType
  centerMm: number
}

const PREFILL = JSON.parse(readFileSync(resolve(APP_ROOT, 'scripts/label-template/prefill_x3.json'), 'utf8')) as { sheets: { physical: PhysRow[] } }
const DOCX = PREFILL.sheets.physical

interface Loaded {
  path: string
  name: string
  info: ViewerFileInfo
  chunks: ViewerVolumeChunk[]
  cscans: GateCscan[]
}

const files = new Map<string, Loaded>()
const report: Record<string, unknown> = {}

function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function sha(name: string): string {
  // 시험용 가짜 sha256 (파일마다 다르게). 실제 해시는 catalog 가 낸다
  const hex = Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64)
  return hex
}

function hypothesisRecords(L: Loaded): IndicationRecord[] {
  const hw = bevelHalfWidth(L.info.specimen.weld!, T, 0)
  return DOCX.map((d, j) => ({ d, j }))
    .filter(({ d }) => `${d._docx.file}.nde` === L.name)
    .map(({ d, j }) =>
      newIndicationRecord({
        uuid: uuidOf(j + 1),
        sha256: sha(L.name),
        labelerId: 'hypothesis',
        guidelineVersion: 'v1',
        readingStage: 'reconciled',
        externalRef: `#${String(j + 1).padStart(2, '0')}`,
        defectType: d.designType,
        physicalDefectId: d.physicalDefectId,
        derived: { scanStartMm: d.centerMm - 10, scanEndMm: d.centerMm + 10, vMinMm: -hw, vMaxMm: hw, depthTopMm: 0, depthBottomMm: T },
        note: `가설 기록: docx ${d._docx.text} ${d._docx.positionMm} mm`
      })
    )
}

function inputOf(L: Loaded, records: IndicationRecord[]): DeriveFileInput {
  return {
    sha256: sha(L.name),
    thicknessMm: L.info.specimen.thicknessMm,
    outerDiameterMm: null,
    weld: L.info.specimen.weld,
    groups: L.info.groups.map((g) => ({ group: g, amplitude: amplitudeFromChunks(g, L.chunks) })),
    records,
    reviewIntervals: [
      newReviewInterval({ uuid: uuidOf(900), sha256: sha(L.name), labelerId: 'hypothesis', guidelineVersion: 'v1', readingStage: 'reconciled', kind: 'reviewed', scanStartMm: 0, scanEndMm: 300 })
    ]
  }
}

function r2(x: number): number {
  return Math.round(x * 100) / 100
}

describe.skipIf(!HAS)('기록 → 학습 라벨 (X3 실데이터)', () => {
  beforeAll(async () => {
    for (const path of X3_FILES) {
      const info = await readViewerInfo(path)
      const chunks: ViewerVolumeChunk[] = []
      const cscans: GateCscan[] = []
      for (const g of info.groups) {
        const c = await readViewerChunk(path, g, 0, g.shape[0])
        expect(c.scanCount).toBe(g.shape[0])
        chunks.push(c)
        const gate = findGate(g, g.cscanGateId)!
        const cs = createGateCscan(g, gate.id)
        fillGateCscan(cs, g, gate, c)
        cscans.push(cs)
      }
      files.set(basename(path), { path, name: basename(path), info, chunks, cscans })
    }
  })

  it('결함정보 11건: 가설 기록(넓은 영역) → 관측 표·장면 라벨 (파이프라인 · 수치 보고)', () => {
    expect(DOCX).toHaveLength(11)
    const rows: unknown[] = []
    let withVisible = 0
    const ms: Record<string, number> = {}
    for (const L of files.values()) {
      const recs = hypothesisRecords(L)
      const t0 = performance.now()
      const run = runDerive(inputOf(L, recs))
      ms[L.name] = r2(performance.now() - t0)
      const out = run.result
      expect(out.groups.every((g) => g.blocked === null)).toBe(true)
      for (const r of recs) {
        const obs = out.observations.filter((o) => o.recordUuid === r.uuid)
        expect(new Set(obs.map((o) => o.groupId))).toEqual(new Set(L.info.groups.map((g) => g.id)))
        if (obs.some((o) => o.status === 'visible')) withVisible++
        const dr = out.records.find((x) => x.uuid === r.uuid)!
        const ls = dr.lengthSuggestion
        rows.push({
          ref: r.externalRef,
          file: L.name,
          type: r.defectType,
          positiveScenes: out.scenes.filter((s) => s.objects.some((o) => o.recordUuid === r.uuid && o.status === 'positive')).length,
          legs: obs.map((o) => `g${o.groupId}L${o.leg}:${o.status}:${o.search ? r2(o.search.maxAmplitudePct) : '-'}`),
          lengthSuggestion: ls
            ? { available: ls.available, reason: ls.reason, groupId: ls.groupId, angleDeg: ls.angleDeg, start: ls.scanStartMm, end: ls.scanEndMm, length: ls.lengthMm, peak: ls.peakPct, dr: ls.dynamicRangeDb, edge: ls.reachedEdge, check: ls.needsCheck }
            : null,
          cscanBoxes: dr.cscanBoxes.length
        })
      }
      report[`scenes_${L.name}`] = out.stats
    }
    report['records'] = rows
    report['deriveMsNoEcho'] = ms
    report['withVisible'] = withVisible
    // 가설 영역은 두께 전체·개선 폭이라 형상 띠가 함께 들어온다 → 띠 위 문턱(바탕 + 6 dB)에 걸려 보이지 않는 기록이 있을 수 있다
    expect(withVisible).toBeGreaterThanOrEqual(8)
  })

  it('부록 E 로 만든 좁은 기록: 보이는 점 · 보지 못하는 그룹 · 상자 위치 · 포화', () => {
    interface Spec {
      ref: string
      file: string
      type: MetallurgicalType
      u: [number, number]
      v: [number, number]
      d: [number, number]
    }
    // 부록 E 표의 그림 위치·V·깊이 둘레로 잡은 근사 영역 (전문가 기록 전)
    const SPECS: Spec[] = [
      { ref: '#01', file: '12T-SV-01-Cap on.nde', type: 'crack-toe', u: [35, 46], v: [8, 12], d: [0, 2] },
      { ref: '#02', file: '12T-SV-01-Cap on.nde', type: 'lof-unspecified', u: [128, 142], v: [3, 8], d: [2, 8] },
      { ref: '#03', file: '12T-SV-01-Cap on.nde', type: 'crack-sidewall', u: [182, 208], v: [-5, -3], d: [6, 10] },
      { ref: '#04', file: '12T-SV-01-Cap on.nde', type: 'slag', u: [240, 250], v: [-5, 1], d: [1, 4] },
      { ref: '#05', file: '12T-SV-02-Cap on.nde', type: 'crack-root', u: [148, 170], v: [2, 5], d: [9.5, 12] },
      { ref: '#06', file: '12T-SV-02-Cap on.nde', type: 'lof-unspecified', u: [214, 226], v: [-5, -3.5], d: [4, 7.5] },
      { ref: '#07', file: '12T-SV-03-Cap off.nde', type: 'crack-sidewall', u: [58, 76], v: [3, 6], d: [2, 7] },
      { ref: '#08', file: '12T-SV-03-Cap off.nde', type: 'incomplete-penetration', u: [140, 160], v: [-1, 2.5], d: [10, 12] },
      { ref: '#09', file: '12T-SV-03-Cap off.nde', type: 'lof-unspecified', u: [242, 256], v: [-6, -4.5], d: [0.5, 5] },
      { ref: '#10', file: '12T-SV-04-Cap on.nde', type: 'crack-root', u: [150, 170], v: [4, 5], d: [7.5, 12] },
      { ref: '#11', file: '12T-SV-04-Cap on.nde', type: 'porosity-unspecified', u: [209, 213], v: [4.5, 5.5], d: [3, 3.6] }
    ]
    // 부록 E '보임' 점: [지시, 그룹(0 = S90, 1 = S270), 레그, V, 실제 깊이]
    const SEEN: Array<[string, number, number, number, number]> = [
      ['#01', 0, 3, 8.9, 0.5],
      ['#01', 1, 2, 11.6, 1.4],
      ['#02', 1, 2, 5.7, 4.8],
      ['#03', 0, 2, -3.9, 8.1],
      ['#05', 0, 2, 2.5, 11.3],
      ['#05', 1, 2, 4.4, 11.4],
      ['#06', 0, 2, -4.2, 5.7],
      ['#07', 0, 3, 3.6, 3.0],
      ['#07', 1, 2, 5.5, 5.6],
      ['#08', 0, 2, -0.9, 12.0],
      ['#08', 1, 2, 2.2, 10.4],
      ['#09', 0, 2, -5.1, 4.4],
      ['#09', 1, 2, -5.4, 0.6],
      ['#10', 1, 1, 4.5, 9.3]
    ]
    const BLIND: Array<[string, number]> = [
      ['#02', 0],
      ['#03', 1],
      ['#06', 1],
      ['#10', 0]
    ]
    const summary: Record<string, unknown> = {}
    const saturated: string[] = []
    let positives = 0
    let outside = 0
    for (const L of files.values()) {
      const recs = SPECS.map((x, j) => ({ x, j }))
        .filter(({ x }) => x.file === L.name)
        .map(({ x, j }) =>
          newIndicationRecord({
            uuid: uuidOf(100 + j),
            sha256: sha(L.name),
            labelerId: 'hypothesis',
            guidelineVersion: 'v1',
            readingStage: 'reconciled',
            externalRef: x.ref,
            defectType: x.type,
            derived: { scanStartMm: x.u[0], scanEndMm: x.u[1], vMinMm: x.v[0], vMaxMm: x.v[1], depthTopMm: x.d[0], depthBottomMm: x.d[1] },
            length: { valueMm: x.u[1] - x.u[0], method: 'eval-level' }
          })
        )
      const run = runDerive(inputOf(L, recs))
      const out = run.result
      const R = run.ctx.rules
      for (const r of recs) {
        const ref = r.externalRef!
        const pr = run.ctx.records.find((p) => p.record.uuid === r.uuid)!
        const reg = pr.region
        // 보이는 점
        for (const [sref, gid, leg, v, d] of SEEN) {
          if (sref !== ref) continue
          const l = run.observations.get(`${r.uuid}|${gid}`)!.legs.find((x) => x.leg === leg)!
          expect(l.status, `${ref} g${gid} L${leg}`).toBe('visible')
          const geom = run.ctx.groups.find((g) => g.id === gid)!.geom!
          const c = l.peak!.beam * geom.nt + l.peak!.sample
          expect(Math.abs(geom.vMm[c]! - v), `${ref} g${gid} V`).toBeLessThanOrEqual(1)
          expect(Math.abs(geom.depthMm[c]! - d), `${ref} g${gid} 깊이`).toBeLessThanOrEqual(1)
        }
        // 보지 못하는 그룹
        for (const [bref, gid] of BLIND) {
          if (bref !== ref) continue
          const objs = out.scenes.filter((s) => s.groupId === gid).flatMap((s) => s.objects.filter((o) => o.recordUuid === r.uuid))
          expect(objs.filter((o) => o.status === 'positive' || o.status === 'weak'), `${ref} g${gid}`).toEqual([])
        }
        // 양성 상자의 최대 칸은 기록 영역 ± (boxMarginMm + regionPadMm) 안
        const m = R.boxMarginMm + R.regionPadMm + 1e-6
        for (const s of out.scenes) {
          for (const o of s.objects) {
            if (o.recordUuid !== r.uuid || o.status !== 'positive' || !o.box) continue
            positives++
            const geom = run.ctx.groups.find((g) => g.id === s.groupId)!.geom!
            const c = o.box.peakBeam * geom.nt + o.box.peakSample
            const v = geom.vMm[c]!
            const d = geom.depthMm[c]!
            if (v < reg.vMinMm! - m || v > reg.vMaxMm! + m || d < reg.depthTopMm - m || d > reg.depthBottomMm + m) outside++
          }
        }
        const ls = out.records.find((x) => x.uuid === r.uuid)!.lengthSuggestion
        if (ls && !ls.available && ls.reason === 'saturated') saturated.push(ref)
        summary[ref] = {
          positiveScenes: out.scenes.filter((s) => s.objects.some((o) => o.recordUuid === r.uuid && o.status === 'positive')).length,
          legs: (out.records.find((x) => x.uuid === r.uuid)!.groups ?? []).map((g) => g.legs.map((l) => `g${g.groupId}L${l.leg}:${l.status}${l.seed ? `/${l.seed}` : ''}`)),
          length: ls ? { available: ls.available, reason: ls.reason, start: ls.scanStartMm, end: ls.scanEndMm, angle: ls.angleDeg, check: ls.needsCheck } : null
        }
        if (ref === '#04' || ref === '#11') {
          expect(out.scenes.some((s) => s.objects.some((o) => o.recordUuid === r.uuid && o.status === 'positive')), ref).toBe(false)
        }
      }
      report[`narrow_${L.name}`] = out.stats
    }
    report['narrow'] = { summary, positives, outside, saturated }
    expect(positives).toBeGreaterThan(100)
    expect(outside).toBe(0)
    expect(saturated.sort()).toEqual(['#02', '#05', '#06', '#07', '#08', '#09'])
  })

  it('형상 에코 후보: Cap on(01·02·04) 높은 각도 띠가 루트 자리 후보로 길게 잡히고, Cap off(03)는 덜 잡힌다', () => {
    const summary: Record<string, unknown> = {}
    const lengthByFile = new Map<string, number>()
    for (const L of files.values()) {
      const t0 = performance.now()
      const ctx = prepareDerive(inputOf(L, hypothesisRecords(L)))
      const sug: EchoSuggestion = suggestGeometricEchoes(ctx)
      const ms = performance.now() - t0
      const root = sug.candidates.filter((c) => c.zone === 'root')
      const total = root.reduce((s, c) => s + c.lengthMm + 1, 0)
      // 지침서 8.1 의 '높은 각도 띠': 루트 자리, 레그 1·2, 형상 빔이 62° 이상
      const high = root.filter((c) => c.leg <= 2 && c.angleMaxDeg >= 62)
      const highTotal = high.reduce((s, c) => s + c.lengthMm + 1, 0)
      lengthByFile.set(L.name, highTotal)
      const byGroup = [0, 1].map((gid) => {
        const cs = root.filter((c) => c.groupId === gid)
        const cov = sug.coverage.filter((c) => c.groupId === gid && c.zone === 'root')
        return {
          groupId: gid,
          pieces: cs.length,
          lengthMm: cs.reduce((s, c) => s + c.lengthMm + 1, 0),
          legs: [...new Set(cs.map((c) => c.leg))],
          angles: cs.length ? [Math.min(...cs.map((c) => c.angleMinDeg)), Math.max(...cs.map((c) => c.angleMaxDeg))] : null,
          medianPct: cs.length ? r2(cs.reduce((s, c) => s + c.medianPct, 0) / cs.length) : null,
          needsCheck: cs.filter((c) => c.needsCheck).length,
          strong: cs.filter((c) => c.strongRanges.length > 0).length,
          maxCoverageByLeg: cov.map((c) => ({ leg: c.leg, max: Math.max(...c.beams.map((b) => b.coverage)), shapeBeams: c.beams.filter((b) => b.coverage >= ctx.rules.echo.coverageMin).map((b) => b.angleDeg) }))
        }
      })
      summary[L.name] = {
        ms: r2(ms),
        rootLengthMm: total,
        highAngleRootLengthMm: highTotal,
        highAngleRootByGroup: [0, 1].map((gid) => high.filter((c) => c.groupId === gid).reduce((s, c) => s + c.lengthMm + 1, 0)),
        capPieces: sug.candidates.filter((c) => c.zone === 'cap').length,
        capLengthMm: sug.candidates.filter((c) => c.zone === 'cap').reduce((s, c) => s + c.lengthMm + 1, 0),
        byGroup
      }
    }
    report['echo'] = summary
    const on = ['12T-SV-01-Cap on.nde', '12T-SV-02-Cap on.nde', '12T-SV-04-Cap on.nde'].map((n) => lengthByFile.get(n)!)
    const off = lengthByFile.get('12T-SV-03-Cap off.nde')!
    report['echoHighAngleRootMm'] = Object.fromEntries(lengthByFile)
    // 01 은 루트 띠가 Skew 270 에만 뚜렷하고(84 mm), 높은 각도 띠의 나머지는 루트·캡 자리 밖(|V| 14~15 mm, 실제 깊이 4~6 mm,
    // 레그 2)에 있어 후보가 아니다 (capDepthBandMm 6 이면 Skew 270 에서 151 mm 더 잡힘 — 전문가 확인 전이라 기본값은 3)
    for (const x of on) {
      expect(x).toBeGreaterThan(50) // 두 그룹 합 (그룹당 301 mm 중)
      expect(x).toBeGreaterThan(3 * off)
    }
    expect(lengthByFile.get('12T-SV-02-Cap on.nde')!).toBeGreaterThan(300)
    expect(lengthByFile.get('12T-SV-04-Cap on.nde')!).toBeGreaterThan(200)
    expect(off).toBeLessThan(30)
  })

  it('(d) 같은 입력 두 번 → 같은 출력, (e) 한 파일 전체 장면 라벨 계산 시간', () => {
    const L = files.get('12T-SV-01-Cap on.nde')!
    const recs = hypothesisRecords(L)
    // 형상 에코 후보를 모두 승인했다고 보고 함께 넣는다 (실제 작업과 비슷한 양)
    const sug = suggestGeometricEchoes(prepareDerive(inputOf(L, recs)))
    const echoes = sug.candidates.map((c, j) =>
      newIndicationRecord({ uuid: uuidOf(500 + j), sha256: sha(L.name), labelerId: 'hypothesis', guidelineVersion: 'v1', readingStage: 'reconciled', ...echoCandidateRecordFields(c) })
    )
    const inp = inputOf(L, [...recs, ...echoes])
    const times: number[] = []
    let first: DeriveRun | null = null
    let json = ''
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      const run = runDerive(inp)
      times.push(performance.now() - t0)
      const s = JSON.stringify(run.result)
      if (!first) {
        first = run
        json = s
      } else expect(s).toBe(json)
    }
    const shuffled = JSON.stringify(runDerive({ ...inp, records: [...inp.records!].reverse() }).result)
    expect(shuffled).toBe(json)
    const out = first!.result
    report['performance'] = {
      file: L.name,
      records: recs.length,
      echoRecords: echoes.length,
      scenes: out.scenes.length,
      ms: times.map(r2),
      jsonBytes: json.length,
      stats: out.stats
    }
    report['echoApproved_01'] = {
      states: out.stats.scenes,
      trainStates: out.stats.trainScenes
    }
    expect(out.scenes).toHaveLength(602)
    expect(Math.min(...times)).toBeLessThan(5000)
    if (REPORT) writeFileSync(REPORT, JSON.stringify(report, null, 1))
  })
})
