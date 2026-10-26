/**
 * 이미지 보기 서비스 경로로 OPD 열기 (Electron 없이 core 서비스만, 실데이터가 있는 PC 에서만):
 *   viewer:open → 형식 분기(.opd 사본 → core/opd/viewer) → ViewerFileInfo('opd'), viewer:chunk → Int16Array + 상태,
 *   저장소를 바꾸면 옛 key 로는 CONFLICT, 2축(부식)은 NDE_UNSUPPORTED. 원본은 복사만 하고 그대로다.
 * 가져오기 파이프라인 대신 catalog 에 바로 기록한 저장소를 쓴다(viewerKit.ts).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readOpdAmplitude } from '@core/opd'
import { createAppService, type AppService } from '@core/service'
import { chunkRanges } from '@shared/imaging'
import { OPD_FILES, opdPath } from '../../paths'
import { createOpdStore } from './viewerKit'

const TP14 = opdPath(OPD_FILES.tp14RootL)
const SEC25 = opdPath(OPD_FILES.sec25sr1_01)
const C10 = opdPath(OPD_FILES.corrosionC10)
const HAS = [TP14, SEC25, C10].every((p) => existsSync(p))

const work = mkdtempSync(join(tmpdir(), 'paut-opd-svc-'))
const storeA = join(work, '저장소A')
const storeB = join(work, '저장소B')
const storeC = join(work, '저장소C')
let service: AppService

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'OK'
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

function fingerprintOf(path: string): { size: number; mtimeMs: number; sha256: string } {
  const st = statSync(path)
  return { size: st.size, mtimeMs: st.mtimeMs, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
}

const originals = new Map<string, ReturnType<typeof fingerprintOf>>()

beforeAll(() => {
  if (!HAS) return
  for (const p of [TP14, SEC25, C10]) originals.set(p, fingerprintOf(p))
  createOpdStore(storeA, [TP14])
  createOpdStore(storeB, [SEC25])
  createOpdStore(storeC, [C10])
  service = createAppService({ settingsPath: join(work, 'settings.json') })
})

afterAll(() => {
  service?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!HAS)('이미지 보기 서비스: OPD (viewer:open · viewer:chunk)', () => {
  it('viewer:open = OPD 정보(대조 전), viewer:chunk = Int16Array 조각(래스터 값 그대로) + 상태, 옛 key 는 CONFLICT', async () => {
    await service.setStoreRoot(storeA)
    const id = (await service.listFiles({ limit: 10 })).items[0]!.id
    const openA = await service.viewerOpen(id)
    expect(openA.key).toBe(`${storeA}|${id}|${openA.file.meta.sha256}`)
    expect(openA.info.formatFamily).toBe('opd')
    const g = openA.info.groups[0]!
    expect([g.supported, g.verified, g.shape]).toEqual([true, false, [301, 26, 320]])
    expect(g.amplitudeSource?.kind).toBe('opd-raster')

    const chunk = await service.viewerChunk(id, openA.key, g.id, 100, 3)
    expect(chunk).toMatchObject({ groupId: g.id, scanStart: 100, scanCount: 3 })
    expect(chunk.amplitude).toBeInstanceOf(Int16Array)
    expect(chunk.amplitude.length).toBe(3 * 26 * 320)
    expect(chunk.status).toBeInstanceOf(Uint8Array)
    const ref = await readOpdAmplitude(TP14, 100, 3, { format: 'int16' })
    expect(Array.from(chunk.amplitude)).toEqual(Array.from(ref.amplitude))

    // 그룹 전체를 조각 상한으로 나눠 받으면 래스터 전체와 같다
    let total = 0
    for (const [s, n] of chunkRanges(g.shape)) total += (await service.viewerChunk(id, openA.key, g.id, s, n)).amplitude.length
    expect(total).toBe(301 * 26 * 320)

    expect(await code(service.viewerChunk(id, openA.key, 7, 0, 1))).toBe('NOT_FOUND')
    expect(await code(service.viewerChunk(id, openA.key, g.id, 301, 1))).toBe('INVALID_ARGUMENT')

    // 저장소 B 의 같은 번호 파일(SEC25-2) — A 의 key 로는 받지 못한다
    await service.setStoreRoot(storeB)
    const idB = (await service.listFiles({ limit: 10 })).items[0]!.id
    expect(idB).toBe(id)
    expect(await code(service.viewerChunk(id, openA.key, g.id, 0, 1))).toBe('CONFLICT')
    const openB = await service.viewerOpen(idB)
    expect(openB.key).not.toBe(openA.key)
    const gB = openB.info.groups[0]!
    expect(gB.shape).toEqual([801, 36, 320])
    expect((await service.viewerChunk(idB, openB.key, gB.id, 0, 2)).amplitude.length).toBe(2 * 36 * 320)
    expect(await code(service.viewerChunk(idB, openA.key, gB.id, 0, 2))).toBe('CONFLICT')

    // A 로 돌아가면 A 의 key 가 다시 맞는다
    await service.setStoreRoot(storeA)
    const again = await service.viewerChunk(id, openA.key, g.id, 100, 3)
    expect(Array.from(again.amplitude)).toEqual(Array.from(chunk.amplitude))
  })

  it('2축(부식) OPD 는 열리지만 그룹을 그리지 않고, 조각 요청은 NDE_UNSUPPORTED', async () => {
    await service.setStoreRoot(storeC)
    const id = (await service.listFiles({ limit: 10 })).items[0]!.id
    const o = await service.viewerOpen(id)
    const g = o.info.groups[0]!
    expect(g.supported).toBe(false)
    expect(g.reason).toMatch(/^2축 스캔/)
    expect(await code(service.viewerChunk(id, o.key, g.id, 0, 1))).toBe('NDE_UNSUPPORTED')
  })

  it('원본은 읽기만 (크기·수정 시각·SHA-256 그대로)', () => {
    for (const [p, f] of originals) expect(fingerprintOf(p)).toEqual(f)
  })
})
