/**
 * 학습 데이터 일괄 내보내기 (core/labels/export) — X3 12T-SV 실데이터 (원시데이터는 읽기만).
 * 기록 = 부록 E 의 그룹·레그·V·깊이로 만든 좁은 기록(deriveX3.test.ts 와 같은 근사 영역) + 검토 완료 0~300 mm.
 *   (a) manifest·meta·labels·scenes·ascan 모양, 규칙·스키마 버전
 *   (b) .npy 머리·크기·원자료 바이트
 *   (c) PNG 를 테스트 헬퍼로 읽어 크기, COCO·YOLO 상자가 그림 안, 양성 상자 화소가 가려지지 않음
 *   (d) 두 번 → 같은 바이트, 시각만 바꾸면 manifest.exportedAt 한 칸만 다름
 *   (e) 막힌 그룹(대조 전·U 오프셋 ≠ 0)은 진폭을 읽지 않고 이유 기록, 모두 막히면 파일 건너뜀
 *   (f) 취소 → CANCELLED, .partial 폴더 없음
 */
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boxPixels, runTrainingExport, type TrainingExportJob, type TrainingReader, type TrainingSourceFile } from '@core/labels/export'
import { initNde } from '@core/nde'
import { readViewerChunk, readViewerInfo } from '@core/nde/viewer'
import { DEFAULT_TRAINING_SET_RULE, type TrainingExportOptions } from '@shared/api'
import type { ViewerFileInfo } from '@shared/imaging/types'
import { LABEL_DERIVE_RULES_VERSION } from '@shared/labels/derive'
import { newIndicationRecord, newReviewInterval } from '@shared/labels/factory'
import { LABEL_SCHEMA_VERSION, type IndicationRecord, type LabelSetKey, type MetallurgicalType } from '@shared/labels/types'
import { readPng } from '../../helpers/png'
import { X3_FILES } from '../../paths'

const HAS = X3_FILES.every((f) => existsSync(f))
const work = mkdtempSync(join(tmpdir(), 'paut-train-export-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const F1 = X3_FILES[0]!
const F2 = X3_FILES[1]!
const FIXED = '2026-10-06T12:00:00+09:00'

function shaOf(path: string): string {
  return createHash('sha256').update(path.split('/').pop()!).digest('hex')
}
function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

interface Spec {
  ref: string
  type: MetallurgicalType
  u: [number, number]
  v: [number, number]
  d: [number, number]
}
// 부록 E 근사 영역 (deriveX3.test.ts 와 같음)
const SPECS: Record<string, Spec[]> = {
  [F1]: [
    { ref: '#01', type: 'crack-toe', u: [35, 46], v: [8, 12], d: [0, 2] },
    { ref: '#02', type: 'lof-unspecified', u: [128, 142], v: [3, 8], d: [2, 8] },
    { ref: '#03', type: 'crack-sidewall', u: [182, 208], v: [-5, -3], d: [6, 10] }
  ],
  [F2]: [
    { ref: '#05', type: 'crack-root', u: [148, 170], v: [2, 5], d: [9.5, 12] },
    { ref: '#06', type: 'lof-unspecified', u: [214, 226], v: [-5, -3.5], d: [4, 7.5] }
  ]
}

function setOf(path: string): LabelSetKey {
  return { sha256: shaOf(path), labelerId: 'park-l3', guidelineVersion: 'v1', readingStage: 'final' }
}

function source(path: string, over: Partial<TrainingSourceFile> = {}): TrainingSourceFile {
  const set = setOf(path)
  const records: IndicationRecord[] = (SPECS[path] ?? []).map((x, j) =>
    newIndicationRecord({
      ...set,
      uuid: uuidOf(100 + j + (path === F2 ? 50 : 0)),
      externalRef: x.ref,
      defectType: x.type,
      derived: { scanStartMm: x.u[0], scanEndMm: x.u[1], vMinMm: x.v[0], vMaxMm: x.v[1], depthTopMm: x.d[0], depthBottomMm: x.d[1] },
      length: { valueMm: x.u[1] - x.u[0], method: 'eval-level' }
    })
  )
  const name = path.split('/').pop()!
  return {
    sha256: set.sha256,
    fileName: name,
    specimenId: name.slice(0, 9),
    weldId: null,
    split: path === F1 ? 'train' : 'test',
    path,
    selection: { candidates: [`${set.sha256}|park-l3|v1|final`], chosen: `${set.sha256}|park-l3|v1|final`, reason: '확정 세트 (park-l3 · 지침서 v1)' },
    labelSet: set,
    labeler: { id: 'park-l3', name: '박 판독', qualification: 'UT Level III', organization: null },
    records,
    reviewIntervals: [newReviewInterval({ ...set, uuid: uuidOf(900 + (path === F2 ? 1 : 0)), kind: 'reviewed', scanStartMm: 0, scanEndMm: 300 })],
    observations: [],
    alignment: null,
    physicalDefects: [],
    pendingConflicts: 0,
    ...over
  }
}

const OPTS: TrainingExportOptions = { amplitude: true, images: true, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep' }

/** 그룹 정보를 바꿔 읽는 reader (진폭 조각 요청은 그룹별로 센다) */
function reader(edit?: (info: ViewerFileInfo, path: string) => void, calls?: Map<string, number>): TrainingReader {
  return {
    async info(p) {
      const info = await readViewerInfo(p)
      edit?.(info, p)
      return info
    },
    chunk(p, g, s, n) {
      const k = `${p.split('/').pop()}|${g.id}`
      calls?.set(k, (calls.get(k) ?? 0) + 1)
      return readViewerChunk(p, g, s, n)
    }
  }
}

function job(name: string, files: TrainingSourceFile[], over: Partial<TrainingExportJob> = {}): TrainingExportJob {
  return {
    operationId: `TX-test-${name}`,
    outDir: join(work, name),
    files,
    options: OPTS,
    setRule: DEFAULT_TRAINING_SET_RULE,
    blindModeLabelerId: null,
    split: { unit: 'specimen', testLocked: false, testLockedAt: null },
    appVersion: '0.1.0-test',
    pcId: 'pc-test',
    exportedAt: FIXED,
    reader: reader(),
    ...over
  }
}

function listFiles(root: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(relative(root, p).split('\\').join('/'))
    }
  }
  walk(root)
  return out
}

const json = (p: string): Record<string, any> => JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>

/** 회색조 8비트 PNG 읽기 (가림 그림 — 이 내보내기는 Sub 필터만 쓴다) */
function readGray(path: string): { width: number; height: number; data: Uint8Array } {
  const buf = readFileSync(path)
  let off = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      expect([body[8], body[9]]).toEqual([8, 0])
    } else if (type === 'IDAT') idat.push(body)
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width + 1)]).toBe(1)
    for (let x = 0; x < width; x++) data[y * width + x] = (raw[y * (width + 1) + 1 + x]! + (x > 0 ? data[y * width + x - 1]! : 0)) & 255
  }
  return { width, height, data }
}

/** .npy 머리 읽기 */
function npyHead(buf: Buffer): { descr: string; shape: number[]; dataOffset: number } {
  expect(buf.subarray(0, 6).toString('latin1')).toBe('\x93NUMPY')
  expect([buf[6], buf[7]]).toEqual([1, 0])
  const len = buf.readUInt16LE(8)
  const text = buf.toString('latin1', 10, 10 + len)
  expect((10 + len) % 64).toBe(0)
  expect(text.endsWith('\n')).toBe(true)
  const descr = /'descr': '([^']+)'/.exec(text)![1]!
  expect(text).toContain("'fortran_order': False")
  const shape = /'shape': \(([^)]*)\)/.exec(text)![1]!.split(',').map((s) => s.trim()).filter(Boolean).map(Number)
  return { descr, shape, dataOffset: 10 + len }
}

describe.skipIf(!HAS)('학습 데이터 내보내기 (X3 실데이터)', () => {
  let A: Awaited<ReturnType<typeof runTrainingExport>>
  beforeAll(async () => {
    await initNde()
    A = await runTrainingExport(job('A', [source(F2), source(F1)]))
  }, 180_000)

  it('manifest: 형식·버전·파일 목록·세트 고르기·옵션', () => {
    expect(A.folderName).toBe('A')
    expect(existsSync(join(work, 'A.partial'))).toBe(false)
    const m = json(join(work, 'A', 'manifest.json'))
    expect(m).toMatchObject({
      format: 'paut-train-export',
      formatVersion: 2,
      appVersion: '0.1.0-test',
      exportedAt: FIXED,
      pcId: 'pc-test',
      versions: { labelSchema: LABEL_SCHEMA_VERSION, deriveRules: LABEL_DERIVE_RULES_VERSION, derivedFormat: 'paut-derived-labels' },
      guidelineVersions: ['v1'],
      options: { amplitude: true, images: true, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep' },
      split: { unit: 'specimen', testLocked: false },
      blockedGroups: [],
      skipped: []
    })
    expect(m.rules.weakAs).toBe('ignore')
    expect(m.rules.allowUnverified).toBe(false)
    expect(typeof m.versions.coordRules).toBe('number')
    // 재현·감사: 그림 규칙 버전·팔레트 해시, 분할 표와 그 해시, 데이터셋 ID = checksums.sha256 의 SHA-256
    expect(m.versions.imageRules).toBe(2)
    expect(m.versions.palette.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(m.split.assignmentsSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(m.split.stages).toEqual({ test: { final: 1 }, train: { final: 1 } })
    const sums = readFileSync(join(work, 'A', 'checksums.sha256'))
    expect(m.datasetId).toBe(createHash('sha256').update(sums).digest('hex'))
    // 파일은 이름 순 (입력 순서와 무관)
    expect(m.files.map((f: any) => f.fileName)).toEqual(['12T-SV-01-Cap on.nde', '12T-SV-02-Cap on.nde'])
    for (const f of m.files) {
      expect(f.folder).toBe(`files/${f.sha256.slice(0, 16)}`)
      expect(f).toMatchObject({ labelerId: 'park-l3', readingStage: 'final', guidelineVersion: 'v1' })
      expect(f.groups.map((g: any) => g.blocked)).toEqual([null, null])
      expect(f.images).toBeGreaterThan(100)
      expect(f.annotations).toBeGreaterThan(0)
    }
    expect(m.files.map((f: any) => f.split)).toEqual(['train', 'test'])
    expect(m.setSelection).toHaveLength(2)
    expect(m.setSelection[0].reason).toContain('확정')
    expect(m.classes.map((c: any) => c.name)).toEqual(['defect', 'geometric-echo'])
    expect(A.totals).toMatchObject({ files: 2, exported: 2, skipped: 0, blockedGroups: 0 })
    expect(A.totals.images).toBe(m.totals.images)
  })

  it('가림: 원본 그림 + 가림 그림(0·1·2) · train 만 검게 칠한 판 · test 는 원본만 · 결함 창의 덩어리 밖도 가림 · 상자는 칸 중심 상자를 감쌈', () => {
    for (const [path, split] of [
      [F1, 'train'],
      [F2, 'test']
    ] as const) {
      const dir = join(work, 'A', 'files', shaOf(path).slice(0, 16))
      const coco = json(join(dir, 'coco.json'))
      const meta = json(join(dir, 'meta.json'))
      const withMask = coco.images.filter((i: any) => i.mask_file_name)
      expect(withMask.length).toBeGreaterThan(0)
      if (split === 'test') expect(coco.images.every((i: any) => i.masked_file_name === null)).toBe(true)
      else expect(coco.images.filter((i: any) => i.masked_file_name).length).toBe(withMask.length)
      // 결함 양성 장면에도 라벨 가림(탐색 창 − 덩어리) — A-scan 가림과 같은 규칙
      expect(coco.images.some((i: any) => i.train_state === 'positive' && i.label_masked_px > 0)).toBe(true)
      for (const im of withMask.slice(0, 4)) {
        const mask = readGray(join(dir, im.mask_file_name))
        const orig = readPng(join(dir, im.file_name))
        expect([mask.width, mask.height]).toEqual([orig.width, orig.height])
        expect([...new Set(mask.data)].every((v) => v === 0 || v === 1 || v === 2)).toBe(true)
        expect(mask.data.filter((v) => v !== 0).length).toBe(im.masked_px)
        if (im.masked_file_name) {
          const black = readPng(join(dir, im.masked_file_name))
          for (let p = 0; p < mask.data.length; p++) {
            const q = p * 4
            if (mask.data[p] !== 0) expect([black.data[q], black.data[q + 1], black.data[q + 2]]).toEqual([0, 0, 0])
            else expect([black.data[q], black.data[q + 1], black.data[q + 2]]).toEqual([orig.data[q], orig.data[q + 1], orig.data[q + 2]])
          }
          // 같은 YOLO 글자 (masked/labels)
          expect(readFileSync(join(dir, im.masked_file_name.replace(/^masked\/images\//, 'masked/labels/').replace(/\.png$/, '.txt')), 'utf8')).toBe(
            readFileSync(join(dir, im.file_name.replace(/^images\//, 'labels/').replace(/\.png$/, '.txt')), 'utf8')
          )
        }
      }
      // 상자 = 덩어리 화소를 감싸는 사각형 ⊇ 예전 칸 중심 상자
      const byId = new Map(coco.images.map((i: any) => [i.id, i]))
      let n = 0
      for (const a of coco.annotations.filter((x: any) => x.iscrowd === 0)) {
        const im = byId.get(a.image_id) as any
        const gi = meta.groups.find((q: any) => q.id === im.group_id).image
        const old = boxPixels({ ...gi, x0: Math.round(gi.vMinMm / gi.mmPerPx), maxLeg: gi.legs[1] }, a.attributes.box)
        const [x, y, w, h] = a.bbox
        expect(x).toBeLessThanOrEqual(old[0])
        expect(y).toBeLessThanOrEqual(old[1])
        expect(x + w).toBeGreaterThanOrEqual(old[0] + old[2])
        expect(y + h).toBeGreaterThanOrEqual(old[1] + old[3])
        n++
      }
      expect(n).toBeGreaterThan(0)
    }
    // YOLO 목록: test 는 원본 그림, train 은 가린 화소가 있으면 검게 칠한 판
    const testList = readFileSync(join(work, 'A', 'yolo_test.txt'), 'utf8').trim().split('\n')
    expect(testList.every((l) => l.includes('/images/') && !l.includes('/masked/'))).toBe(true)
    expect(readFileSync(join(work, 'A', 'yolo_train.txt'), 'utf8')).toContain('/masked/images/')
  })

  it('A-scan 학습 상태(trainStates)는 상태 글자와 같은 길이, 계산만 한 관측을 무시하면 학습 양성이 없다', async () => {
    const sha = shaOf(F1)
    const asc = json(join(work, 'A', 'files', sha.slice(0, 16), 'ascan.json'))
    expect(asc.unconfirmedObservation).toBe('keep')
    for (const g of asc.groups) {
      expect(g.trainStates.length).toBe(g.states.length)
      expect(g.trainCounts.positive).toBeLessThanOrEqual(g.counts.positive)
    }
    const U = await runTrainingExport(job('U', [source(F1)], { options: { ...OPTS, images: false, amplitude: false, unconfirmedObservation: 'ignore' } }))
    const u = json(join(U.path, 'files', sha.slice(0, 16), 'ascan.json'))
    expect(u.unconfirmedObservation).toBe('ignore')
    for (const g of u.groups) expect(g.trainCounts.positive).toBe(0)
  }, 120_000)

  it('파일 폴더: meta · labels · scenes · ascan 모양', () => {
    const sha = shaOf(F1)
    const dir = join(work, 'A', 'files', sha.slice(0, 16))
    const meta = json(join(dir, 'meta.json'))
    expect(meta).toMatchObject({ format: 'paut-train-file-meta', sha256: sha, split: 'train', thicknessMm: 12, thicknessSource: 'setup' })
    expect(meta.groups).toHaveLength(2)
    // OmniPC 설정 읽기(2026-10-07)로 ViewerGate·ViewerWeld 에 더한 선택 칸(L5 enabled·detection·event, L7 template)은
    // 형식 2 meta.json 에 넣지 않는다 — 같은 입력·같은 규칙 버전이면 같은 바이트 (NDE 바이트 그대로)
    const GATE_KEYS = ['geometry', 'id', 'lengthUs', 'name', 'producesCscan', 'startUs', 'supported', 'sync', 'thresholdPct']
    for (const g of meta.groups) for (const gate of g.gates) expect(Object.keys(gate).sort()).toEqual(GATE_KEYS)
    expect(meta.specimen.weld).toBeTruthy()
    expect(Object.keys(meta.specimen.weld)).not.toContain('template')
    expect(Object.keys(meta.specimen).sort()).toEqual(['shape', 'thicknessMm', 'weld'])
    for (const g of meta.groups) {
      expect(g.blocked).toBeNull()
      expect(g.amplitudeFile).toBe(`amplitude_g${g.id}.npy`)
      expect(g.levels.refPct).toBeGreaterThan(0)
      expect(g.image).toMatchObject({ mmPerPx: 0.1, softGainDb: 0, folder: `images/g${g.id}` })
      expect(g.image.depthMinMm).toBe(0)
      expect(g.image.legs[1]).toBeGreaterThanOrEqual(3)
    }
    const labels = json(join(dir, 'labels.json'))
    expect(labels.records).toHaveLength(3)
    expect(labels.records.map((r: any) => r.uuid)).toEqual([...labels.records.map((r: any) => r.uuid)].sort())
    expect(labels.labelSet).toEqual(setOf(F1))

    const scenes = json(join(dir, 'scenes.json'))
    expect(scenes.format).toBe('paut-derived-labels')
    expect(scenes.rulesVersion).toBe(LABEL_DERIVE_RULES_VERSION)
    expect(scenes.ascanSpans).toBeUndefined()
    expect(scenes.ascanFile).toBe('ascan.json')
    expect(scenes.scenes.length).toBe(2 * 301)
    const states = new Set(scenes.scenes.map((s: any) => s.trainState))
    expect(states.has('positive')).toBe(true)
    expect(states.has('negative')).toBe(true)
    expect(scenes.observations.length).toBeGreaterThan(0)
    expect(Array.isArray(scenes.issues)).toBe(true)
    const pos = scenes.scenes.flatMap((s: any) => s.objects).filter((o: any) => o.status === 'positive')
    expect(pos.length).toBeGreaterThan(0)
    expect(pos.every((o: any) => o.box && o.box.vMinMm <= o.box.vMaxMm && o.box.depthMinMm <= o.box.depthMaxMm)).toBe(true)

    const ascan = json(join(dir, 'ascan.json'))
    expect(ascan.format).toBe('paut-train-ascan')
    expect(ascan.stateCodes).toEqual({ P: 'positive', W: 'weak', I: 'ignore', N: 'negative', U: 'unknown' })
    expect(ascan.spans.length).toBe(scenes.stats.ascanSpans)
    for (const g of ascan.groups) {
      expect(g.states.length).toBe(g.scanCount * g.beamCount)
      expect(/^[PWINU]+$/.test(g.states)).toBe(true)
      expect(g.sceneNegativeRegion).toHaveLength(g.scanCount)
      expect(g.negativeRegions.length).toBeGreaterThan(0)
      expect(g.negativeRegions[0].lo).toHaveLength(g.beamCount)
      expect(g.counts.positive).toBeGreaterThan(0)
    }
  })

  it('.npy: 머리·크기·원자료 바이트', async () => {
    const sha = shaOf(F1)
    const dir = join(work, 'A', 'files', sha.slice(0, 16))
    const info = await readViewerInfo(F1)
    for (const g of info.groups) {
      const buf = readFileSync(join(dir, `amplitude_g${g.id}.npy`))
      const h = npyHead(buf)
      expect(h.descr).toBe('<i2')
      expect(h.shape).toEqual(g.shape)
      expect(buf.length).toBe(h.dataOffset + g.shape[0] * g.shape[1] * g.shape[2] * 2)
      const c = await readViewerChunk(F1, g, 0, 3)
      const bytes = Buffer.from(c.amplitude.buffer, c.amplitude.byteOffset, c.amplitude.byteLength)
      expect(buf.subarray(h.dataOffset, h.dataOffset + bytes.length).equals(bytes)).toBe(true)
      const st = readFileSync(join(dir, `status_g${g.id}.npy`))
      const hs = npyHead(st)
      expect(hs).toMatchObject({ descr: '|u1', shape: [g.shape[0], g.shape[1]] })
      expect(st.length).toBe(hs.dataOffset + g.shape[0] * g.shape[1])
    }
  })

  it('그림: PNG 크기 · COCO·YOLO 상자가 그림 안 · 상자 화소는 가려지지 않음', () => {
    const sha = shaOf(F1)
    const dir = join(work, 'A', 'files', sha.slice(0, 16))
    const meta = json(join(dir, 'meta.json'))
    const coco = json(join(dir, 'coco.json'))
    expect(coco.categories.map((c: any) => c.name)).toEqual(['defect', 'geometric-echo'])
    expect(coco.images.length).toBeGreaterThan(100)
    const byId = new Map(coco.images.map((i: any) => [i.id, i]))
    for (const im of coco.images.slice(0, 5)) {
      const png = readPng(join(dir, im.file_name))
      const g = meta.groups.find((x: any) => x.id === im.group_id)
      expect([png.width, png.height]).toEqual([g.image.width, g.image.height])
      expect([im.width, im.height]).toEqual([g.image.width, g.image.height])
    }
    expect(coco.annotations.length).toBeGreaterThan(0)
    let checked = 0
    for (const a of coco.annotations) {
      const im = byId.get(a.image_id) as any
      const [x, y, w, h] = a.bbox
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(w).toBeGreaterThanOrEqual(1)
      expect(h).toBeGreaterThanOrEqual(1)
      expect(x + w).toBeLessThanOrEqual(im.width)
      expect(y + h).toBeLessThanOrEqual(im.height)
      expect(a.area).toBe(w * h)
      // 무시 영역(iscrowd = 1)은 YOLO 줄이 없다
      if (a.iscrowd === 1) {
        expect(a.attributes.ignore).toBe(true)
        continue
      }
      // 양성 상자는 최소 3 화소 (학습 증강에서 버려지지 않게)
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(3)
      // 상자의 최대 칸 화소는 검게 가리지 않았다
      if (checked < 6 && a.category_id === 1) {
        const png = readPng(join(dir, im.file_name))
        const g = meta.groups.find((q: any) => q.id === im.group_id)
        const cx = Math.floor((a.attributes.box.vMinMm + a.attributes.box.vMaxMm) / 2 / 0.1 - g.image.vMinMm / 0.1)
        const cy = Math.floor((a.attributes.box.depthMinMm + a.attributes.box.depthMaxMm) / 2 / 0.1)
        let black = 0
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++) {
            const i = (yy * png.width + xx) * 4
            if (png.data[i] === 0 && png.data[i + 1] === 0 && png.data[i + 2] === 0) black++
          }
        expect(black, `상자 안 검은 화소 (${cx}, ${cy})`).toBeLessThan(w * h)
        checked++
      }
      // YOLO 줄과 같은 상자
      const txt = readFileSync(join(dir, im.file_name.replace(/^images\//, 'labels/').replace(/\.png$/, '.txt')), 'utf8')
      const lines = txt.trim().split('\n')
      const vals = lines.map((l) => l.split(' ').map(Number))
      expect(vals.every((v) => v.length === 5 && v.slice(1).every((q) => q >= 0 && q <= 1))).toBe(true)
      const want = [a.category_id - 1, (x + w / 2) / im.width, (y + h / 2) / im.height, w / im.width, h / im.height]
      expect(vals.some((v) => v.every((q, i) => Math.abs(q - want[i]!) < 1e-6))).toBe(true)
    }
    expect(checked).toBeGreaterThan(0)
    // 음성 장면(상자 없음)은 빈 txt
    const neg = coco.images.find((i: any) => i.train_state === 'negative')
    expect(readFileSync(join(dir, neg.file_name.replace(/^images\//, 'labels/').replace(/\.png$/, '.txt')), 'utf8')).toBe('')
    // 맨 위 YOLO·COCO
    const yaml = readFileSync(join(work, 'A', 'data.yaml'), 'utf8')
    expect(yaml).toContain('train: yolo_train.txt')
    expect(yaml).toContain('test: yolo_test.txt')
    expect(yaml).not.toContain('val:')
    const trainList = readFileSync(join(work, 'A', 'yolo_train.txt'), 'utf8').trim().split('\n')
    // train 은 가린 화소가 있으면 검게 칠한 판(masked/images — 같은 YOLO 글자는 masked/labels)
    expect(trainList.every((l) => l.startsWith(`./files/${sha.slice(0, 16)}/images/`) || l.startsWith(`./files/${sha.slice(0, 16)}/masked/images/`))).toBe(true)
    expect(existsSync(join(work, 'A', trainList[0]!.slice(2)))).toBe(true)
    const cocoTrain = json(join(work, 'A', 'coco_train.json'))
    expect(cocoTrain.images.length).toBe(coco.images.length)
  })

  it('checksums.sha256: manifest 를 뺀 모든 파일', () => {
    const root = join(work, 'A')
    const lines = readFileSync(join(root, 'checksums.sha256'), 'utf8').trim().split('\n')
    const listed = lines.map((l) => l.slice(66))
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
    expect(listed).toEqual(listFiles(root).filter((p) => p !== 'manifest.json' && p !== 'checksums.sha256').sort(cmp))
    for (const l of lines.slice(0, 20)) {
      const [hash, , ...rest] = l.split(' ')
      expect(createHash('sha256').update(readFileSync(join(root, rest.join(' ')))).digest('hex')).toBe(hash)
    }
  })

  it('같은 입력 두 번 → 같은 바이트', async () => {
    await runTrainingExport(job('B', [source(F1), source(F2)]))
    const a = listFiles(join(work, 'A'))
    expect(listFiles(join(work, 'B'))).toEqual(a)
    for (const p of a) expect(readFileSync(join(work, 'B', p)).equals(readFileSync(join(work, 'A', p))), p).toBe(true)
  }, 180_000)

  it('시각만 다르면 manifest.exportedAt 한 칸만 다르다', async () => {
    const lite = { ...OPTS, amplitude: false, images: false }
    await runTrainingExport(job('C', [source(F1)], { options: lite }))
    await runTrainingExport(job('D', [source(F1)], { options: lite, exportedAt: '2026-10-07T09:30:00+09:00' }))
    const c = listFiles(join(work, 'C'))
    expect(listFiles(join(work, 'D'))).toEqual(c)
    for (const p of c.filter((q) => q !== 'manifest.json')) expect(readFileSync(join(work, 'D', p)).equals(readFileSync(join(work, 'C', p))), p).toBe(true)
    const mc = json(join(work, 'C', 'manifest.json'))
    const md = json(join(work, 'D', 'manifest.json'))
    expect(md.exportedAt).toBe('2026-10-07T09:30:00+09:00')
    expect({ ...md, exportedAt: mc.exportedAt }).toEqual(mc)
    // 그림·진폭을 끄면 그 파일이 없다
    expect(c.some((p) => p.endsWith('.npy') || p.endsWith('.png') || p === 'data.yaml')).toBe(false)
  }, 120_000)

  it('막힌 그룹: 대조 전 · U 오프셋 ≠ 0 은 읽지 않고 이유 기록, 모두 막히면 파일 건너뜀', async () => {
    const calls = new Map<string, number>()
    const edit = (info: ViewerFileInfo, p: string): void => {
      if (p === F1) {
        info.groups[0]!.scan = { ...info.groups[0]!.scan, offsetMm: 2 }
        info.groups[1]!.verified = false
      } else {
        info.groups[1]!.verified = false
      }
    }
    const r = await runTrainingExport(job('E', [source(F1), source(F2)], { reader: reader(edit, calls), options: { ...OPTS, images: false } }))
    const m = json(join(work, 'E', 'manifest.json'))
    expect(m.files.map((f: any) => f.fileName)).toEqual(['12T-SV-02-Cap on.nde'])
    expect(m.skipped).toHaveLength(1)
    expect(m.skipped[0].fileName).toBe('12T-SV-01-Cap on.nde')
    expect(m.skipped[0].reason).toContain('모든 그룹이 막혔습니다')
    const reasons = m.blockedGroups.map((b: any) => `${b.fileName}|${b.groupId}|${b.reason}`)
    expect(reasons).toHaveLength(3)
    expect(reasons.some((x: string) => x.startsWith('12T-SV-01-Cap on.nde|0|') && x.includes('U 격자 오프셋'))).toBe(true)
    expect(reasons.some((x: string) => x.startsWith('12T-SV-01-Cap on.nde|1|') && x.includes('대조 전'))).toBe(true)
    expect(reasons.some((x: string) => x.startsWith('12T-SV-02-Cap on.nde|1|'))).toBe(true)
    // 막힌 그룹은 진폭을 읽지 않는다
    expect(calls.get('12T-SV-01-Cap on.nde|0')).toBeUndefined()
    expect(calls.get('12T-SV-01-Cap on.nde|1')).toBeUndefined()
    expect(calls.get('12T-SV-02-Cap on.nde|1')).toBeUndefined()
    expect(calls.get('12T-SV-02-Cap on.nde|0')).toBeGreaterThan(0)
    const dir = join(work, 'E', 'files', shaOf(F2).slice(0, 16))
    expect(existsSync(join(dir, 'amplitude_g0.npy'))).toBe(true)
    expect(existsSync(join(dir, 'amplitude_g1.npy'))).toBe(false)
    expect(existsSync(join(work, 'E', 'files', shaOf(F1).slice(0, 16)))).toBe(false)
    const meta = json(join(dir, 'meta.json'))
    expect(meta.groups[1].blocked).toContain('대조 전')
    expect(meta.groups[1].amplitudeFile).toBeNull()
    const scenes = json(join(dir, 'scenes.json'))
    expect(new Set(scenes.scenes.map((s: any) => s.groupId))).toEqual(new Set([0]))
    const ascan = json(join(dir, 'ascan.json'))
    expect(ascan.groups.map((g: any) => g.groupId)).toEqual([0])
    expect(r.totals).toMatchObject({ exported: 1, skipped: 1, blockedGroups: 3 })
  }, 120_000)

  it('세트 없음·사본 없음은 건너뛰고 이유를 남긴다', async () => {
    const noSet = source(F1, { labelSet: null, selection: { candidates: [], chosen: null, reason: '라벨 세트가 없습니다.' } })
    const noFile = source(F2, { path: null })
    const r = await runTrainingExport(job('F', [noSet, noFile], { options: { ...OPTS, images: false, amplitude: false } }))
    expect(r.totals).toMatchObject({ exported: 0, skipped: 2 })
    const m = json(join(work, 'F', 'manifest.json'))
    expect(m.skipped.map((s: any) => s.reason)).toEqual(['라벨 세트가 없습니다.', '이 PC 저장소에 사본이 없습니다.'])
  })

  it('취소 → CANCELLED, 만들던 폴더는 남지 않음', async () => {
    const ctl = new AbortController()
    const seen: string[] = []
    const p = runTrainingExport(
      job('G', [source(F1), source(F2)], {
        signal: ctl.signal,
        onProgress: (ev) => {
          seen.push(ev.phase)
          if (ev.phase === 'images' && ev.imagesDone >= 3) ctl.abort()
        }
      })
    )
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(seen).toContain('images')
    expect(existsSync(join(work, 'G'))).toBe(false)
    expect(existsSync(join(work, 'G.partial'))).toBe(false)
  }, 120_000)

  it('같은 이름 폴더가 있으면 덮어쓰지 않는다', async () => {
    await expect(runTrainingExport(job('A', [source(F1)]))).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
