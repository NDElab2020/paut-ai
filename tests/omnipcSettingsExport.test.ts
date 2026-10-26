/**
 * C-scan 을 OmniPC 'Export C-scan' 꼴 .txt 로 (X8, shared/imaging/cscanExport.ts · 서비스 exportCscanTxt).
 *   - 꼴: 사용자 폴더 문서/Evident/OmniPC/Export 의 TP14 내보내기(OmniPC 6.6 보통 사용, 읽기만)와 MXU 5.x 설명서 표 51·53
 *   - TP14-ROOT-L-01.opd 를 우리 OPD C-scan 으로 같은 꼴로 내서 그 파일과 칸마다 견준다(값 일치율, 한 칸 어긋남 허용)
 *   - X3 12T-SV-01 은 OmniPC 내보내기가 아직 없어(캡처 14) 장비 RawCScan 게이트 A 값과 견준다
 * 원본·사용자 파일은 읽기만 한다. 파일이 없는 PC 에서는 건너뛴다.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPath, withH5File } from '@core/nde/h5'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import { readOpdViewerChunk, readOpdViewerInfo } from '@core/opd/viewer'
import { buildCscanTxt, createAppService, type AppService } from '@core/service'
import { applyGateOverride, createGateCscan, fillGateCscan, findGate, rawToPercent, type GateCscan, type ViewerGate, type ViewerGroup } from '@shared/imaging'
import {
  OMNI_CSCAN_HEADER_KEYS,
  cscanToOmniTxt,
  omniAmplEndPct,
  omniCscanIndexAxis,
  omniCscanTxtFileName,
  parseOmniCscanTxt
} from '@shared/imaging/cscanExport'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { OPD_FILES, X3_FILES, opdPath } from './paths'

// ───────────── 가짜 그룹 ─────────────

function fakeGroup(technique: ViewerGroup['technique'], angles: number[], estimated = false): ViewerGroup {
  const nb = angles.length
  return {
    id: 0,
    name: 'GR-1',
    technique,
    supported: true,
    reason: null,
    verified: true,
    amplitudePath: null,
    statusPath: null,
    shape: [4, nb, 100],
    bytes: 0,
    ampScale: estimated ? { rawMax: 255, unitMax: 250, estimated: true } : { rawMax: 32767, unitMax: 200 },
    scan: { offsetMm: 10, resolutionMm: 1, count: 4 },
    ultrasound: { resolutionUs: 0.04, count: 100 },
    beams: angles.map((a, index) => ({ index, angleDeg: a, skewDeg: 90, velocityMps: 3240, uOffsetMm: 0, vOffsetMm: -30 + index, t0Us: 8 })),
    gates: [],
    cscanGateId: 1,
    initialBeam: 0,
    gainDb: null,
    referenceGainDb: null,
    referenceAmplitudePct: null
  }
}

const fakeGate = (thresholdPct: number | null): ViewerGate => ({
  id: 1,
  name: 'Gate A',
  geometry: 'SoundPath',
  sync: 'Pulse',
  startUs: [10],
  lengthUs: [5],
  thresholdPct,
  supported: true,
  producesCscan: true
})

function fakeCscan(g: ViewerGroup): GateCscan {
  const [ns, nb] = g.shape
  const cs = createGateCscan(g, 1)
  for (let k = 0; k < ns; k++) {
    for (let b = 0; b < nb; b++) {
      cs.peakRaw[k * nb + b] = Math.round(((k * 10 + b) / 200) * 32767) // %FSH = k·10 + b
      cs.peakSample[k * nb + b] = k === 3 && b === 0 ? -1 : 10 // 마지막 스캔·첫 빔은 데이터 없음
    }
  }
  return cs
}

describe('cscanToOmniTxt 꼴 (가짜 섹토리얼 3빔 · 4스캔)', () => {
  const g = fakeGroup('pa-sectorial', [40, 41, 42])
  const text = cscanToOmniTxt(g, fakeCscan(g), fakeGate(20), { dataFile: '12T-SV-01-Cap on', inspectionDate: '2024-09-03' })
  const lines = text.split('\r\n')

  it('머리말 21줄 (TP14 파일과 같은 이름·순서), 줄 끝 CRLF·칸 구분 탭', () => {
    expect(text.endsWith('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(text)).toBe(false)
    expect(lines.slice(0, 21)).toEqual([
      'Data File = 12T-SV-01-Cap on',
      'Inspection Date = 2024-09-03',
      'Group = GR-1',
      'Focal Law = Sectorial',
      'Gate = A',
      'Type = C-Scan A Amplitude',
      'ScanStart (mm) = 10.00',
      'Scan Qty.(sample) = 4',
      'Scan Resol. (mm) = 1.00',
      'IndexStart (Deg) = 40.00',
      'Index Qty. (sample) = 3',
      'Index Resol. (Deg) = 1.00',
      expect.stringMatching(/^Gate Start \(mm\) = \d+\.\d\d$/),
      expect.stringMatching(/^Gate Length \(mm\) = \d+\.\d\d$/),
      'Gate Level (%) = 20',
      'Bit Depth = 16',
      'Ampl. Start (%) = 0',
      'Ampl. End (%) = 200',
      'Ampl. Resol (%) = 0.01',
      'Min Thickness (mm) = 0.05',
      'Max Thickness (mm) = 50.00'
    ])
    expect(lines[21]).toBe(['Deg / mm', '10.00', '11.00', '12.00', '13.00'].join('\t'))
  })

  it('줄 = 인덱스 끝(42°) → 첫 빔(40°), 값 = %FSH 소수 둘째 자리, 데이터 없음은 빈 칸', () => {
    expect(lines.slice(22, 25)).toEqual([
      ['42.00', '2.00', '12.00', '22.00', '32.00'].join('\t'),
      ['41.00', '1.00', '11.00', '21.00', '31.00'].join('\t'),
      ['40.00', '0.00', '10.00', '20.00', ''].join('\t')
    ])
    expect(lines).toHaveLength(26) // 마지막 CRLF 뒤 빈 조각
    const parsed = parseOmniCscanTxt(text)
    expect(parsed.header.map(([k]) => k)).toEqual(OMNI_CSCAN_HEADER_KEYS.map((k) => k.replace('{u}', 'Deg')))
    expect(parsed.crlf).toBe(true)
    expect(parsed.rows.map((r) => r.index)).toEqual([42, 41, 40])
    expect(parsed.rows[2]!.values).toEqual([0, 10, 20, null])
  })

  it('리니어 = 빔 번호(VPA), 컴파운드 = 각도 — 둘 다 내보내기 꼴 확인 전, 추정 눈금(OPD)은 Ampl. End 800', () => {
    const lin = fakeGroup('pa-linear', [60, 60, 60])
    expect(omniCscanIndexAxis(lin)).toMatchObject({ unit: 'VPA', start: 1, resolution: 1, confirmed: false })
    const t = cscanToOmniTxt(lin, fakeCscan(lin), fakeGate(null), { dataFile: 'TF_01_L_0001' })
    expect(t).toMatch(/\r\nIndexStart \(VPA\) = 1\.00\r\n/)
    expect(t).toMatch(/\r\nInspection Date = 0001-01-01\r\n/)
    expect(t).toMatch(/\r\nGate Level \(%\) = \r\n/)
    expect(t).toMatch(/\r\nFocal Law = Linear\r\n/)
    expect(omniCscanIndexAxis(fakeGroup('pa-compound', [50, 51, 52]))).toMatchObject({ unit: 'Deg', confirmed: false })
    expect(omniCscanIndexAxis(g).confirmed).toBe(true)
    expect(omniAmplEndPct(fakeGroup('pa-sectorial', [45, 46], true))).toBe(800)
    expect(omniAmplEndPct(g)).toBe(200)
  })

  it('기본 파일 이름 = OmniPC 꼴 <자료파일>_YYYY_MM_DD HHhMMmSSs.txt', () => {
    expect(omniCscanTxtFileName('TP14-ROOT-L-01', new Date(2026, 7, 7, 11, 46, 54))).toBe('TP14-ROOT-L-01_2026_08_07 11h46m54s.txt')
    expect(omniCscanTxtFileName('a/b:c', new Date(2026, 0, 2, 3, 4, 5))).toBe('a_b_c_2026_01_02 03h04m05s.txt')
  })
})

// ───────────── TP14: OmniPC 사용자 내보내기 파일과 견줌 ─────────────

const EXPORT_DIR = join(homedir(), 'Documents', 'Evident', 'OmniPC', 'Export')
const tp14Export = (): string | null => {
  if (!existsSync(EXPORT_DIR)) return null
  const n = readdirSync(EXPORT_DIR)
    .filter((x) => x.startsWith('TP14-ROOT-L-01_') && x.endsWith('.txt'))
    .sort()[0]
  return n ? join(EXPORT_DIR, n) : null
}
const TP14_TXT = tp14Export()
const TP14_OPD = opdPath(OPD_FILES.tp14RootL)
/** TP14 화면의 게이트 A 문턱 (OmniPC 내보내기 'Gate Level (%) = 10', 화면 판독도 10 %) — OPD 는 파일에서 문턱을 못 찾아 넣어 준다 */
const TP14_THRESHOLD = 10

describe.skipIf(!TP14_TXT || !existsSync(TP14_OPD))('TP14-ROOT-L-01 (OPD): 우리 OPD C-scan 을 같은 꼴로 내서 OmniPC 내보내기와 견줌', () => {
  let ours = ''
  let theirs = ''
  beforeAll(async () => {
    const info = await readOpdViewerInfo(TP14_OPD)
    const g = info.groups[0]!
    const chunk = await readOpdViewerChunk(TP14_OPD, g, 0, g.shape[0])
    const gate = applyGateOverride(findGate(g, g.cscanGateId)!, g, { thresholdPct: TP14_THRESHOLD })
    const cs = createGateCscan(g, gate.id)
    fillGateCscan(cs, g, gate, chunk)
    ours = cscanToOmniTxt(g, cs, gate, { dataFile: 'TP14-ROOT-L-01', inspectionDate: null })
    theirs = readFileSync(TP14_TXT!, 'latin1')
  })

  it('머리말 21줄이 글자 그대로 같다 (그룹 이름·게이트 시작 16.00·폭 39.00·Ampl. End 800 포함), 둘 다 CRLF', () => {
    const a = ours.split('\r\n').slice(0, 21)
    const b = theirs.split('\r\n').slice(0, 21)
    expect(a).toEqual(b)
    expect(parseOmniCscanTxt(ours).crlf).toBe(true)
    expect(parseOmniCscanTxt(theirs).crlf).toBe(true)
  })

  it('스캔 위치 줄·인덱스 줄 순서(70° → 45°)·칸 수가 같다', () => {
    const a = parseOmniCscanTxt(ours)
    const b = parseOmniCscanTxt(theirs)
    expect(a.indexUnit).toBe(b.indexUnit)
    expect(a.scanMm).toEqual(b.scanMm)
    expect(a.rows.map((r) => r.index)).toEqual(b.rows.map((r) => r.index))
    expect(a.rows.every((r) => r.values.length === b.scanMm.length)).toBe(true)
  })

  it('값: 차 ≤ max(1 %p, 1 %)·한 칸 어긋남 허용으로 ≥ 97 % (소수 둘째 자리까지 같은 칸은 거의 없음 — OPD 진폭 눈금 추정), 화면 커서 칸(278 mm · 65°) 32.28 % ±0.1', () => {
    const a = parseOmniCscanTxt(ours)
    const b = parseOmniCscanTxt(theirs)
    let n = 0
    let same = 0
    let near = 0
    for (let r = 0; r < b.rows.length; r++) {
      for (let k = 0; k < b.scanMm.length; k++) {
        const t = b.rows[r]!.values[k]
        const o = a.rows[r]!.values[k]
        if (t === null || t === undefined || o === null || o === undefined) continue
        n++
        const tol = Math.max(1, 0.01 * t)
        if (Math.abs(o - t) <= tol) {
          same++
          continue
        }
        let hit = false
        for (let dr = -1; dr <= 1 && !hit; dr++) {
          for (let dk = -1; dk <= 1 && !hit; dk++) {
            const v = a.rows[r + dr]?.values[k + dk]
            if (v !== null && v !== undefined && Math.abs(v - t) <= tol) hit = true
          }
        }
        if (hit) near++
      }
    }
    // 2026-10-07 실측: 7826칸 중 허용 안 7634 + 한 칸 어긋남 58 = 98.3 % (허용 = max(1 %p, 1 %)). 소수 둘째 자리까지 같은 칸은 0 에 가깝고
    // 차의 중앙값은 약 +0.05 %p — 우리 OPD 눈금은 255 = 250 %(칸당 0.9804, 추정)인데 OmniPC 값은 칸당 약 0.978 로 보인다(캡처 14 확인 항목).
    // 나머지는 큰 각도(68~70°) 빔에서 OmniPC 값이 큰 칸 — 게이트 끝이 OPD 저장 구간 밖까지 걸치는 빔(자체 점검 '판정 못 함')
    expect(n).toBe(b.rows.length * b.scanMm.length)
    expect((same + near) / n).toBeGreaterThanOrEqual(0.97)
    let exact = 0
    const diffs: number[] = []
    for (let r = 0; r < b.rows.length; r++) {
      for (let k = 0; k < b.scanMm.length; k++) {
        const t = b.rows[r]!.values[k]
        const o = a.rows[r]!.values[k]
        if (t === null || t === undefined || o === null || o === undefined) continue
        if (Math.abs(o - t) < 0.006) exact++
        diffs.push(o - t)
      }
    }
    diffs.sort((x, y) => x - y)
    // 정확히 같다고 말하지 않도록 고정: 둘째 자리 일치는 1 % 미만, 차의 중앙값은 0 이 아니고 0.2 %p 안
    expect(exact / n).toBeLessThan(0.01)
    const med = diffs[Math.floor(diffs.length / 2)]!
    expect(Math.abs(med)).toBeGreaterThan(0.005)
    expect(Math.abs(med)).toBeLessThan(0.2)
    const row65 = a.rows.findIndex((r) => r.index === 65)
    const k278 = a.scanMm.indexOf(278)
    expect(Math.abs(b.rows[row65]!.values[k278]! - 32.28)).toBeLessThanOrEqual(0.005)
    expect(Math.abs(a.rows[row65]!.values[k278]! - 32.28)).toBeLessThanOrEqual(0.1)
  })
})

// ───────────── X3: 장비 RawCScan 게이트 A 와 견줌 ─────────────

const X3 = X3_FILES[0]!
const HAS_X3 = existsSync(X3)

async function rawCscanRecords(path: string): Promise<Uint8Array> {
  return withH5File(path, (f) => {
    const ent = getPath(f, 'Applications/MXU/RawCScan')
    const v = ent && 'value' in ent ? (ent as { value: unknown }).value : null
    if (!(v instanceof Uint8Array)) throw new Error('RawCScan 을 바이트로 읽지 못함')
    return v
  })
}

describe.skipIf(!HAS_X3)('X3 12T-SV-01: 내보낸 값 = 장비 RawCScan 게이트 A (테스트 전용 교차 확인)', () => {
  it('그룹마다 내보낸 칸 값(소수 둘째 자리)이 장비 값과 같은 칸 ≥ 97 %', async () => {
    const info = await readViewerInfo(X3)
    const records = await rawCscanRecords(X3)
    const beamsTotal = info.groups.reduce((n, g) => n + g.shape[1], 0)
    let beamBase = 0
    for (const g of info.groups) {
      const chunk = await readViewerChunk(X3, g, 0, g.shape[0])
      const gate = findGate(g, g.cscanGateId)!
      const cs = createGateCscan(g, gate.id)
      fillGateCscan(cs, g, gate, chunk)
      const t = parseOmniCscanTxt(cscanToOmniTxt(g, cs, gate, { dataFile: '12T-SV-01-Cap on' }))
      const [ns, nb] = g.shape
      expect(t.rows).toHaveLength(nb)
      let same = 0
      t.rows.forEach((row, r) => {
        const b = nb - 1 - r // 줄 = 인덱스 끝부터
        for (let k = 0; k < ns; k++) {
          const rec = new DataView(records.buffer, records.byteOffset + ((k * beamsTotal + beamBase + b) * 3 + 1) * 24, 24)
          const device = rawToPercent(rec.getUint32(4, true), g.ampScale).toFixed(2)
          if (row.values[k]!.toFixed(2) === device) same++
        }
      })
      // 2026-10-07 실측: Skew90 9190/9331(98.5 %), Skew270 9088/9331(97.4 %) — README 의 raw 정수 일치(그룹 0 9185)보다 조금 많은 것은 소수 둘째 자리로 견주기 때문
      expect(same / (ns * nb), g.name).toBeGreaterThanOrEqual(0.97)
      beamBase += nb
    }
  })
})

// ───────────── 서비스: 저장된 사본 → .txt (main 대화상자가 고른 경로) ─────────────

const acceptAll = (p: ImportPreview): ImportCommitRequest => ({
    previewId: p.previewId,
    newPlans: p.newPlans.map((n) => ({ key: n.key, name: n.suggestedName })),
    items: p.items
      .filter((i) => i.verdict === 'match-existing' || i.verdict === 'new-plan')
      .map((i) => ({
        itemId: i.itemId,
        include: true,
        specimenId: i.suggestedSpecimenId ?? 'X',
        specimenSource: i.suggestedSpecimenSource ?? 'manual',
        stateTag: i.suggestedStateTag,
        round: i.suggestedRound,
        memo: ''
      }))
  })

describe.skipIf(!HAS_X3)('서비스 exportCscanTxt (임시 저장소에 X3 하나)', () => {
  const work = mkdtempSync(join(tmpdir(), 'paut-cscan-'))
  const store = join(work, '저장소')
  const out = join(work, '내보내기')
  // 원본 폴더 거절을 시험하려고 X3 를 임시 '원본' 폴더에 복사해 가져온다(진짜 원시데이터 폴더에는 쓰기를 시도하지도 않게)
  const src = join(work, '원본')
  const srcFile = join(src, basename(X3))
  let service: AppService
  let fileId = 0
  const before = HAS_X3 ? statSync(X3) : null

  beforeAll(async () => {
    mkdirSync(src, { recursive: true })
    copyFileSync(X3, srcFile)
    service = createAppService({ settingsPath: join(work, 'settings.json'), now: () => new Date(2026, 9, 7, 9, 5, 3) })
    await service.setStoreRoot(store)
    await service.commit(acceptAll(await service.analyze([srcFile])))
    fileId = (await service.listFiles({ limit: 1 })).items[0]!.id
  })
  afterAll(() => {
    service?.close()
    rmSync(work, { recursive: true, force: true })
  })

  it('기본 이름·내용(머리말 Data File·날짜·게이트 문턱), .txt 를 붙인다, 바꾼 문턱이 들어간다', async () => {
    const open = await service.viewerOpen(fileId)
    const g = open.info.groups[0]!
    const req = { fileId, key: open.key, groupId: g.id }
    expect(await service.cscanExportFileName(req)).toBe('12T-SV-01-Cap on_2026_10_07 09h05m03s.txt')
    mkdirSync(out, { recursive: true })
    const r = await service.exportCscanTxt(req, join(out, 'x3'))
    expect(r).toMatchObject({ path: join(out, 'x3.txt'), scanCount: 301, indexCount: 31, indexConfirmed: true })
    const text = readFileSync(r.path, 'utf8')
    expect(r.bytes).toBe(Buffer.byteLength(text))
    const t = parseOmniCscanTxt(text)
    expect(Object.fromEntries(t.header)).toMatchObject({
      'Data File': '12T-SV-01-Cap on',
      'Inspection Date': '2024-09-03',
      Group: 'Skew90',
      'Gate Level (%)': '20',
      'IndexStart (Deg)': '40.00',
      'Gate Start (mm)': '7.00',
      'Gate Length (mm)': '21.00',
      'Ampl. End (%)': '200'
    })
    // 서비스 결과 = 같은 사본으로 buildCscanTxt (조각을 나눠 읽어도 같은 C-scan)
    const direct = await buildCscanTxt(X3, open.info, g.id, undefined, { dataFile: '12T-SV-01-Cap on', inspectionDate: '2024-09-03' })
    expect(text).toBe(direct.text)
    const r2 = await service.exportCscanTxt({ ...req, gate: { thresholdPct: 30 } }, join(out, 'x3-30.txt'))
    expect(Object.fromEntries(parseOmniCscanTxt(readFileSync(r2.path, 'utf8')).header)['Gate Level (%)']).toBe('30')
  })

  it('옛 키 CONFLICT, 저장소 안·상대경로·잘못된 게이트 값은 INVALID_ARGUMENT, 원본은 그대로', async () => {
    const open = await service.viewerOpen(fileId)
    const g = open.info.groups[0]!
    await expect(service.exportCscanTxt({ fileId, key: 'old', groupId: g.id }, join(out, 'a.txt'))).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, join(store, 'a.txt'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, 'a.txt')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      service.exportCscanTxt({ fileId, key: open.key, groupId: g.id, gate: { thresholdPct: -1 } }, join(out, 'b.txt'))
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: 99 }, join(out, 'c.txt'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    // 원시데이터 폴더(가져올 때의 원본 폴더, 그 아래)에는 쓰지 않는다
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, join(src, 'a.txt'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, join(src, '하위', 'a.txt'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(readdirSync(src)).toEqual([basename(X3)])
    // 측정 원본이 바로 든 다른 폴더도 거절
    const other = join(work, '다른원본')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'dummy.opd'), '')
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, join(other, 'a.txt'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    // '.txt' 를 붙인 이름이 이미 있으면 덮지 않는다 (대화상자는 붙이기 전 이름으로만 덮어쓰기를 물었음)
    writeFileSync(join(out, 'keep.txt'), 'old')
    await expect(service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, join(out, 'keep'))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(readFileSync(join(out, 'keep.txt'), 'utf8')).toBe('old')
    const now = statSync(X3)
    expect([now.size, now.mtimeMs]).toEqual([before!.size, before!.mtimeMs])
  })
})

// ───────────── 서비스 경로로 TP14 (앱에서 실제로 누르는 길) ─────────────

describe.skipIf(!TP14_TXT || !existsSync(TP14_OPD))('서비스 exportCscanTxt — TP14 OPD 를 임시 저장소에 가져와 앱 경로로 낸 머리말', () => {
  const work = mkdtempSync(join(tmpdir(), 'paut-cscan-tp14-'))
  const store = join(work, '저장소')
  const out = join(work, '내보내기')
  const src = join(work, '원본')
  let service: AppService
  let fileId = 0
  let theirs: string[] = []

  beforeAll(async () => {
    mkdirSync(src, { recursive: true })
    mkdirSync(out, { recursive: true })
    copyFileSync(TP14_OPD, join(src, basename(TP14_OPD)))
    service = createAppService({ settingsPath: join(work, 'settings.json'), now: () => new Date(2026, 9, 7, 9, 5, 3) })
    await service.setStoreRoot(store)
    await service.commit(acceptAll(await service.analyze([join(src, basename(TP14_OPD))])))
    fileId = (await service.listFiles({ limit: 1 })).items[0]!.id
    theirs = readFileSync(TP14_TXT!, 'latin1').split('\r\n').slice(0, 21)
  }, 120_000)
  afterAll(() => {
    service?.close()
    rmSync(work, { recursive: true, force: true })
  })

  it('화면 문턱(10 %)을 넘기면 머리말 21줄이 글자 그대로 같다 — Inspection Date 0001-01-01(OPD), Gate Level 10', async () => {
    const open = await service.viewerOpen(fileId)
    const g = open.info.groups[0]!
    const r = await service.exportCscanTxt({ fileId, key: open.key, groupId: g.id, gate: { thresholdPct: TP14_THRESHOLD } }, join(out, 'tp14.txt'))
    expect(readFileSync(r.path, 'latin1').split('\r\n').slice(0, 21)).toEqual(theirs)
  })

  it('문턱을 지정하지 않으면 OPD에서 읽은 Gate A 10 %로 머리말을 내보낸다', async () => {
    const open = await service.viewerOpen(fileId)
    const g = open.info.groups[0]!
    const r = await service.exportCscanTxt({ fileId, key: open.key, groupId: g.id }, join(out, 'tp14-no-threshold.txt'))
    const ours = readFileSync(r.path, 'latin1').split('\r\n').slice(0, 21)
    expect(g.gates.find((gate) => gate.id === g.cscanGateId)!.thresholdPct).toBe(10)
    expect(ours).toEqual(theirs)
  })

  it('사용자가 지정한 문턱이 파일 문턱보다 우선하고 원본 설정은 유지된다', async () => {
    const open = await service.viewerOpen(fileId)
    const g = open.info.groups[0]!
    const r = await service.exportCscanTxt({ fileId, key: open.key, groupId: g.id, gate: { thresholdPct: 12 } }, join(out, 'tp14-override-threshold.txt'))
    const ours = readFileSync(r.path, 'latin1').split('\r\n').slice(0, 21)
    const k = ours.findIndex((l) => l.startsWith('Gate Level (%)'))
    expect(ours[k]).toBe('Gate Level (%) = 12')
    expect(ours.filter((_, i) => i !== k)).toEqual(theirs.filter((_, i) => i !== k))
    expect((await service.viewerOpen(fileId)).info.groups[0]!.gates.find((gate) => gate.id === g.cscanGateId)!.thresholdPct).toBe(10)
  })
})

// ───────────── 브라우저 mock (dev:web) ─────────────

describe('브라우저 mock: viewer.exportCscan · viewer.openPalette', () => {
  it('가짜 볼륨으로 C-scan 꼴을 만들어 결과만 돌려주고, 옛 키는 CONFLICT, 색표는 앱이 만든 회색(Evident 색표 아님)', async () => {
    const { createMockApi } = await import('../src/renderer/src/api/mock')
    const api = createMockApi()
    const files = await api.files.list({ limit: 1 })
    expect(files.ok).toBe(true)
    if (!files.ok) return
    const id = files.data.items[0]!.id
    const open = await api.viewer.open(id)
    expect(open.ok).toBe(true)
    if (!open.ok) return
    const g = open.data.info.groups.find((x) => x.supported)!
    const r = await api.viewer.exportCscan({ fileId: id, key: open.data.key, groupId: g.id, gate: { thresholdPct: 25 } })
    expect(r.ok && r.data).toMatchObject({ scanCount: g.shape[0], indexCount: g.shape[1] })
    expect(r.ok && r.data!.path).toMatch(/_\d{4}_\d\d_\d\d \d\dh\d\dm\d\ds\.txt$/)
    const stale = await api.viewer.exportCscan({ fileId: id, key: 'old', groupId: g.id })
    expect(!stale.ok && stale.code).toBe('CONFLICT')
    const pal = await api.viewer.openPalette()
    expect(pal.ok && pal.data).toMatchObject({ name: 'mock_회색', format: 'xml', specialFromFile: false })
    expect(pal.ok && pal.data!.palette).toHaveLength(256)
  })
})
