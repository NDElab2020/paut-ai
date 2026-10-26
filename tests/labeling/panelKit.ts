/**
 * 라벨 패널 시험 도구: 진폭 기준(Ref)이 있는 가짜 그룹, 위치를 아는 반사체·형상 띠 진폭, 초안 점 만들기.
 * 렌더러 모듈은 tsconfig.node.json 범위 밖이라 경로 글자로 읽는다 (overlay.test.ts 와 같은 방식) — loadRenderer.
 */
import { samplePoint, sscanLookupAt, sscanLookupBeamSample, type ViewerGate, type ViewerGroup } from '@shared/imaging'
import { amplitudeFromFunction, type GroupAmplitude } from '@shared/labels'
import { synthGroup } from './synth'

export const T = 12
export const SHA = 'b'.repeat(64)
export const KEY = { sha256: SHA, labelerId: 'kim-l2', guidelineVersion: 'v1', readingStage: 'blind' as const }

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** 렌더러 모듈 읽기 (타입 검사 밖 — 쓰는 쪽이 모양을 안다) */
export async function loadRenderer(rel: string): Promise<any> {
  return import(/* @vite-ignore */ `../../src/renderer/src/labeling/${rel}`)
}

/** X3 와 같은 진폭 기준(파일 이득 24.7, 기준 이득 18.7, 기준 진폭 80 → Ref ≈ 159.6 %, 평가 기준 ≈ 31.8 %) + 게이트 A 펼친 7~28 mm */
export function levelGroup(skew: 90 | 270 = 90, id = 0, ns = 41): ViewerGroup {
  const g = synthGroup(skew, id, ns)
  const depthWindow = (d0: number, d1: number): { startUs: number[]; lengthUs: number[] } => {
    const startUs = g.beams.map((b) => (2 * (d0 / Math.cos((b.angleDeg * Math.PI) / 180))) / (b.velocityMps / 1000))
    const endUs = g.beams.map((b) => (2 * (d1 / Math.cos((b.angleDeg * Math.PI) / 180))) / (b.velocityMps / 1000))
    return { startUs, lengthUs: endUs.map((e, i) => e - startUs[i]!) }
  }
  const gate: ViewerGate = { id: 1, name: 'Gate A', geometry: 'TrueDepth', sync: 'Pulse', ...depthWindow(7, 28), thresholdPct: 20, supported: true, producesCscan: true }
  return { ...g, gainDb: 24.7, referenceGainDb: 18.7, referenceAmplitudePct: 80, gates: [gate], cscanGateId: 1 }
}

export interface Blob {
  /** 스캔 칸 범위 [k0, k1] (안은 같은 세기) */
  k0: number
  k1: number
  vMm: number
  /** 펼친 깊이 */
  dMm: number
  pct: number
  sigmaMm?: number
}

/** 칸마다 (V, 펼친 깊이)를 미리 계산해 둔 합성 진폭: 바탕 noise + 반사체들(가우시안, 최대값끼리 겹침) */
export function blobAmplitude(g: ViewerGroup, blobs: readonly Blob[], noisePct = 2): GroupAmplitude {
  const [, nb, nt] = g.shape
  const vv = new Float64Array(nb * nt)
  const dd = new Float64Array(nb * nt)
  for (let b = 0; b < nb; b++) {
    for (let i = 0; i < nt; i++) {
      const p = samplePoint(g.beams[b]!, i, g.ultrasound)
      vv[b * nt + i] = p.vMm
      dd[b * nt + i] = p.depthMm
    }
  }
  return amplitudeFromFunction(g.shape, (k, b, i) => {
    let v = noisePct
    const c = b * nt + i
    for (const r of blobs) {
      if (k < r.k0 || k > r.k1) continue
      const s = r.sigmaMm ?? 0.7
      const a = r.pct * Math.exp(-((vv[c]! - r.vMm) ** 2 + (dd[c]! - r.dMm) ** 2) / (2 * s * s))
      if (a > v) v = a
    }
    return v
  })
}

/** S-scan 위 (V, 펼친 깊이) 점 → 초안 점 (조회표와 같은 앵커 빔·샘플). 부채꼴 밖이면 예외 */
export function draftPoint(g: ViewerGroup, role: string, scanIndex: number, vMm: number, unfoldedDepthMm: number, extra: Record<string, unknown> = {}) {
  const l = sscanLookupAt(g, vMm, unfoldedDepthMm)
  if (!l) throw new Error(`부채꼴 밖: ${vMm}, ${unfoldedDepthMm}`)
  const { beam, sample } = sscanLookupBeamSample(l)
  return { role, groupId: g.id, scanIndex, scanMm: g.scan.offsetMm + scanIndex * g.scan.resolutionMm, vMm, unfoldedDepthMm, beam, sample, displayGainDb: 0, ...extra }
}
