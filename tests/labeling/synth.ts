/** 라벨 모드 시험용 가짜 그룹·볼륨 (tests/imaging.test.ts 의 synthGroup 과 같은 배치) */
import type { ViewerGroup, ViewerSpecimen } from '@shared/imaging'

export const NT = 808

/** X3 12T-SV 와 비슷한 섹토리얼 (40~70°, 출사점이 각도에 따라 움직임) */
export function synthGroup(skewDeg: 90 | 270 = 90, id = 0, ns = 5): ViewerGroup {
  const s = skewDeg === 90 ? 1 : -1
  const nb = 31
  return {
    id,
    name: skewDeg === 90 ? 'Skew90' : 'Skew270',
    technique: 'pa-sectorial',
    supported: true,
    reason: null,
    verified: true,
    amplitudePath: null,
    statusPath: null,
    shape: [ns, nb, NT],
    bytes: ns * nb * NT * 2,
    ampScale: { rawMax: 32767, unitMax: 200 },
    scan: { offsetMm: 0, resolutionMm: 1, count: ns },
    ultrasound: { resolutionUs: 0.04, count: NT },
    beams: Array.from({ length: nb }, (_, b) => ({
      index: b,
      angleDeg: 40 + b,
      skewDeg,
      velocityMps: 3240,
      uOffsetMm: 0,
      vOffsetMm: s * (-38.3 + b * 0.33),
      t0Us: 8.05
    })),
    gates: [],
    cscanGateId: null,
    initialBeam: 15,
    gainDb: null,
    referenceGainDb: null,
    referenceAmplitudePct: null
  }
}

/** 리니어·컴파운드 (TF_01_L GR-2 · TF_01_C_L GR-1 비슷). storedReversed = 빔을 거꾸로 저장 */
export function synthPa(technique: 'pa-linear' | 'pa-compound', skewDeg: 90 | 270 = 90, storedReversed = false): ViewerGroup {
  const g = synthGroup(skewDeg)
  const s = skewDeg === 90 ? 1 : -1
  const n = technique === 'pa-linear' ? 24 : 19
  const beams = Array.from({ length: n }, (_, k) => ({
    index: k,
    angleDeg: technique === 'pa-linear' ? 60 : 50 + k,
    skewDeg,
    velocityMps: 3240,
    uOffsetMm: 0,
    vOffsetMm: s * (technique === 'pa-linear' ? -52.8 + k * 0.64 : -45.15 + k * 1.26),
    t0Us: 8.05
  }))
  const ordered = storedReversed ? beams.reverse().map((b, i) => ({ ...b, index: i })) : beams
  return { ...g, technique, shape: [g.shape[0], n, NT], beams: ordered }
}

/** 결정적 의사 난수 진폭 볼륨 (raw −2000..32767), 상태 비트: (스캔 1, 빔 3) 만 데이터 없음 */
export function synthVolume(g: ViewerGroup, seed = 7): { amplitude: Int16Array; status: Uint8Array } {
  const [ns, nb, nt] = g.shape
  const amplitude = new Int16Array(ns * nb * nt)
  let x = seed >>> 0
  for (let i = 0; i < amplitude.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    amplitude[i] = (x % 34768) - 2000
  }
  const status = new Uint8Array(ns * nb).fill(1)
  if (ns > 1 && nb > 3) status[1 * nb + 3] = 0
  return { amplitude, status }
}

export const PLATE_12: ViewerSpecimen = { shape: 'plate', thicknessMm: 12, weld: null }
