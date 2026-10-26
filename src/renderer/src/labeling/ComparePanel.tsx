/**
 * 검수 비교 보기 (라벨 패널 자리, 읽기 전용) — 라벨 관리 → 검수 → '영상으로 보기'로 연 두 세트(A·B)의 기록을 영상 위에 함께 그린다.
 * Level III 가 같은 지시인지·루트 띠인지를 숫자 표가 아니라 영상에서 보고 정하게 (계획 5절 3단계 '2인 나란히 보기').
 *   A 기록 = 기록 자홍, B 기록 = 주황(compare). 번호는 'A3'·'B#A2' 처럼 세트 글자 + 지시 번호.
 *   행을 누르면 그 기록의 최대 진폭 칸으로 간다. 고치기·저장은 없다(결정은 검수 화면에서).
 */
import { useEffect, useMemo, useState } from 'react'
import { RECORD_KIND, type IndicationRecord, type LabelSetKey } from '@shared/labels'
import { getApi, toUiError, unwrap, type UiError } from '../api'
import { ErrorNotice } from '../components/ErrorNotice'
import { num } from '../lib/format'
import type { OverlayTone, ViewOverlay } from '../viewer/overlay'
import { mergeOverlays } from '../viewer/overlay'
import { STAGE_SHORT } from './labelSet'
import { gotoOf, recordNumbers } from './record'
import { recordOverlays } from './recordOverlays'
import { recordDetail } from './recordText'
import type { ComparePanelProps, LabelCompareSide, LabelViewOverlays } from './types'

type Side = 'a' | 'b'

/** B 쪽 덮개: 기록 색을 주황으로, id·번호 글자에 세트 글자를 붙인다 (A·B 덮개를 합쳐도 겹치지 않게) */
function retone(ov: ViewOverlay | undefined, side: Side): ViewOverlay | undefined {
  if (!ov) return undefined
  const tone = (t: OverlayTone): OverlayTone => (side === 'b' && (t === 'record' || t === 'ghost' || t === 'echo') ? 'compare' : t)
  const tag = side.toUpperCase()
  const label = (l: string | undefined): string | undefined => (l ? `${tag}${l}` : l)
  return {
    ...(ov.rects ? { rects: ov.rects.map((r) => ({ ...r, id: `${side}:${r.id}`, tone: tone(r.tone), label: label(r.label) })) } : {}),
    ...(ov.points ? { points: ov.points.map((p) => ({ ...p, id: `${side}:${p.id}`, tone: tone(p.tone), label: label(p.label) })) } : {}),
    ...(ov.vlines ? { vlines: ov.vlines.map((l) => ({ ...l, id: `${side}:${l.id}`, tone: tone(l.tone), label: label(l.label) })) } : {}),
    ...(ov.hlines ? { hlines: ov.hlines.map((l) => ({ ...l, id: `${side}:${l.id}`, tone: tone(l.tone), label: label(l.label) })) } : {})
  }
}

function mergeSides(a: LabelViewOverlays | null, b: LabelViewOverlays | null): LabelViewOverlays | null {
  if (!a && !b) return null
  const ids = new Set<number>([...Object.keys(a?.sscan ?? {}), ...Object.keys(b?.sscan ?? {}), ...Object.keys(a?.cscan ?? {}), ...Object.keys(b?.cscan ?? {})].map(Number))
  const sscan: Record<number, ViewOverlay> = {}
  const cscan: Record<number, ViewOverlay> = {}
  for (const id of ids) {
    const s = mergeOverlays(retone(a?.sscan?.[id], 'a'), retone(b?.sscan?.[id], 'b'))
    const c = mergeOverlays(retone(a?.cscan?.[id], 'a'), retone(b?.cscan?.[id], 'b'))
    if (s) sscan[id] = s
    if (c) cscan[id] = c
  }
  const bscan = mergeOverlays(retone(a?.bscan, 'a'), retone(b?.bscan, 'b'))
  return { sscan, cscan, ...(bscan ? { bscan } : {}) }
}

function sideText(s: LabelCompareSide): string {
  return `${s.labelerId} · ${STAGE_SHORT[s.readingStage]} · ${s.guidelineVersion}`
}

export function ComparePanel(p: ComparePanelProps) {
  const api = getApi()
  const [recs, setRecs] = useState<{ a: IndicationRecord[]; b: IndicationRecord[] } | null>(null)
  const [error, setError] = useState<UiError | null>(null)
  const keyOf = (s: LabelCompareSide): LabelSetKey => ({ sha256: p.sha256, labelerId: s.labelerId, readingStage: s.readingStage, guidelineVersion: s.guidelineVersion })
  const reqKey = JSON.stringify([p.sha256, p.compare.a, p.compare.b])
  useEffect(() => {
    let alive = true
    setRecs(null)
    setError(null)
    Promise.all([unwrap(api.labels.listRecords({ sha256: p.sha256, set: keyOf(p.compare.a) })), unwrap(api.labels.listRecords({ sha256: p.sha256, set: keyOf(p.compare.b) }))])
      .then(([a, b]) => alive && setRecs({ a, b }))
      .catch((e: unknown) => alive && setError(toUiError(e)))
    return () => {
      alive = false
    }
  }, [api, reqKey])

  const shownGroups = useMemo(() => p.groups.filter((g) => g.shown).map((g) => g.group), [p.groups])
  const numA = useMemo(() => recordNumbers(recs?.a ?? []), [recs])
  const numB = useMemo(() => recordNumbers(recs?.b ?? []), [recs])
  const { cursor } = p
  const scanKey = shownGroups.map((g) => `${g.id}:${cursor.scanIndex[g.id] ?? 0}`).join(',')
  const sel = p.compare.recordUuid
  const overlays = useMemo(() => {
    if (!recs) return null
    const common = {
      reviews: [],
      selectedUuid: sel,
      editingUuid: null,
      groups: shownGroups,
      activeGroupId: cursor.activeGroupId,
      scanIndexOf: (id: number) => cursor.scanIndex[id] ?? 0,
      beamOf: (id: number) => cursor.beam[id] ?? 0,
      thicknessMm: p.thicknessMm
    }
    return mergeSides(recordOverlays({ ...common, records: recs.a, numbers: numA }), recordOverlays({ ...common, records: recs.b, numbers: numB }))
    // cursor 는 매번 새 객체라 칸 글자로 건다
  }, [recs, numA, numB, sel, shownGroups, cursor.activeGroupId, scanKey, p.thicknessMm])
  const { onOverlays } = p
  useEffect(() => onOverlays(overlays), [onOverlays, overlays])
  useEffect(() => () => onOverlays(null), [onOverlays])

  const row = (side: Side, r: IndicationRecord, n: string | undefined) => {
    const g = gotoOf(r)
    return (
      <li key={`${side}${r.uuid}`} className="label-rows__item" aria-current={r.uuid === sel}>
        <button type="button" className="label-rows__text label-rows__link num" disabled={!g} onClick={() => g && p.onGoto(g)} title="그 기록의 최대 진폭 칸으로">
          <span className={side === 'a' ? 'label-compare__a' : 'label-compare__b'}>{side.toUpperCase()}</span> #{n ?? '—'} {RECORD_KIND[r.kind]} · {recordDetail(r)} ·{' '}
          {num(r.derived.scanStartMm)}–{num(r.derived.scanEndMm)} mm
        </button>
      </li>
    )
  }

  return (
    <>
      <section className="label-panel__section" aria-label="두 세트 비교 보기">
        <div className="label-panel__headrow">
          <h3 className="label-panel__heading">검수 비교 보기 (읽기 전용)</h3>
          <span className="label-panel__aside">
            <button type="button" className="btn btn--link" onClick={p.onClose}>
              비교 보기 끄기
            </button>
          </span>
        </div>
        <dl className="label-panel__list">
          <div className="label-panel__row">
            <dt>
              <span className="label-compare__a">A</span>
            </dt>
            <dd>
              {sideText(p.compare.a)} · {recs ? `${numA.size}건` : '읽는 중'}
            </dd>
          </div>
          <div className="label-panel__row">
            <dt>
              <span className="label-compare__b">B</span>
            </dt>
            <dd>
              {sideText(p.compare.b)} · {recs ? `${numB.size}건` : '읽는 중'}
            </dd>
          </div>
        </dl>
        <p className="label-panel__note">A 기록은 자홍, B 기록은 주황으로 영상에 함께 그립니다. 결정은 검수 화면에서 합니다.</p>
        {error ? <ErrorNotice title="비교할 기록을 읽지 못했습니다" error={error} /> : null}
      </section>
      {recs ? (
        <section className="label-panel__section" aria-label="두 세트 기록">
          <ul className="label-rows">
            {[...numA.keys()].map((u) => {
              const r = recs.a.find((x) => x.uuid === u)
              return r ? row('a', r, numA.get(u)) : null
            })}
            {[...numB.keys()].map((u) => {
              const r = recs.b.find((x) => x.uuid === u)
              return r ? row('b', r, numB.get(u)) : null
            })}
          </ul>
        </section>
      ) : null}
    </>
  )
}
