import { useState } from 'react'
import type { RefBasis, ViewerAppStamp, ViewerFileInfo } from '@shared/imaging'
import { isOpdMeta, type AcquisitionSummary, type FileRecord, type GateSummary } from '@shared/types'
import { formatBytes } from '@shared/ids'
import { getApi, toUiError, unwrap } from '../../api'
import { Icon } from '../../components/Icon'
import { Tag } from '../../components/Status'
import { DASH, dateTime, joinPath, num } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { useApp } from '../../state/AppContext'
import { FormatTag } from '../import/FormatTag'

/**
 * 선택한 파일의 상세: 경로·해시·NDE 버전(OPD 는 형식·읽기 규칙)·장비·수집 설정(기록용) + 이미지로 보기 · 탐색기에서 보기.
 * NDE 는 '파일 설정 보기' 를 누르면 이미지 보기 정보(viewer:open, 메타 수 KB)에서 파일 출처(L6 — 만든·저장한 앱, 장비, OmniPC 재저장,
 * 만든 MXU 판이 6.3.0 전인 X4 주의)·Ref 근거(X2)·파일 설정 주의(X7 분석 오프셋·L4 분석 이득·Ref 상한)를 더 보인다 (OmniPC_조사/조사_보고.md 6.5절).
 * 펼칠 때마다 읽지 않는다: main 의 이미지 보기 메타 캐시(4개)를 뷰어·라벨과 같이 쓰므로 목록을 훑을 때 뷰어 캐시가 밀려나지 않게.
 */
export function FileDetail({ file, onOpenImage }: { file: FileRecord; onOpenImage: (fileId: number) => void }) {
  const { settings, info } = useApp()
  const [revealError, setRevealError] = useState<string | null>(null)
  const m = file.meta
  const opd = isOpdMeta(m)
  const revealLabel = info?.platform === 'darwin' ? 'Finder에서 보기' : '탐색기에서 보기'

  const reveal = (): void => {
    setRevealError(null)
    unwrap(getApi().files.reveal(file.id)).catch((e: unknown) => setRevealError(toUiError(e).message))
  }

  return (
    <div className="file-detail">
      <div className="file-detail__head">
        <h4 className="file-detail__title">{file.storedFileName}</h4>
        <button type="button" className="btn btn--secondary" onClick={() => onOpenImage(file.id)}>
          <Icon name="image" />
          이미지로 보기
        </button>
        <button type="button" className="btn btn--secondary" onClick={reveal}>
          <Icon name="reveal" />
          {revealLabel}
        </button>
      </div>
      {revealError ? <p className="field__error">{revealError}</p> : null}
      <dl className="kv file-detail__kv">
        <dt>저장 위치</dt>
        <dd className="mono break">{joinPath(settings?.storeRoot, file.storedRelPath)}</dd>
        <dt>원본 위치</dt>
        <dd className="mono break">{m.sourcePath}</dd>
        <dt>SHA-256</dt>
        <dd className="mono break">{m.sha256}</dd>
        <dt>{opd ? '파일 형식' : 'NDE 버전'}</dt>
        <dd>
          {opd ? (
            <>
              <FormatTag meta={m} />{' '}
              <span className="text-subtle">
                {m.ndeVersion.raw.replace(/^OPD · /, '')}
                {m.reader ? ` · 읽기 규칙 ${m.reader.name} v${m.reader.version}` : ''}
              </span>
            </>
          ) : (
            <>
              <Tag>{m.ndeVersion.raw}</Tag> <span className="text-subtle">{m.ndeVersion.family}</span>
            </>
          )}
        </dd>
        <dt>장비</dt>
        <dd>{[m.device.platform, m.device.model, m.device.serialNumber ? `S/N ${m.device.serialNumber}` : null].filter(Boolean).join(' · ') || DASH}</dd>
        <dt>장비 원본 이름</dt>
        <dd className="mono">{m.deviceFileName ?? DASH}</dd>
        <dt>{opd ? '장비 저장 시각' : '측정(생성) 시각'}</dt>
        <dd className="num">{dateTime(m.createdAt)}</dd>
        <dt>저장 앱</dt>
        <dd>{[m.application.name, m.application.version].filter(Boolean).join(' ') || DASH}</dd>
        <FileSettingsRows fileId={file.id} />
        <dt>크기 · 가져온 시각</dt>
        <dd className="num">
          {formatBytes(m.sizeBytes)} · {dateTime(file.importedAt)}
        </dd>
        <FileAcquisitionRows acquisition={file.acquisition} opd={opd} />
        {file.memo ? (
          <>
            <dt>메모</dt>
            <dd>{file.memo}</dd>
          </>
        ) : null}
      </dl>
      <p className="setup-panel__note">게인·음속·게이트는 기록용이며 스캔플랜 구분에는 쓰지 않습니다.</p>
      {opd ? (
        <p className="setup-panel__note">
          OPD 는 공개되지 않은 형식이라 파일 구조를 따라 읽었습니다(OmniPC 대조 전). 저장 시각은 장비 시계 그대로(시간대 없음)이고, 게이트는 깊이 기준
          시간입니다. 게이트 시작·폭은 첫 빔의 대표값입니다.
        </p>
      ) : null}
    </div>
  )
}

const onOff = (v: boolean | null): string => v === null ? '모름' : v ? '사용' : '사용 안 함'
const gateGeometry = (v: string | null): string => v === 'TrueDepth' ? '깊이 기준' : v === 'SoundPath' ? '음로 기준' : v ?? '기준 모름'
const opdSyncLabel = (mode: string | null | undefined): string => mode === 'Time' ? '시간 동기' : mode === 'Encoder' ? '엔코더 동기' : mode ?? '동기 방식 모름'

function GateText({ gate, opd }: { gate: GateSummary; opd: boolean }) {
  return (
    <div className="num">
      {gate.name} · {gateGeometry(gate.geometry)} · 시작 {num(gate.startUs, 3)} <span className="unit">µs</span> · 폭 {num(gate.lengthUs, 3)} <span className="unit">µs</span>
      {' · '}문턱 {gate.thresholdPercent === null ? (opd ? '모름' : DASH) : <>{num(gate.thresholdPercent)} <span className="unit">%</span></>}
    </div>
  )
}

/** 플랜 지문에서 제외된 파일별 수집값도 원본에서 읽은 범위까지 보인다. */
export function FileAcquisitionRows({ acquisition, opd }: { acquisition: AcquisitionSummary; opd: boolean }) {
  const groups = acquisition.groups.slice().sort((a, b) => a.specGroupIndex - b.specGroupIndex)
  return (
    <>
      {groups.map((g) => (
        <FileAcquisitionGroup key={g.specGroupIndex} group={g} opd={opd} />
      ))}
      <dt>스캔 동기 · 패턴</dt>
      <dd>
        {opd ? opdSyncLabel(acquisition.encoder?.mode) : acquisition.encoder?.mode ?? DASH}
        {acquisition.encoder?.stepResolutionPerMm != null ? <> · {num(acquisition.encoder.stepResolutionPerMm, 3)} <span className="unit">step/mm</span></> : null}
        {' · '}{acquisition.scanPattern ?? (opd ? '패턴 모름' : DASH)}
        {opd && acquisition.encoder?.mode === 'Time' ? <p className="setup-panel__note">스캔 위치는 시간 동기와 설정 간격으로 정한 명목값이며, 엔코더로 측정한 위치가 아닙니다.</p> : null}
      </dd>
    </>
  )
}

function FileAcquisitionGroup({ group: g, opd }: { group: AcquisitionSummary['groups'][number]; opd: boolean }) {
  return (
    <>
      <dt>수집 설정 · {g.groupName}</dt>
      <dd className="num">
        게인 {num(g.gainDb)} <span className="unit">dB</span> · 기준 이득 {g.referenceGainDb === null && opd ? '모름' : <>{num(g.referenceGainDb)} <span className="unit">dB</span></>}
        {' · '}음속 {num(g.velocityMps)} <span className="unit">m/s</span> · {g.beamCount ?? DASH}빔 · TCG {onOff(g.tcgEnabled)}
      </dd>
      <dt>스캔 범위 · {g.groupName}</dt>
      <dd className="num">
        {g.scanQuantity ?? DASH}칸 · 간격 {num(g.scanResolutionMm, 3)} <span className="unit">mm</span>
        {g.scanQuantity !== null && g.scanResolutionMm !== null ? <> · 첫 칸부터 마지막 칸까지 {num(Math.max(0, g.scanQuantity - 1) * g.scanResolutionMm)} <span className="unit">mm</span></> : null}
        {opd ? g.scanStartMm != null && g.scanLastPointMm != null
          ? <> · 시작 {num(g.scanStartMm)} <span className="unit">mm</span> · 마지막 측정 위치 {num(g.scanLastPointMm)} <span className="unit">mm</span></>
          : ' · 시작·마지막 측정 위치 모름' : null}
        {g.indexQuantity !== null ? <> · 인덱스 {g.indexQuantity}줄 · 줄 간격 {num(g.indexResolutionMm, 3)} <span className="unit">mm</span></> : null}
      </dd>
      <dt>샘플링 · 교정 · {g.groupName}</dt>
      <dd>
        디지타이저 {g.digitizingFrequencyMHz === null && opd ? '모름' : <>{num(g.digitizingFrequencyMHz, 2)} <span className="unit">MHz</span></>}
        {' · '}교정 {g.calibrations.length ? g.calibrations.join(', ') : (opd ? '모름' : DASH)}
      </dd>
      <dt>게이트 · {g.groupName}</dt>
      <dd>{g.gates.length ? g.gates.map((gate, i) => <GateText key={`${gate.name}-${i}`} gate={gate} opd={opd} />) : DASH}</dd>
    </>
  )
}

function stampText(a: ViewerAppStamp | null): string | null {
  return a && (a.name || a.version) ? [a.name, a.version].filter(Boolean).join(' ') : null
}

const REF_BASIS_TEXT: Record<RefBasis, string> = { tcg: 'TCG 보정', 'single-depth': '한 깊이만(TCG 없음 — 근거 약함)', none: '없음(기준 이득 0)' }

/** 파일 출처·Ref 근거·파일 설정 주의 — 누를 때만 이미지 보기 정보에서 읽는다. */
function FileSettingsRows({ fileId }: { fileId: number }) {
  const [shownFor, setShownFor] = useState<number | null>(null)
  if (shownFor !== fileId) {
    return (
      <>
        <dt>파일 설정</dt>
        <dd>
          <button
            type="button"
            className="btn btn--ghost"
            title="파일 출처(만든·저장한 앱, OmniPC 재저장, 웨지 오프셋 주의)·Ref 근거·파일 설정 주의(분석 오프셋·분석 이득)를 파일 셋업에서 읽어 보입니다"
            onClick={() => setShownFor(fileId)}
          >
            파일 설정 보기
          </button>
        </dd>
      </>
    )
  }
  return <FileSettingsLoaded fileId={fileId} />
}

function FileSettingsLoaded({ fileId }: { fileId: number }) {
  const opened = useAsync(() => unwrap(getApi().viewer.open(fileId)), [fileId])
  if (opened.error) {
    return (
      <>
        <dt>파일 설정</dt>
        <dd className="text-subtle">읽지 못했습니다: {opened.error.message}</dd>
      </>
    )
  }
  const info: ViewerFileInfo | null = opened.data?.info ?? null
  if (!info) {
    return (
      <>
        <dt>파일 설정</dt>
        <dd className="text-subtle">읽는 중입니다.</dd>
      </>
    )
  }
  const src = info.source ?? null
  const made = src ? stampText(src.createdBy) : null
  const saved = src ? stampText(src.savedBy) ?? stampText(src.modifiedBy) : null
  const refGroups = info.groups.filter((g) => g.supported && g.refBasis !== undefined)
  return (
    <>
      <dt>파일 설정</dt>
      <dd>{info.reader ? `파일 구조 해석 규칙 ${info.reader.version}` : '파일에 저장된 셋업'} · {info.groups.length}개 그룹</dd>
      {src ? (
        <>
          <dt>파일 출처</dt>
          <dd>
            {[made ? `만든 앱 ${made}` : null, saved && saved !== made ? `마지막 저장 ${saved}` : null, src.platform ? `장비 ${src.platform}` : null].filter(Boolean).join(' · ') || DASH}{' '}
            {src.resavedByOmniPC ? <Tag title="OmniPC 로 다시 저장한 파일입니다 — 장비 원본이 아닙니다">OmniPC 재저장</Tag> : null}
            {src.wedgeOffsetCaution ? (
              <Tag title="만든 MXU 판이 6.3.0 전인 X4 파일 — MXU 6.3.0 은 UT 웨지 장착 위치·PA 사용자 웨지 secondaryOffset 부호 저장 오류를 고쳤습니다(공개 NDE 형식 변경 기록). 이 파일에 해당하는지는 대조 전">
                웨지 오프셋 주의
              </Tag>
            ) : null}
            {src.notes.length ? <span className="text-subtle"> {src.notes.join(' ')}</span> : null}
          </dd>
        </>
      ) : null}
      {refGroups.length ? (
        <>
          <dt>Ref 근거</dt>
          <dd>
            {refGroups.map((g) => `${g.name} ${REF_BASIS_TEXT[g.refBasis!]}${g.refPct != null ? ` (Ref ≈ ${num(g.refPct)} %FSH)` : ''}`).join(' · ')}{' '}
            <span className="text-subtle">— 파일 셋업 추정, OmniPC 대조 전</span>
          </dd>
        </>
      ) : null}
      {info.warnings.length ? (
        <>
          <dt>파일 설정 주의</dt>
          <dd className="text-subtle">{info.warnings.join(' ')}</dd>
        </>
      ) : null}
    </>
  )
}
