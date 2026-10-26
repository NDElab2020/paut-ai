/**
 * 측정값 줄 오른쪽 키 안내 (이미지 보기). 다 들어가면 지금처럼 글자 한 줄, 좁아 잘리면(1280 폭에서 OPD 는 40 px 만 남음 — 2026-10-07 화면 점검)
 * '키 도움말 (?)' 단추 하나로 바꾸고, 누르면 키 목록을 단추 위로 펼친다(영상 위에 떠서 화면 배치·그림 크기는 그대로). Esc·바깥 누름·다시 누름으로 닫힌다.
 * 들어가는지는 숨긴 한 줄 글자의 폭으로 잰다(ResizeObserver — 창 크기·측정값 칸 수가 바뀔 때마다).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function KeysHint({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const m = measureRef.current
    if (!box || !m) return
    const check = (): void => setNarrow(m.offsetWidth > box.clientWidth + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(box)
    return () => ro.disconnect()
  }, [text])

  // 넓어지면 펼친 목록은 닫는다 (글자가 다시 보이므로)
  useEffect(() => {
    if (!narrow) setPos(null)
  }, [narrow])

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!pos) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null
      if (t && (popRef.current?.contains(t) || btnRef.current?.contains(t))) return
      setPos(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [pos])

  const toggle = (): void => {
    if (pos) {
      setPos(null)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // 측정값 줄은 overflow: hidden 이라 목록은 화면 기준(fixed)으로 단추 바로 위에 띄운다
    setPos({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 4 })
  }

  const items = text.split(' · ')
  return (
    <div className="viewer__keys" ref={boxRef}>
      <span className="viewer__keys-measure" ref={measureRef} aria-hidden="true">
        {text}
      </span>
      {narrow ? (
        <>
          <button
            ref={btnRef}
            type="button"
            className="btn btn--link viewer__keys-btn"
            aria-expanded={pos !== null}
            aria-controls={pos ? 'viewer-keys-pop' : undefined}
            title={text}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && pos) {
                e.stopPropagation()
                setPos(null)
              }
            }}
          >
            키 도움말 (?)
          </button>
          {pos ? (
            <div
              ref={popRef}
              id="viewer-keys-pop"
              className="viewer__keys-pop"
              role="region"
              aria-label="이미지 보기 키"
              style={{ right: pos.right, bottom: pos.bottom }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setPos(null)
                  btnRef.current?.focus()
                }
              }}
            >
              <ul>
                {items.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <span className="viewer__keys-text" title={text}>
          {text}
        </span>
      )}
    </div>
  )
}
