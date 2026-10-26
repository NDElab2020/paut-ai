import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cscanBeamAxis, type ViewerGroup } from '@shared/imaging'
import { mockViewerInfo } from '../src/renderer/src/api/mockVolume'
import { PaintbrushNote, PaintbrushPointReadout, ViewerChannelReadout, firstChannelName, indexPositionMm, paintbrushPointStatus, viewerChannelText } from '../src/renderer/src/viewer/channelDisplay'
import { CscanView } from '../src/renderer/src/viewer/CscanView'
import { overlayColors } from '../src/renderer/src/viewer/canvas'

// SSR에는 ResizeObserver가 없으므로 실제 패널 크기만 제공하고 축 렌더링은 그대로 검증한다.
vi.mock('../src/renderer/src/viewer/canvas', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/renderer/src/viewer/canvas')>(),
  useElementSize: () => ({ width: 640, height: 400 })
}))

function paintbrush(): ViewerGroup {
  const base = mockViewerInfo().groups[0]!
  const beams = Array.from({ length: 57 }, (_, index) => ({ ...base.beams[0]!, index, angleDeg: 0, vOffsetMm: 1.75 + index * 0.5 }))
  return { ...base, name: 'Paintbrush', technique: 'pa-linear', verified: false, storageMode: 'Paintbrush', spatialAxis: { kind: 'index', offsetMm: 1.75, resolutionMm: 0.5, count: 57 }, beams, shape: [3, 57, base.shape[2]] }
}

describe('Paintbrush 인덱스 영상 표시', () => {
  it('0° 채널 57개를 실제 Index 위치로 구분하고 C-scan 축을 mm로 표시한다', () => {
    const group = paintbrush()
    expect(indexPositionMm(group, 0)).toBe(1.75)
    expect(indexPositionMm(group, 28)).toBe(15.75)
    expect(indexPositionMm(group, 56)).toBe(29.75)
    expect(viewerChannelText(group, 0)).toBe('Index 1.75 mm')
    expect(viewerChannelText(group, 56)).toBe('Index 29.75 mm')
    expect(firstChannelName(group)).toBe('Index 1.75 mm')
    const readout = renderToStaticMarkup(createElement(ViewerChannelReadout, { group, channel: 56 }))
    expect(readout).toContain('>Index</dt>')
    expect(readout).toContain('29.75')
    expect(readout).not.toContain('°')
    expect(cscanBeamAxis(group)).toMatchObject({ kind: 'index', first: 1.5, last: 30, unit: 'mm' })
    const cscan = renderToStaticMarkup(createElement(CscanView, {
      group, volume: null, scanIndex: 1, beam: 56, reversed: false, palette: new Uint8Array(256 * 3), noData: [128, 128, 128],
      active: true, showScanAxis: true, colors: overlayColors('light'), onPick: () => undefined
    }))
    expect(cscan).toContain('인덱스 위치')
    expect(cscan).not.toContain('굴절각')
    expect(cscan).not.toContain('빔 번호')
  })

  it('미취득 상태 비트를 현재 스캔·Index 셀로 읽고 낮은 진폭과 구분한다', () => {
    const group = paintbrush()
    const status = new Uint8Array(3 * 57).fill(1)
    status[1 * 57 + 28] = 0
    // bit 1만 있는 셀도 취득 비트(bit 0)가 없으면 미취득이다.
    status[2 * 57 + 28] = 2
    expect(paintbrushPointStatus(group, status, 0, 28)).toBe('취득됨')
    expect(paintbrushPointStatus(group, status, 1, 28)).toBe('미취득')
    expect(paintbrushPointStatus(group, status, 2, 28)).toBe('미취득')
    expect(paintbrushPointStatus(group, null, 1, 28)).toBe('확인 불가')
    const readout = renderToStaticMarkup(createElement(PaintbrushPointReadout, { group, status, scan: 1, channel: 28 }))
    expect(readout).toContain('수집 상태')
    expect(readout).toContain('미취득')
    const note = renderToStaticMarkup(createElement(PaintbrushNote, { groups: [group] }))
    expect(note).toContain('Paintbrush · 위치 대응 대조 전')
    expect(note).toContain('미취득 칸은 데이터 없음 색')
  })

  it('기존 리니어 빔 번호·섹터 각도 표시를 유지하고 Paintbrush 안내를 붙이지 않는다', () => {
    const sectorial = mockViewerInfo().groups[0]!
    const linear: ViewerGroup = { ...sectorial, technique: 'pa-linear', beams: sectorial.beams.map((b) => ({ ...b, angleDeg: 60 })) }
    expect(viewerChannelText(sectorial, 14)).toBe('54.0°')
    expect(firstChannelName(sectorial)).toBe('작은 각도')
    expect(viewerChannelText(linear, 11)).toBe('빔 12 · 60°')
    expect(firstChannelName(linear)).toBe('빔 1')
    const legacy = renderToStaticMarkup(createElement(ViewerChannelReadout, { group: linear, channel: 11 }))
    expect(legacy).toContain('>빔</dt>')
    expect(legacy).toContain('60.0°')
    expect(renderToStaticMarkup(createElement(PaintbrushNote, { groups: [sectorial, linear] }))).toBe('')
    expect(renderToStaticMarkup(createElement(PaintbrushPointReadout, { group: linear, status: null, scan: 1, channel: 11 }))).toBe('')
  })
})
