import { describe, expect, it } from 'vitest'
import { deg, mhz, mm, quantize, wrapDeg } from '@core/nde/units'

describe('허용오차 반올림 (격자 중간값 노이즈)', () => {
  it('같은 값의 부동소수 표현 차이로 갈리지 않는다', () => {
    // 공식 4.2 Weld_COD 예제의 두께 표현
    expect(mm(0.006150000000000006)).toBe(mm(0.00615))
    expect(mm(0.00615 - 1e-12)).toBe(mm(0.00615))
    // 3/4" = 0.75 * 0.0254 (= 0.019049999999999997)
    expect(mm(0.75 * 0.0254)).toBe(mm(0.01905))
    expect(mm(0.01905)).toBe(19.1)
    // 1/4" 근처 ±1e-12 m
    expect(mm(0.00635 + 1e-12)).toBe(mm(0.00635))
    expect(mm(0.00635 - 1e-12)).toBe(mm(0.00635))
    expect(mm(0.00635)).toBe(6.4)
    expect(mm(0.01235)).toBe(12.4)
    expect(mm(0.00115)).toBe(1.2)
  })

  it('± 대칭이고 -0 이 없다', () => {
    expect(mm(-0.00635)).toBe(-6.4)
    expect(mm(-0.015)).toBe(-15)
    expect(mm(-1e-8)).toBe(0)
    expect(Object.is(mm(-1e-8), -0)).toBe(false)
  })

  it('일반 값', () => {
    expect(mm(0.012)).toBe(12)
    expect(mm(0.023)).toBe(23)
    expect(deg(36.1)).toBe(36.1)
    expect(mhz(5e6)).toBe(5)
    expect(mhz(2.25e6)).toBe(2.25)
    expect(quantize(3242.84, 0.1)).toBe(3242.8)
    expect(quantize(0.0125, 0.0001)).toBe(0.0125)
  })

  it('스큐 0~360 정규화', () => {
    expect(wrapDeg(360)).toBe(0)
    expect(wrapDeg(359.96)).toBe(0)
    expect(wrapDeg(-90)).toBe(270)
    expect(wrapDeg(270)).toBe(270)
    expect(wrapDeg(null)).toBe(null)
  })
})
