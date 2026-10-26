/**
 * 학습 데이터 내보내기의 규칙 (실데이터 없이): 세트 고르기 · 분할 잠금 · label_meta 저장 · .npy 머리 · PNG · 키 정렬 JSON · 상자 화소.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openCatalog } from '@core/catalog'
import {
  applySplitChanges,
  applyTestLock,
  boxPixels,
  cleanSetRule,
  cleanTrainingOptions,
  decideSceneImage,
  emptySplitState,
  encodePngRgb,
  npyHeader,
  parseSplitState,
  pickLabelSet,
  readSplitState,
  splitOf,
  stableJson,
  writeSplitState,
  type ImageViewport,
  type SetCandidate
} from '@core/labels/export'
import { DEFAULT_TRAINING_SET_RULE } from '@shared/api'
import type { SceneLabel, SceneObject } from '@shared/labels/derive'
import type { ReadingStage } from '@shared/labels/types'
import { readPng } from '../../helpers/png'

const work = mkdtempSync(join(tmpdir(), 'paut-train-rules-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const SHA = 'a'.repeat(64)
const cand = (labelerId: string, stage: ReadingStage, guideline = 'v1'): SetCandidate => ({
  sha256: SHA,
  labelerId,
  guidelineVersion: guideline,
  readingStage: stage,
  setId: `${SHA}|${labelerId}|${guideline}|${stage}`
})

describe('세트 고르기 (확정 > 대조 > 지정 라벨러 블라인드)', () => {
  const R = DEFAULT_TRAINING_SET_RULE
  it('단계 우선순위', () => {
    const all = [cand('kim', 'blind'), cand('lee', 'reconciled'), cand('park', 'final')]
    expect(pickLabelSet(SHA, all, R).chosen).toBe(all[2]!.setId)
    expect(pickLabelSet(SHA, all.slice(0, 2), R).chosen).toBe(all[1]!.setId)
    expect(pickLabelSet(SHA, all.slice(0, 2), R).reason).toContain('설계값 대조')
  })
  it('블라인드는 지정한 라벨러만', () => {
    const blind = [cand('kim', 'blind'), cand('lee', 'blind')]
    const none = pickLabelSet(SHA, blind, R)
    expect(none.chosen).toBeNull()
    expect(none.reason).toContain('라벨러를 지정')
    expect(pickLabelSet(SHA, blind, { ...R, blindLabelerId: 'lee' }).chosen).toBe(blind[1]!.setId)
    expect(pickLabelSet(SHA, blind, { ...R, blindLabelerId: 'choi' }).chosen).toBeNull()
  })
  it('같은 단계에 둘 이상이면 고르지 않고, 직접 고르면 그것', () => {
    const two = [cand('park', 'final'), cand('han', 'final'), cand('kim', 'blind')]
    const p = pickLabelSet(SHA, two, { ...R, blindLabelerId: 'kim' })
    expect(p.chosen).toBeNull()
    expect(p.reason).toContain('확정 세트가 2개')
    const forced = pickLabelSet(SHA, two, { ...R, overrides: { [SHA]: two[1]!.setId } })
    expect(forced.chosen).toBe(two[1]!.setId)
    expect(forced.reason).toContain('직접 고름')
    expect(pickLabelSet(SHA, two, { ...R, overrides: { [SHA]: 'x' } }).chosen).toBeNull()
  })
  it('단계를 빼면 그 단계는 쓰지 않는다 · 세트 없음', () => {
    const list = [cand('park', 'final'), cand('kim', 'blind')]
    expect(pickLabelSet(SHA, list, { stages: ['blind'], blindLabelerId: 'kim' }).chosen).toBe(list[1]!.setId)
    expect(pickLabelSet(SHA, [], R)).toEqual({ chosen: null, reason: '라벨 세트가 없습니다.' })
  })
  it('규칙 정리: 모르는 단계·겹침을 빼고, 잘못된 sha 키는 버린다', () => {
    expect(cleanSetRule({ stages: ['blind', 'x', 'blind', 'final'], blindLabelerId: ' kim ', overrides: { bad: 'q', [SHA]: 'z' } })).toEqual({
      stages: ['blind', 'final'],
      blindLabelerId: 'kim',
      overrides: { [SHA]: 'z' },
      testFinalOnly: true
    })
    expect(cleanSetRule(undefined)).toEqual({ stages: [], blindLabelerId: null, testFinalOnly: true })
    expect(cleanSetRule({ stages: ['final'], blindLabelerId: null, testFinalOnly: false }).testFinalOnly).toBe(false)
  })
})

describe('분할 · 시험 세트 잠금', () => {
  const ctx = { at: '2026-10-06T10:00:00+09:00', pcId: 'pc-a', labelerId: 'park' }
  it('시편 단위, 대소문자 무시, 지우기', () => {
    let s = applySplitChanges(emptySplitState(), [
      { specimenId: 'PL23833', split: 'train' },
      { specimenId: 'PL23840', split: 'test' }
    ], ctx).state
    expect(splitOf(s, 'pl23833')).toBe('train')
    expect(splitOf(s, 'PL23840')).toBe('test')
    expect(splitOf(s, 'PL0')).toBeNull()
    const r = applySplitChanges(s, [{ specimenId: 'pl23833', split: 'train' }], ctx)
    expect(r.changed).toBe(0)
    s = applySplitChanges(s, [{ specimenId: 'pl23833', split: null }], ctx).state
    expect(splitOf(s, 'PL23833')).toBeNull()
    expect(s.log.map((e) => e.action)).toEqual(['assign', 'assign', 'assign'])
    expect(() => applySplitChanges(s, [{ specimenId: 'A', split: 'train' }, { specimenId: 'a', split: 'val' }], ctx)).toThrow(/두 번/)
    expect(() => applySplitChanges(s, [{ specimenId: 'A', split: 'x' as never }], ctx)).toThrow(/분할 값/)
  })

  it('잠그면 test 로 넣거나 빼는 변경은 확인·이유가 있어야 하고 기록에 남는다', () => {
    let s = applySplitChanges(emptySplitState(), [
      { specimenId: 'S1', split: 'test' },
      { specimenId: 'S2', split: 'train' }
    ], ctx).state
    s = applyTestLock(s, true, ctx).state
    expect(s.testLock).toMatchObject({ locked: true, pcId: 'pc-a', labelerId: 'park' })
    // test 에서 빼기 · test 로 넣기 → 확인 없으면 아무것도 바꾸지 않고 CONFLICT
    for (const ch of [{ specimenId: 'S1', split: 'train' as const }, { specimenId: 'S2', split: 'test' as const }, { specimenId: 'S3', split: 'test' as const }]) {
      let err: unknown = null
      try {
        applySplitChanges(s, [ch], ctx)
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: 'CONFLICT' })
    }
    expect(() => applySplitChanges(s, [{ specimenId: 'S1', split: 'train' }], { ...ctx, confirmLocked: true, reason: '  ' })).toThrow(/잠겨/)
    // train ↔ val 은 잠금과 무관
    const tv = applySplitChanges(s, [{ specimenId: 'S2', split: 'val' }], ctx)
    expect(tv.changed).toBe(1)
    expect(tv.state.log.at(-1)).toMatchObject({ action: 'assign', from: 'train', to: 'val', reason: null })
    // 확인 + 이유
    const ok = applySplitChanges(s, [{ specimenId: 'S1', split: 'train' }], { ...ctx, confirmLocked: true, reason: '설계도 확인 뒤 시험 시편 교체' })
    expect(splitOf(ok.state, 'S1')).toBe('train')
    expect(ok.state.log.at(-1)).toMatchObject({ action: 'locked-change', specimenId: 'S1', from: 'test', to: 'train', reason: '설계도 확인 뒤 시험 시편 교체' })
    expect(splitOf(s, 'S1')).toBe('test') // 넘긴 상태는 그대로
    // 풀기도 확인·이유
    expect(() => applyTestLock(s, false, ctx)).toThrow(/잠겨/)
    const un = applyTestLock(s, false, { ...ctx, confirmLocked: true, reason: '시험 세트 다시 정함' })
    expect(un.state.testLock.locked).toBe(false)
    expect(un.state.log.at(-1)).toMatchObject({ action: 'unlock', reason: '시험 세트 다시 정함' })
    expect(applyTestLock(un.state, false, ctx).changed).toBe(false)
  })

  it('label_meta 에 저장 · 다시 열어도 그대로 · 다른 칸은 건드리지 않음', () => {
    const db = join(work, 'catalog.db')
    const cat = openCatalog(db)
    cat.labels.replica('pc-a') // label_meta 의 다른 칸(replicas)
    const writes = cat.labels.writeCount()
    expect(readSplitState(db)).toEqual(emptySplitState())
    let s = applySplitChanges(emptySplitState(), [{ specimenId: 'PL1', split: 'val' }], ctx).state
    s = applyTestLock(s, true, ctx).state
    writeSplitState(db, s)
    expect(readSplitState(db)).toEqual(s)
    expect(cat.labels.writeCount()).toBe(writes)
    expect(cat.labels.replica('pc-a').id).toBeTruthy()
    cat.close()
    const again = openCatalog(db)
    expect(splitOf(readSplitState(db), 'pl1')).toBe('val')
    again.close()
    expect(parseSplitState('{깨진')).toEqual(emptySplitState())
    expect(parseSplitState(JSON.stringify({ assignments: { a: { specimenId: 'A', split: 'nope' } } })).assignments).toEqual({})
  })
})

describe('파일 쓰기 도우미', () => {
  it('.npy 머리: 64 배수, 모양 글자', () => {
    const h = npyHeader('<i2', [301, 31, 808])
    expect(h.length % 64).toBe(0)
    expect(h.subarray(0, 8)).toEqual(Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]))
    expect(h.readUInt16LE(8)).toBe(h.length - 10)
    const text = h.toString('latin1', 10)
    expect(text).toMatch(/^\{'descr': '<i2', 'fortran_order': False, 'shape': \(301, 31, 808\), \} *\n$/)
    expect(npyHeader('|u1', [5]).toString('latin1', 10)).toContain("'shape': (5,)")
  })

  it('PNG: 테스트 헬퍼로 다시 읽으면 같은 화소, 같은 입력 → 같은 바이트', () => {
    const w = 7
    const h = 5
    const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 37) & 255)
    const png = encodePngRgb(w, h, rgb)
    const p = join(work, 't.png')
    writeFileSync(p, png)
    const img = readPng(p)
    expect([img.width, img.height]).toEqual([w, h])
    for (let i = 0; i < w * h; i++) {
      expect([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]]).toEqual([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255])
    }
    expect(encodePngRgb(w, h, rgb).equals(png)).toBe(true)
    expect(() => encodePngRgb(w, h, rgb.subarray(1))).toThrow()
  })

  it('키 정렬 JSON: 만든 순서와 무관, undefined 칸은 빠짐', () => {
    expect(stableJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}\n')
    expect(stableJson({ x: Infinity })).toBe('{"x":null}\n')
  })

  it('옵션 정리: 기본값·범위', () => {
    expect(cleanTrainingOptions({})).toEqual({ amplitude: true, images: true, mmPerPx: 0.1, maskMode: 'blackout', weakAs: 'ignore', unconfirmedObservation: 'keep' })
    expect(cleanTrainingOptions({ maskMode: 'exclude', weakAs: 'positive', images: false, fixedExportedAt: 'T' })).toMatchObject({
      maskMode: 'exclude',
      weakAs: 'positive',
      images: false,
      fixedExportedAt: 'T'
    })
    expect(() => cleanTrainingOptions({ mmPerPx: 5 })).toThrow(/화소 크기/)
  })

  it('상자 → 화소: 칸 중심 끝점이 든 화소를 포함, 그림 밖은 자름, 최소 1 화소', () => {
    const vp = { vMinMm: -30, vMaxMm: 33, depthMinMm: 0, depthMaxMm: 48, width: 630, height: 480, mmPerPx: 0.1, x0: -300, maxLeg: 4 } as ImageViewport
    expect(boxPixels(vp, { vMinMm: 2.7954, vMaxMm: 6.9057, depthMinMm: 14.5, depthMaxMm: 21.5302 })).toEqual([327, 145, 43, 71])
    expect(boxPixels(vp, { vMinMm: 1, vMaxMm: 1, depthMinMm: 2, depthMaxMm: 2 })).toEqual([310, 20, 1, 1])
    expect(boxPixels(vp, { vMinMm: -40, vMaxMm: 40, depthMinMm: -1, depthMaxMm: 99 })).toEqual([0, 0, 630, 480])
  })

  it('그림 장면 고르기: 장면 무시·검토 안 한 음성·가림 방식', () => {
    const obj = (o: Partial<SceneObject>): SceneObject =>
      ({ recordUuid: 'r', kind: 'defect', defectType: null, typeConfidence: null, policy: 'defect', leg: 1, status: 'positive', trainStatus: 'positive', reason: null, observation: 'record', signalPct: 90, box: {} as never, inReviewedGate: true, windowId: 'w', ...o }) as SceneObject
    const scene = (s: Partial<SceneLabel>): SceneLabel =>
      ({ groupId: 0, scanIndex: 0, scanMm: 0, state: 'negative', trainState: 'negative', reasons: [], reviewed: true, negativeRegion: null, objects: [], ...s }) as SceneLabel
    expect(decideSceneImage(scene({ reasons: ['quality-bad'] }), 'blackout')).toEqual({ use: false, why: 'scene-ignore' })
    expect(decideSceneImage(scene({ reviewed: false }), 'blackout')).toEqual({ use: false, why: 'unreviewed' })
    expect(decideSceneImage(scene({ reviewed: false, objects: [obj({})] }), 'blackout').use).toBe(true)
    const withIgnore = scene({ objects: [obj({}), obj({ status: 'weak', trainStatus: 'ignore', leg: 2, box: {} as never })] })
    const b = decideSceneImage(withIgnore, 'blackout')
    expect(b.use && [b.positives.length, b.ignores.length]).toEqual([1, 1])
    expect(decideSceneImage(withIgnore, 'exclude')).toEqual({ use: false, why: 'excluded' })
    // exclude 는 평가 기준 이상 신호가 있는 무시 객체만 센다 — '안 보임' 레그·약한 신호 무시 객체로 양성 장면을 빼지 않는다
    const quiet = scene({
      objects: [obj({}), obj({ status: 'ignore', trainStatus: 'ignore', reason: 'not-visible', leg: 2, signalPct: 90 }), obj({ status: 'ignore', trainStatus: 'ignore', reason: 'below-level', leg: 3, signalPct: 10 })]
    })
    expect(decideSceneImage(quiet, 'exclude', 31.8).use).toBe(true)
    const loud = scene({ objects: [obj({}), obj({ status: 'ignore', trainStatus: 'ignore', reason: 'weak-leg', leg: 2, signalPct: 50 })] })
    expect(decideSceneImage(loud, 'exclude', 31.8)).toEqual({ use: false, why: 'excluded' })
    expect(decideSceneImage(loud, 'separate').use).toBe(true)
  })

  it('시험(test) 분할 파일은 확정 세트만 (끄면 다른 분할과 같은 단계 순서)', () => {
    const all = (['blind', 'reconciled'] as ReadingStage[]).map((st) => cand('kim', st))
    const R2 = { ...DEFAULT_TRAINING_SET_RULE, blindLabelerId: 'kim' }
    expect(pickLabelSet(SHA, all, R2, 'test')).toMatchObject({ chosen: null })
    expect(pickLabelSet(SHA, all, R2, 'test').reason).toContain('시험(test)')
    expect(pickLabelSet(SHA, all, R2, 'train').chosen).toBe(all[1]!.setId)
    expect(pickLabelSet(SHA, all, { ...R2, testFinalOnly: false }, 'test').chosen).toBe(all[1]!.setId)
    // 직접 고른 세트도 확정이어야
    expect(pickLabelSet(SHA, all, { ...R2, overrides: { [SHA]: all[0]!.setId } }, 'test').chosen).toBeNull()
    const withFinal = [...all, cand('park', 'final')]
    expect(pickLabelSet(SHA, withFinal, R2, 'test').chosen).toBe(withFinal[2]!.setId)
  })
})
