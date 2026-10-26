/**
 * 뷰어 '◀ 이전 · 다음 ▶' (OmniPC 조사 X9 — renderer/src/viewer/fileNav.ts): 같은 스캔플랜 파일 전체를 시편 → 이름 순서
 * (2026-10-07 기본값 (가) — 예전에는 같은 시편만). 숫자는 값으로 — 장비 Numeric 꼬리 `_0001`, 사람이 붙인 '-2'·'-10', 대소문자 무시,
 * 같은 이름은 ID 순, 끝에서 멈춤.
 */
import { describe, expect, it } from 'vitest'

const NAV = '../src/renderer/src/viewer/fileNav'
interface F {
  id: number
  planId: string
  specimenId: string
  storedFileName: string
}
const N = (await import(NAV)) as {
  compareFileNames: (a: F, b: F) => number
  fileNavOf: (items: F[], cur: Pick<F, 'id' | 'planId'>) => { files: F[]; index: number; prev: F | null; next: F | null }
}

const f = (id: number, name: string, planId = 'SP001', specimenId = 'TF-01'): F => ({ id, planId, specimenId, storedFileName: name })

describe('이전·다음 파일 순서', () => {
  const items = [
    f(1, 'TF_01_C_L_0010.nde'),
    f(2, 'TF_01_C_L_0002.nde'),
    f(3, 'TF_01_C_L_0001.nde'),
    f(4, 'tf_01_c_l_0003.nde'),
    f(5, 'TF_01_C_L_0001.nde', 'SP002'), // 다른 플랜
    f(6, 'TF_01_C_L_0004.nde', 'SP001', 'TF-02'), // 다른 시편
    f(7, 'TF_01_C_L_0100.nde')
  ]

  it('같은 플랜 전체, 시편 → 이름 순서 (대소문자 무시, 다른 플랜은 거름)', () => {
    const nav = N.fileNavOf(items, items[1]!)
    expect(nav.files.map((x) => x.id)).toEqual([3, 2, 4, 1, 7, 6])
    expect(nav.index).toBe(1)
    expect(nav.prev?.id).toBe(3)
    expect(nav.next?.id).toBe(4)
    // 시편 TF-01 의 마지막 파일 다음은 TF-02 의 첫 파일
    expect(N.fileNavOf(items, items[6]!).next?.id).toBe(6)
    expect(N.fileNavOf(items, items[5]!).prev?.id).toBe(7)
  })

  it('X3 2인 판독처럼 시편이 모두 다른 플랜도 넘길 수 있다 (시편은 사람이 읽는 순서)', () => {
    const xs = [f(4, '12T-SV-04-Cap on.nde', 'SP001', '12T-SV-04'), f(1, '12T-SV-01-Cap on.nde', 'SP001', '12T-SV-01'), f(10, '12T-SV-10-Cap on.nde', 'SP001', '12T-SV-10'), f(2, '12T-SV-02-Cap on.nde', 'SP001', '12T-SV-2')]
    const nav = N.fileNavOf(xs, xs[0]!)
    expect(nav.files.map((x) => x.id)).toEqual([1, 2, 4, 10])
    expect([nav.index, nav.prev?.id, nav.next?.id]).toEqual([2, 2, 10])
  })

  it('숫자는 값으로 (사람이 붙인 -2 · -10)', () => {
    const xs = [f(1, '12T-SV-10-Cap on.nde', 'SP9', 'S'), f(2, '12T-SV-2-Cap on.nde', 'SP9', 'S'), f(3, '12T-SV-1-Cap on.nde', 'SP9', 'S')]
    expect(N.fileNavOf(xs, xs[0]!).files.map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('꼬리 없는 원래 이름이 번호 꼬리 파일보다 앞 (줄기 먼저 — ICU 에서 \'_\' < \'.\' 라 통째로 견주면 뒤로 감)', () => {
    const xs = [f(1, 'TP14-ROOT-L_0010.opd', 'P', 'S'), f(2, 'TP14-ROOT-L.opd', 'P', 'S'), f(3, 'TP14-ROOT-L_0002.opd', 'P', 'S'), f(4, 'TP14-ROOT-L_0001.opd', 'P', 'S')]
    expect(N.fileNavOf(xs, xs[0]!).files.map((x) => x.storedFileName)).toEqual([
      'TP14-ROOT-L.opd',
      'TP14-ROOT-L_0001.opd',
      'TP14-ROOT-L_0002.opd',
      'TP14-ROOT-L_0010.opd'
    ])
    // 같은 줄기면 확장자 순, 그다음 ID
    const ys = [f(9, 'A.opd', 'P', 'S'), f(8, 'A.nde', 'P', 'S')]
    expect(N.fileNavOf(ys, ys[0]!).files.map((x) => x.id)).toEqual([8, 9])
  })

  it('처음·끝에서는 멈춘다 (돌아가지 않음)', () => {
    const first = N.fileNavOf(items, items[2]!)
    expect(first.index).toBe(0)
    expect(first.prev).toBeNull()
    expect(first.next?.id).toBe(2)
    const last = N.fileNavOf(items, items[5]!)
    expect(last.next).toBeNull()
    expect(last.prev?.id).toBe(7)
  })

  it('[ ] 를 끝까지 누르면 모든 파일을 한 번씩 (이름 순서 그대로)', () => {
    let cur: F | null = N.fileNavOf(items, items[1]!).files[0]!
    const seen: number[] = []
    while (cur) {
      seen.push(cur.id)
      cur = N.fileNavOf(items, cur).next
    }
    expect(seen).toEqual([3, 2, 4, 1, 7, 6])
    let back: F | null = items[5]!
    const rev: number[] = []
    while (back) {
      rev.push(back.id)
      back = N.fileNavOf(items, back).prev
    }
    expect(rev).toEqual([6, 7, 1, 4, 2, 3])
  })

  it('같은 이름이면 ID 순, 목록에 없는 파일·혼자인 파일은 이전·다음 없음', () => {
    const dup = [f(9, 'A.nde'), f(3, 'A.nde'), f(5, 'B.nde')]
    expect(N.fileNavOf(dup, dup[0]!).files.map((x) => x.id)).toEqual([3, 9, 5])
    expect(N.compareFileNames(dup[1]!, dup[0]!)).toBeLessThan(0)
    const gone = N.fileNavOf(dup, { id: 99, planId: 'SP001' })
    expect([gone.index, gone.prev, gone.next]).toEqual([-1, null, null])
    const alone = N.fileNavOf([f(1, 'X.nde')], f(1, 'X.nde'))
    expect([alone.files.length, alone.prev, alone.next]).toEqual([1, null, null])
  })
})
