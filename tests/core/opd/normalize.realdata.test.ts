/**
 * OPD 162개 전수 → 스캔플랜 묶음 (실데이터가 있는 PC 에서만, 판단.md 7절 4단계 확인 방법).
 * - 지문으로 나눈 묶음 = 조사 기준표(1_파서실험_전수결과.csv)의 셋업 값으로 나눈 묶음.
 *   기준표에는 집속 깊이 열이 없어 그것만 구조 읽기 값으로 더한다(TP01~TP10 의 ROOT 12 mm · TOP 24 mm 는 값이 같고 집속만 다르다).
 * - L/R 은 다른 플랜, SEC20·SEC25-2 는 각각 한 플랜(둘의 셋업도 같아 한 플랜), 재스캔(re/)은 원래 플랜.
 * - 다시 읽어도 지문이 같고, 기존 NDE 시험 파일(X3 4·공식 예제 11·X4 2)의 지문과 겹치지 않는다.
 * - 모르는 칸은 null, 미리보기 경고(두께 불일치·장비 저장 이름·2축)는 해당 파일에만.
 * - 162개 지문 스냅샷: 읽기 규칙(OPD_READER)을 바꿨는데 스펙 값이 달라지면 이 시험이 깨진다 → OPD_SPEC_RULE 을 올리고 스냅샷을 고친다.
 * - 요약 줄은 플랜마다 다르다(집속 깊이·채움 높이를 넣어 ROOT/TOP·TP/PL TOP 이 같은 글자가 되지 않음).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initNde, readNdeFile } from '@core/nde'
import { quantize } from '../../../src/core/nde/units'
import { parseOpdBuffer, readOpdFile, type OpdFile } from '@core/opd'
import { opdImportWarnings } from '@core/opd/meta'
import { normalizeOpd, opdThicknessSuspect, OPD_SPEC_RULE } from '@core/opd/normalize'
import { fingerprint } from '../../../src/core/nde/fingerprint'
import { applyNameTemplate, folderSpecimenNote, suggestForItem } from '@core/import'
import type { NormalizedSetup } from '@shared/types'
import { RAW_DATA_DIR, X3_FILES, X4_TF_COMPOUND, X4_TF_LINEAR, listExampleFiles, EXAMPLES_DIR, opdPath } from '../../paths'
import { loadSurveyJson } from './surveyCsv'

const SURVEY = loadSurveyJson()
const ROWS = SURVEY.rows.filter((r) => existsSync(opdPath(String(r.path))))
const HAS = existsSync(RAW_DATA_DIR) && ROWS.length === SURVEY.rows.length && ROWS.length === 162

/** 기준표의 셋업 값 열 (스캔플랜을 가르는 값) */
const SETUP_COLUMNS = [
  'probeModel',
  'wedgeModel',
  'beams',
  'angleStartDeg',
  'angleStopDeg',
  'angleStepDeg',
  'thicknessMm',
  'weldFillHeightMm',
  'weldLandHeightMm',
  'skewDeg',
  'indexOffsetMm',
  'wedgeAngleDeg'
] as const

interface Item {
  path: string
  row: Record<string, unknown>
  file: OpdFile
  norm: NormalizedSetup
}

let cache: Item[] | null = null
async function all(): Promise<Item[]> {
  if (cache) return cache
  const out: Item[] = []
  for (const row of ROWS) {
    const file = await readOpdFile(opdPath(String(row.path)))
    out.push({ path: String(row.path), row, file, norm: normalizeOpd(file) })
  }
  cache = out
  return out
}

/** 묶음(파일 경로 집합)들을 비교하기 좋게 정렬 */
function partition<T>(items: T[], key: (x: T) => string, name: (x: T) => string): string[][] {
  const m = new Map<string, string[]>()
  for (const x of items) {
    const k = key(x)
    m.set(k, [...(m.get(k) ?? []), name(x)])
  }
  return [...m.values()].map((v) => v.sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1))
}

const fpOf = (items: Item[], suffix: string): string => {
  const hit = items.filter((i) => i.path.endsWith(suffix))
  expect(hit, suffix).toHaveLength(1)
  return hit[0]!.norm.fingerprint
}

/** 162개 (경로, 지문) 목록의 SHA-256 앞 16자리 — OPD_SPEC_RULE 3 · 읽기 규칙 4 (2026-10-07, 틀 코드 6 = V·추정 칸) */
const SPEC_SNAPSHOT = '068d7c31656670b0'

describe.skipIf(!HAS)('OPD 162개 → 스캔플랜 묶음', () => {
  it('지문 묶음 = 기준표 셋업 값(+ 집속 깊이) 묶음, 플랜 35개', async () => {
    const items = await all()
    const byFp = partition(items, (i) => i.norm.fingerprint, (i) => i.path)
    const bySurvey = partition(
      items,
      (i) => JSON.stringify([...SETUP_COLUMNS.map((c) => i.row[c]), Math.round(i.file.setup.focusDepthMm * 10) / 10]),
      (i) => i.path
    )
    expect(byFp).toEqual(bySurvey)
    expect(byFp).toHaveLength(35)
    // 기준표 값만으로는 32 묶음 — 집속 깊이로만 갈리는 3 묶음(TP01~TP10 ROOT·TOP, TP07 L)이 플랜을 더 나눈다
    expect(partition(items, (i) => JSON.stringify(SETUP_COLUMNS.map((c) => i.row[c])), (i) => i.path)).toHaveLength(32)
  })

  it('스펙 규칙 2 → 3 (틀 코드 6 = V·추정 칸 표시): 162개 플랜 묶음은 그대로 35개 — 새 칸은 이미 지문에 있던 코드에서 나온다', async () => {
    const items = await all()
    // 스펙 규칙 2 의 스펙으로 되돌린 지문: 코드 6 은 개선 모양·이름 null, 추정 칸 표시 없음
    const rule2 = (i: Item): string => {
      const spec = structuredClone(i.norm.spec)
      delete spec.specimen.estimatedFields
      if (spec.specimen.weld && spec.specimen.weld.templateCode === 6) Object.assign(spec.specimen.weld, { bevelShape: null, template: null })
      spec.groups[0]!.techniqueParams['opdSpecRule'] = 2
      return fingerprint(spec).fingerprint
    }
    expect(partition(items, (i) => i.norm.fingerprint, (i) => i.path)).toEqual(partition(items, rule2, (i) => i.path))
    // 한 플랜 안의 틀 코드는 하나: 5 = X(PL 29) · 6 = V(126) · 0 = 용접 없음(부식 7)
    const byCode = new Map<number | null, number>()
    for (const i of items) {
      const w = i.file.setup.weld
      const code = w ? w.templateCode : 0
      byCode.set(code, (byCode.get(code) ?? 0) + 1)
      const weld = i.norm.spec.specimen.weld
      if (code === 5) expect(weld, i.path).toMatchObject({ bevelShape: 'X', template: 'DoubleVOffset' })
      else if (code === 6) expect(weld, i.path).toMatchObject({ bevelShape: 'V', template: 'VOffset', root: { heightMm: 0 } })
      else expect(weld, i.path).toBeNull()
      expect(i.norm.spec.specimen.estimatedFields, i.path).toEqual(code === 6 ? ['shape', 'materialName', 'weld.template'] : ['shape', 'materialName'])
    }
    expect(Object.fromEntries(byCode)).toEqual({ 0: 7, 5: 29, 6: 126 })
  })

  it('L/R 은 다른 플랜, SEC20 36개·SEC25-2 7개는 각각 한 플랜(둘도 같은 셋업), 재스캔은 원래 플랜', async () => {
    const items = await all()
    for (const t of ['TP01', 'TP07', 'TP14']) {
      for (const part of ['ROOT', 'SW', 'TOP']) {
        expect(fpOf(items, `/${t}/${t}-${part}-L-01.opd`)).not.toBe(fpOf(items, `/${t}/${t}-${part}-R-01.opd`))
      }
    }
    expect(fpOf(items, '/PL23861/PL23861-ROOT-L-01.opd')).not.toBe(fpOf(items, '/PL23861/PL23861-ROOT-R-01.opd'))
    const sec20 = new Set(items.filter((i) => i.path.includes('/SEC20/')).map((i) => i.norm.fingerprint))
    const sec25 = new Set(items.filter((i) => i.path.includes('/SEC25-2/')).map((i) => i.norm.fingerprint))
    expect(items.filter((i) => i.path.includes('/SEC20/'))).toHaveLength(36)
    expect(items.filter((i) => i.path.includes('/SEC25-2/'))).toHaveLength(7)
    expect(sec20.size).toBe(1)
    expect(sec25.size).toBe(1)
    expect([...sec20]).toEqual([...sec25])
    for (const n of ['ROOT-L', 'ROOT-R', 'TOP-L', 'TOP-R']) {
      expect(fpOf(items, `/PL23861/re/PL23861-${n}-01.opd`)).toBe(fpOf(items, `/PL23861/PL23861-${n}-01.opd`))
    }
    // 같은 셋업의 PL 번호 ROOT·BOT 은 한 플랜, 리니어(SW)와 섹토리얼은 다른 플랜
    expect(fpOf(items, '/PL23862/PL23862_BOT_L_01.opd')).toBe(fpOf(items, '/PL23861/PL23861-ROOT-L-01.opd'))
    expect(fpOf(items, '/TP14/TP14-SW-L-01.opd')).not.toBe(fpOf(items, '/TP14/TP14-ROOT-L-01.opd'))
  })

  it('다시 읽어도(경로·바이트) 지문이 같다', async () => {
    const items = await all()
    for (const i of items) {
      const again = normalizeOpd(await readOpdFile(opdPath(i.path)))
      expect(again.fingerprint, i.path).toBe(i.norm.fingerprint)
      expect(again.spec).toEqual(i.norm.spec)
    }
    for (const i of items.filter((x) => /TP14-ROOT-L|sr1_04|S36-1\.opd|C10_01/.test(x.path))) {
      expect(normalizeOpd(parseOpdBuffer(readFileSync(opdPath(i.path)))).fingerprint, i.path).toBe(i.norm.fingerprint)
    }
  })

  it.skipIf(!X3_FILES.every((f) => existsSync(f)) || !existsSync(EXAMPLES_DIR) || !existsSync(X4_TF_COMPOUND))(
    '기존 NDE 시험 파일(X3 4·공식 예제 11·X4 2)과 지문이 겹치지 않는다',
    async () => {
      await initNde()
      const nde = [...X3_FILES, ...listExampleFiles(), X4_TF_COMPOUND, X4_TF_LINEAR]
      expect(nde).toHaveLength(17)
      const ndeFps = new Set<string>()
      for (const p of nde) ndeFps.add((await readNdeFile(p)).setup.fingerprint)
      const items = await all()
      for (const i of items) expect(ndeFps.has(i.norm.fingerprint), i.path).toBe(false)
      expect(items.every((i) => i.norm.spec.groups[0]!.techniqueParams['dataFormat'] === 'opd')).toBe(true)
    }
  )

  it('모르는 칸은 null, 아는 칸은 기준표 값', async () => {
    /** 기준표 값을 지문 격자(0.1)로 */
    const q = (v: unknown): number => quantize(Number(v), 0.1)
    for (const i of await all()) {
      const g = i.norm.spec.groups[0]!
      const p = g.probes[0]!
      expect(i.norm.spec.specimen).toMatchObject({ shape: 'plate', materialName: 'STEEL, MILD', thicknessMm: q(i.row.thicknessMm) })
      const weld = i.norm.spec.specimen.weld
      if (i.file.setup.weld) {
        expect(weld).toMatchObject({ hotPass: { heightMm: q(i.row.weldFillHeightMm) }, land: { heightMm: q(i.row.weldLandHeightMm) },
          root: { heightMm: q(i.file.setup.weld.root.heightMm) }, symmetry: 'Symmetric', templateCode: i.file.setup.weld.templateCode })
        expect(opdThicknessSuspect(i.norm.spec), i.path).toBe(false)
      } else expect(weld).toBeNull()
      expect(g).toMatchObject({ technique: 'PA', waveMode: i.file.setup.waveMode, focusing: { mode: null } })
      expect(p.probe).toMatchObject({ model: i.row.probeModel, elementCount: i.file.setup.probe.elementCount })
      expect(p.wedge).toMatchObject({ model: i.row.wedgeModel, wedgeAngleDeg: q(i.row.wedgeAngleDeg) })
      expect(p.position).toEqual({ uOffsetMm: 0, vOffsetMm: q(i.row.indexOffsetMm), skewDeg: q(i.row.skewDeg), surface: null })
      expect(g.techniqueParams).toMatchObject({ dataFormat: 'opd', opdSpecRule: 3, opdShapeCode: 0, opdMaterialCode: 30, opdWaveModeCode: i.file.setup.waveModeCode })
      expect(i.norm.acquisition.groups[0]!.beamCount).toBe(i.row.beams)
      expect(i.norm.summary.endsWith(' · OPD')).toBe(true)
    }
    const tp14 = (await all()).find((i) => i.path.endsWith('TP14-ROOT-L-01.opd'))!
    expect(tp14.norm.summary).toBe('판재 25 mm · V 개선 · 5L64-A32 · -40 mm · PA 섹터 45–70° · 집속 25 mm · 개선 높이 23+2 mm · OPD')
    const pl = (await all()).find((i) => i.path.endsWith('PL23861-ROOT-L-01.opd'))!
    // 양면 V: 두께 25 = 11.5 + 2 + 11.5 → '두께 확인 필요' 없음
    expect(pl.norm.summary).toBe('판재 25 mm · X 개선 · 5L64-A32 · -18 mm · PA 섹터 45–70° · 집속 25 mm · 개선 높이 11.5+2+11.5 mm · OPD')
    expect(applyNameTemplate('{name}', pl.norm.spec, pl.norm.summary, 'SP000')).toBe('25T · 5MHz · SK90 · 집속 25 · X개선 11.5+2+11.5 · OPD')
    expect(pl.norm.spec.specimen.weld).toMatchObject({ bevelShape: 'X', template: 'DoubleVOffset', templateCode: 5, symmetry: 'Symmetric', offsetMm: 1 })
    expect(tp14.norm.acquisition.groups[0]).toMatchObject({ gainDb: 33.6, referenceGainDb: null, velocityMps: 3244.4, tcgEnabled: true, scanQuantity: 301 })
    const sec25 = (await all()).find((i) => i.path.endsWith('S25-2 sr1_01.opd'))!
    expect(sec25.norm.acquisition.groups[0]).toMatchObject({ gainDb: 37.5, referenceGainDb: 31.5 })
  })

  it('지문 스냅샷 (읽기 규칙을 바꿨는데 스펙이 달라지면 OPD_SPEC_RULE 을 올릴 것) · 요약 줄은 플랜마다 다르다', async () => {
    const items = await all()
    const lines = items.map((i) => `${i.path}\t${i.norm.fingerprint}`).sort()
    const digest = createHash('sha256').update(lines.join('\n')).digest('hex')
    expect({ specRule: OPD_SPEC_RULE, digest: digest.slice(0, 16) }).toEqual({ specRule: 3, digest: SPEC_SNAPSHOT })
    // 서로 다른 플랜(지문)이 같은 요약 글자를 갖지 않는다
    const summaryOf = new Map<string, Set<string>>()
    for (const i of items) summaryOf.set(i.norm.summary, (summaryOf.get(i.norm.summary) ?? new Set()).add(i.norm.fingerprint))
    expect([...summaryOf].filter(([, fps]) => fps.size > 1).map(([s]) => s)).toEqual([])
    // 짧은 이름이 같은 플랜 수 (인덱스 오프셋만 1~2 mm 다른 회차 — 플랜을 합칠지는 사용자 결정 항목, README '아직 정하지 않은 것')
    const nameOf = new Map<string, Set<string>>()
    for (const i of items) {
      const n = applyNameTemplate('{name}', i.norm.spec, i.norm.summary, 'SP000')
      nameOf.set(n, (nameOf.get(n) ?? new Set()).add(i.norm.fingerprint))
    }
    const shared = [...nameOf].filter(([, fps]) => fps.size > 1)
    console.info(`[OPD 플랜 이름] 플랜 ${new Set(items.map((i) => i.norm.fingerprint)).size}개, 짧은 이름 ${nameOf.size}가지, 이름이 겹치는 이름 ${shared.length}개 (${shared.map(([n, f]) => `${n} ×${f.size}`).join(', ')})`)
  })

  it('미리보기 경고는 해당 파일에만: 두께 불일치 PL2386x 29개, 장비 저장 이름 1개, 2축 7개, 폴더 1개', async () => {
    const items = await all()
    const warned = (pred: (w: string) => boolean): string[] =>
      items.filter((i) => opdImportWarnings(i.file, basename(i.path)).some(pred)).map((i) => basename(i.path))
    const thick = warned((w) => w.startsWith('두께 칸'))
    expect(thick).toEqual([])
    expect(warned((w) => w.startsWith('장비 저장 이름'))).toEqual(['PL23865_BOT_L_02.opd'])
    const two = warned((w) => w.startsWith('2축 스캔') && w.includes('보관만'))
    expect(two).toHaveLength(7)
    expect(items.filter((i) => two.includes(basename(i.path))).every((i) => i.path.startsWith('04_부식시험/'))).toBe(true)
    expect(warned((w) => w.startsWith('위치 수'))).toEqual([])
    const folder = items.filter((i) => {
      const s = suggestForItem(i.file.header, basename(i.path))
      return folderSpecimenNote(opdPath(i.path), s.specimenId) !== null
    })
    expect(folder.map((i) => `${basename(dirname(i.path))}/${basename(i.path)}`)).toEqual(['TP06/tp07-root-l-01.opd'])
  })

  it('시편 ID 제안: PCN 은 장비 저장 이름의 TP·PL 번호', async () => {
    for (const i of (await all()).filter((x) => x.path.includes('/PCN교육/'))) {
      const s = suggestForItem(i.file.header, basename(i.path))
      expect(s.specimenSource, i.path).toBe('device-filename')
      expect(s.specimenId, i.path).toBe(/(TP\d+|PL\d+)/.exec(i.file.header.deviceFileName)![1])
    }
  })
})
