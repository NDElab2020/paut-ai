/**
 * 이미지 보기 서비스 (Electron 없이 core 서비스만): viewer:chunk 는 viewer:open 의 키에 묶인다.
 * 계획 점검 8 — 저장소 A 에서 #N 을 연 뒤 저장소 B 로 바꾸면 A 의 키로 조각을 받을 수 없고(CONFLICT),
 * 다시 열면 B 의 키·메타가 온다. X3 실데이터를 임시 저장소 두 곳에 하나씩 가져와 쓴다 (원본은 읽기만).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAppService, type AppService } from '@core/service'
import type { ViewerOpenResult } from '@shared/api'
import type { ImportCommitRequest, ImportPreview } from '@shared/types'
import { X3_FILES } from '../../paths'

const hasData = existsSync(X3_FILES[0]!) && existsSync(X3_FILES[1]!)

const work = mkdtempSync(join(tmpdir(), 'paut-viewer-'))
const storeA = join(work, '저장소A')
const storeB = join(work, '저장소B')
let service: AppService

/** 미리보기 그대로 확정 (제안된 시편 ID·태그 사용) */
function acceptAll(p: ImportPreview): ImportCommitRequest {
  return {
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
  }
}

/** 저장소를 고르고 파일 하나를 가져와 그 파일 ID 를 돌려준다 */
async function importInto(store: string, file: string): Promise<number> {
  await service.setStoreRoot(store)
  const r = await service.commit(acceptAll(await service.analyze([file])))
  expect(r).toMatchObject({ copiedCount: 1, failedCount: 0 })
  const files = await service.listFiles({ limit: 10 })
  expect(files.total).toBe(1)
  return files.items[0]!.id
}

/** 그릴 수 있는 첫 그룹 */
function firstGroup(o: ViewerOpenResult): { id: number; nb: number; nt: number } {
  const g = o.info.groups.find((x) => x.supported)
  expect(g, '그릴 수 있는 그룹').toBeTruthy()
  return { id: g!.id, nb: g!.shape[1], nt: g!.shape[2] }
}

beforeAll(() => {
  service = createAppService({ settingsPath: join(work, 'settings.json') })
})

afterAll(() => {
  service?.close()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(!hasData)('이미지 보기: 열기 키와 저장소 전환', () => {
  it('A 에서 연 #N 의 키로 B 의 #N 조각을 받지 못하고(CONFLICT), 다시 열면 B 의 키가 온다', async () => {
    // 저장소 A·B 에 서로 다른 파일을 하나씩 → 둘 다 같은 파일 번호
    const idA = await importInto(storeA, X3_FILES[0]!)
    const openA = await service.viewerOpen(idA)
    expect(openA.key).toBe(`${storeA}|${idA}|${openA.file.meta.sha256}`)
    const g = firstGroup(openA)
    const chunkA = await service.viewerChunk(idA, openA.key, g.id, 0, 2)
    expect(chunkA).toMatchObject({ groupId: g.id, scanStart: 0, scanCount: 2 })
    expect(chunkA.amplitude.length).toBe(2 * g.nb * g.nt)

    const idB = await importInto(storeB, X3_FILES[1]!)
    expect(idB).toBe(idA)

    // 저장소를 바꾼 뒤 A 의 키로 요청 → CONFLICT (B 의 같은 번호 파일을 읽어 주지 않음)
    await expect(service.viewerChunk(idA, openA.key, g.id, 0, 2)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '저장소나 파일이 바뀌었습니다. 다시 여세요.'
    })
    await expect(service.viewerChunk(idA, 'storeRoot|1|sha', g.id, 0, 1)).rejects.toMatchObject({ code: 'CONFLICT' })

    // 다시 열면 B 의 키·파일 → 그 키로는 조각을 받는다
    const openB = await service.viewerOpen(idB)
    expect(openB.key).not.toBe(openA.key)
    expect(openB.key).toBe(`${storeB}|${idB}|${openB.file.meta.sha256}`)
    expect(openB.file.meta.sha256).not.toBe(openA.file.meta.sha256)
    expect(openB.file.storedFileName).not.toBe(openA.file.storedFileName)
    const gB = firstGroup(openB)
    const chunkB = await service.viewerChunk(idB, openB.key, gB.id, 0, 2)
    expect(chunkB.amplitude.length).toBe(2 * gB.nb * gB.nt)
    await expect(service.viewerChunk(idB, openA.key, gB.id, 0, 2)).rejects.toMatchObject({ code: 'CONFLICT' })

    // A 로 돌아가면 A 의 키가 다시 맞고(같은 저장소·같은 사본), B 의 키는 거부
    await service.setStoreRoot(storeA)
    const again = await service.viewerChunk(idA, openA.key, g.id, 0, 2)
    expect(Array.from(again.amplitude)).toEqual(Array.from(chunkA.amplitude))
    await expect(service.viewerChunk(idA, openB.key, g.id, 0, 2)).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
