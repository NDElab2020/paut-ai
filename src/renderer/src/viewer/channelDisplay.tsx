import { beamLabel, beamNumber, cscanBeamAxis, type ViewerGroup } from '@shared/imaging'
import { num } from '../lib/format'
import { Status } from '../components/Status'

export function indexPositionMm(group: ViewerGroup, channel: number): number | null {
  const axis = group.spatialAxis
  return axis ? axis.offsetMm + channel * axis.resolutionMm : null
}

/** 각도가 같은 공간 수집 채널은 실제 Index 위치로 구분한다. 기존 빔/각도 표시 규칙은 유지한다. */
export function viewerChannelText(group: ViewerGroup, channel: number): string {
  const index = indexPositionMm(group, channel)
  if (index !== null) return `Index ${num(index, 2)} mm`
  return cscanBeamAxis(group).kind === 'beam' ? beamLabel(group, channel) : `${num(group.beams[channel]?.angleDeg)}°`
}

export function firstChannelName(group: ViewerGroup): string {
  if (group.spatialAxis) return viewerChannelText(group, 0)
  if (cscanBeamAxis(group).kind === 'beam') return `빔 ${beamNumber(0)}`
  return (group.beams[0]?.angleDeg ?? 0) <= (group.beams[group.beams.length - 1]?.angleDeg ?? 0) ? '작은 각도' : '큰 각도'
}

export function ViewerChannelReadout({ group, channel }: { group: ViewerGroup; channel: number }) {
  const index = indexPositionMm(group, channel)
  if (index !== null) {
    return <div><dt title="파일에 저장된 인덱스 위치(mm)">Index</dt><dd className="num">{num(index, 2)} <span className="unit">mm</span></dd></div>
  }
  const angle = group.beams[channel]?.angleDeg
  return cscanBeamAxis(group).kind === 'beam' ? (
    <div><dt title="빔 번호 (1부터, C-scan 세로축과 같은 번호)와 굴절각">빔</dt><dd className="num">{beamNumber(channel)} <span className="unit">· {num(angle)}°</span></dd></div>
  ) : (
    <div><dt>각도</dt><dd className="num">{num(angle)}<span className="unit">°</span></dd></div>
  )
}

export function paintbrushPointStatus(group: ViewerGroup, status: Uint8Array | null | undefined, scan: number, channel: number): '취득됨' | '미취득' | '확인 불가' {
  const cell = scan * group.shape[1] + channel
  if (!status || scan < 0 || scan >= group.shape[0] || channel < 0 || channel >= group.shape[1] || cell >= status.length) return '확인 불가'
  return status[cell]! & 1 ? '취득됨' : '미취득'
}

/** 미취득 셀은 낮은 진폭으로 해석하지 않도록 현재 커서의 수집 상태를 명시한다. */
export function PaintbrushPointReadout({ group, status, scan, channel }: { group: ViewerGroup; status: Uint8Array | null | undefined; scan: number; channel: number }) {
  if (group.storageMode !== 'Paintbrush') return null
  return <div><dt title="현재 스캔·Index 위치에서 파일에 저장된 수집 상태">수집 상태</dt><dd>{paintbrushPointStatus(group, status, scan, channel)}</dd></div>
}

export function PaintbrushNote({ groups }: { groups: ViewerGroup[] }) {
  const paintbrush = groups.filter((g) => g.storageMode === 'Paintbrush')
  if (!paintbrush.length) return null
  return <p><Status tone={paintbrush.some((g) => !g.verified) ? 'attention' : 'muted'}>Paintbrush{paintbrush.some((g) => !g.verified) ? ' · 위치 대응 대조 전' : ''}</Status><span>저장된 스캔·Index 격자 위치를 표시합니다. 엔코더 실측 여부와 획득 순서는 별도 확인이 필요합니다. 미취득 칸은 데이터 없음 색으로 표시합니다.</span></p>
}
