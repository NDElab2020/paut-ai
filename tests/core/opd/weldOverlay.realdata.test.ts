/**
 * OPD 용접 덮개 ↔ OmniPC 6.6 화면 덮개선 · 같은 설계 X3 .nde 덮개 (실데이터가 있는 PC 에서만).
 *
 * 화면 값은 사람이 캡처 픽셀에서 잰 값이다(우리 계산값 아님). 펼친 깊이 D(mm) 에서 중심선 ~ 개선면 반폭(왼쪽·오른쪽).
 * - PL23861-ROOT-L-01 (틀 코드 5, 양면 V): `검증_OPD정보_2026-10-07/OmniPC_PL23861_설정.jpg` (3456 × 2166).
 *   S-scan 왼쪽 깊이 눈금 10/20/30/40 mm 선(18.0 px/mm), 아래 가로 눈금 −20…20 mm(17.7 px/mm), 덮개선 안쪽 가장자리.
 *   2026-10-07 반박 검토에서 잼 — 목(Land)이 D 11.1~13.6·36.4~38.6, 가장 넓은 곳이 두께 선(D 25).
 * - TP14-ROOT-L-01 (코드 6)·SEC25-2 sr1_01 (코드 6): `OPD_조사/4_용접형상.md` 4절 표.
 * 허용치 0.2 mm (선 두께·눈금 읽기). 덮개 모양(V·X)과 반 간격·Land·Hot Pass·Root 칸의 뜻을 화면으로 확인하는 시험이다.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readOpdFile } from '@core/opd'
import { opdViewerWeld } from '@core/opd/viewer'
import { initNde } from '@core/nde'
import { readViewerInfo } from '@core/nde/viewer'
import { foldDepth } from '@shared/imaging/coords'
import { bevelHalfWidth, isDrawableWeld, weldOverlay } from '@shared/imaging/weld'
import { OPD_FILES, X3_FILES, opdPath } from '../../paths'

const TOL_MM = 0.2

/** [펼친 깊이, 화면 왼쪽 반폭, 화면 오른쪽 반폭] */
type Measured = Array<[depthMm: number, leftMm: number, rightMm: number]>

const SCREENS: Array<{ name: string; rel: string; template: number; shape: 'V' | 'X'; points: Measured }> = [
  {
    name: 'PL23861-ROOT-L-01 (양면 V)',
    rel: OPD_FILES.pl23861RootL,
    template: 5,
    shape: 'X',
    points: [
      [12.5, 0.91, 0.91],
      [16.11, 2.49, 2.43],
      [20.0, 4.7, 4.64],
      [24.72, 7.41, 7.41],
      [30.0, 4.64, 4.7],
      [33.33, 2.77, 2.83],
      [37.5, 0.91, 0.91]
    ]
  },
  {
    name: 'TP14-ROOT-L-01 (한면 V)',
    rel: OPD_FILES.tp14RootL,
    template: 6,
    shape: 'V',
    points: [
      [28.9, 2.03, 2.15],
      [31.4, 3.29, 3.53],
      [39.8, 8.19, 8.4],
      [43.1, 10.18, 10.34],
      [44.8, 11.16, 11.32]
    ]
  },
  {
    name: 'SEC25-2 sr1_01 (한면 V)',
    rel: OPD_FILES.sec25sr1_01,
    template: 6,
    shape: 'V',
    // 목 반폭 2.99 (바닥 = D 6.4), 겉면 반폭 5.75 (D 0 은 화면 밖이라 다음 레그 D 12.8)
    points: [
      [6.4, 2.99, 2.99],
      [12.8, 5.75, 5.75]
    ]
  }
]

describe('OPD 용접 덮개 ↔ OmniPC 화면 덮개선 (픽셀로 잰 값)', () => {
  for (const s of SCREENS) {
    describe.skipIf(!existsSync(opdPath(s.rel)))(s.name, () => {
      it(`틀 코드 ${s.template} → ${s.shape} 로 그릴 수 있고, 화면 반폭과 ${TOL_MM} mm 안 (좌우 평균)`, async () => {
        const file = await readOpdFile(opdPath(s.rel))
        const t = file.setup.thicknessMm
        const weld = opdViewerWeld(file)!
        expect(file.setup.weld?.templateCode).toBe(s.template)
        expect(weld.bevelShape).toBe(s.shape)
        expect(weld.geometryEstimated).toBe(false)
        expect(isDrawableWeld(weld, t)).toBe(true)
        for (const [d, l, r] of s.points) {
          const ours = bevelHalfWidth(weld, t, foldDepth(d, t).depthMm)
          expect(Math.abs(ours - (l + r) / 2), `D ${d} mm: 계산 ${ours.toFixed(2)} · 화면 ${l}/${r}`).toBeLessThanOrEqual(TOL_MM)
        }
        // OPD 캡처에는 열영향부(HAZ) 지그재그가 없다 (X3 .nde 는 HAZ 10 mm 선을 그림) — 앱도 그리지 않는다
        expect(weldOverlay(weld, t, 2 * t)!.haz).toEqual([])
      })
    })
  }
})

describe.skipIf(!existsSync(opdPath(OPD_FILES.tp01SwL)) || !existsSync(X3_FILES[0]!))('같은 12T SV 설계: OPD TP01 덮개 = X3 .nde 덮개', () => {
  it('개선면 지그재그 점이 같고(반 간격 1·Land 2·Hot Pass 10/30°), 다른 점은 HAZ 선 유무뿐', async () => {
    await initNde()
    const nde = await readViewerInfo(X3_FILES[0]!)
    const opd = await readOpdFile(opdPath(OPD_FILES.tp01SwL))
    const t = opd.setup.thicknessMm
    expect(t).toBe(nde.specimen.thicknessMm)
    const ow = opdViewerWeld(opd)!
    const nw = nde.specimen.weld!
    expect({ offset: ow.offsetMm, land: ow.landHeightMm, hot: ow.hotPass }).toEqual({ offset: nw.offsetMm, land: nw.landHeightMm, hot: nw.hotPass })
    const a = weldOverlay(ow, t, 2 * t, 0.25)!
    const b = weldOverlay(nw, t, 2 * t, 0.25)!
    expect(a.bevel).toEqual(b.bevel)
    expect(b.haz).toHaveLength(2) // X3 HAZ 10 mm
    expect(a.haz).toEqual([]) // OPD HAZ 칸 미해독(후보 칸 0) — OmniPC 도 OPD 에는 HAZ 선을 그리지 않음
  })
})
