/** 셋업 요약 면 4개 = 지문을 이루는 네 범주 (시편·용접 / 탐촉자·웨지 / 탐촉자 위치 / 빔 구성) */
import { Fragment, type ReactNode } from 'react'
import { OPD_FORMAT_LABEL, isEstimatedSpecimenField, isOpdSpec, type BeamGroupSpec, type GroupProbeSpec, type ScanPlanSpec, type SpecimenEstimatedField } from '@shared/types'
import {
  DASH,
  FORMATION_LABEL,
  ROLE_LABEL,
  SHAPE_LABEL,
  TECHNIQUE_LABEL,
  angleRange,
  deg,
  num,
  signedMm,
  symmetryLabel,
  waveLabel
} from '../lib/format'
import { Tag } from './Status'
import { setupWeldTemplateLabel } from './setupWeldGeometry'

/** 수치 + Pewter 단위 */
export function Q({ v, u, d = 1 }: { v: number | null | undefined; u: string; d?: number }) {
  if (v === null || v === undefined) return <>{DASH}</>
  return (
    <>
      {num(v, d)} <span className="unit">{u}</span>
    </>
  )
}

function Row({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel panel--tight setup-panel">
      <h3 className="setup-panel__title">{title}</h3>
      {children}
    </section>
  )
}

const groupLabel = (names: string[], i: number): string => names[i] ?? `그룹 ${i + 1}`

/** 화면 표시 순서: 그룹 이름 순 (스펙의 정렬은 내용 기준이라 사람이 보기에 뒤섞인다) */
function displayOrder(spec: ScanPlanSpec, names: string[]): number[] {
  return spec.groups
    .map((_, i) => i)
    .sort((a, b) => groupLabel(names, a).localeCompare(groupLabel(names, b), 'ko', { numeric: true }) || a - b)
}

const SURFACE_LABEL: Record<string, string> = { Top: '윗면', Bottom: '아랫면', Outside: '바깥면', Inside: '안쪽면' }

function angleHeight(v: { angleDeg: number | null; heightMm: number | null } | null) {
  if (!v) return <>{DASH}</>
  return (
    <>
      {deg(v.angleDeg)} · <Q v={v.heightMm} u="mm" />
    </>
  )
}

function probeLabel(gp: GroupProbeSpec, multi: boolean): string {
  return multi || gp.role !== 'pulseEcho' ? ROLE_LABEL[gp.role] : '탐촉자'
}

/** OPD: 파일에서 찾지 못한 칸은 '모름' (지문에서는 null) */
const UNKNOWN = '모름'

/** 개선 모양 표시 (OPD 틀 코드 5 = X, 6 = V) */
const BEVEL_LABEL: Record<string, string> = { V: 'V · 한면 개선', X: 'X · 양면 V 개선' }

/** 값 옆 '추정' 표시 (spec.specimen.estimatedFields — 파일 코드의 이름을 다른 값 표본 없이 정한 칸) */
function Est({ spec, field }: { spec: ScanPlanSpec; field: SpecimenEstimatedField }) {
  if (!isEstimatedSpecimenField(spec.specimen, field)) return null
  return (
    <span className="text-subtle" title="파일 코드로 정했지만 다른 값을 가진 파일이 아직 없어 이름을 화면으로 맞춰 보지 못했습니다">
      {' (추정)'}
    </span>
  )
}

function OpdSpecimenPanel({ spec }: { spec: ScanPlanSpec }) {
  const s = spec.specimen
  const w = s.weld
  const undecoded = [s.shape === 'unknown' ? '시편 형상' : null, !s.materialName ? '재질' : null, w && !w.template && !w.bevelShape ? '개선 템플릿' : null, w && !w.symmetry ? '대칭 방식' : null].filter(Boolean)
  const estimated = [
    isEstimatedSpecimenField(s, 'shape') ? '형상' : null,
    isEstimatedSpecimenField(s, 'materialName') ? '재질' : null,
    isEstimatedSpecimenField(s, 'weld.template') ? '개선 템플릿 이름' : null
  ].filter(Boolean)
  return (
    <Panel title="시편·용접">
      <dl className="kv">
        <Row k="형상">
          {s.shape === 'unknown' ? UNKNOWN : SHAPE_LABEL[s.shape]}
          <Est spec={spec} field="shape" />
        </Row>
        <Row k="두께">
          <Q v={s.thicknessMm} u="mm" />
        </Row>
        <Row k="재질">
          {s.materialName ?? UNKNOWN}
          <Est spec={spec} field="materialName" />
        </Row>
        {w ? <Row k="개선">{w.bevelShape ? (BEVEL_LABEL[w.bevelShape] ?? w.bevelShape) : UNKNOWN}</Row> : null}
        <Row k="개선 템플릿">
          {setupWeldTemplateLabel(w?.template ?? w?.bevelShape)}
          <Est spec={spec} field="weld.template" />
        </Row>
        <Row k="대칭 방식">{w?.symmetry ? symmetryLabel(w.symmetry) : UNKNOWN}</Row>
        {w ? (
          <>
            <Row k="핫패스 · 높이 / 각도"><Q v={w.hotPass?.heightMm} u="mm" /> / {deg(w.hotPass?.angleDeg)}</Row>
            <Row k="랜드 · 높이 / 오프셋"><Q v={w.land?.heightMm} u="mm" /> / <Q v={w.offsetMm} u="mm" /></Row>
            <Row k="루트 · 높이 / 각도"><Q v={w.root?.heightMm} u="mm" /> / {deg(w.root?.angleDeg)}</Row>
            {w.fills.length ? w.fills.map((f, i) => (
              <Row key={i} k={w.fills.length > 1 ? `채움 ${i + 1}층 · 높이 / 각도` : '채움 · 높이 / 각도'}><Q v={f.heightMm} u="mm" /> / {deg(f.angleDeg)}</Row>
            )) : <>
              <Row k="채움 높이">{w.derivedFillHeightMm == null ? UNKNOWN : <><Q v={w.derivedFillHeightMm} u="mm" /> <span className="text-subtle">(층 높이에서 계산)</span></>}</Row>
              <Row k="채움 각도">{UNKNOWN}</Row>
            </>}
            <Row k="열영향부 폭">{w.hazWidthMm == null ? UNKNOWN : <Q v={w.hazWidthMm} u="mm" />}</Row>
            <Row k="상부 캡 · 높이 / 폭">{w.upperCap ? <><Q v={w.upperCap.heightMm} u="mm" /> / <Q v={w.upperCap.widthMm} u="mm" /></> : UNKNOWN}</Row>
            <Row k="하부 캡 · 높이 / 폭">{w.lowerCap ? <><Q v={w.lowerCap.heightMm} u="mm" /> / <Q v={w.lowerCap.widthMm} u="mm" /></> : UNKNOWN}</Row>
          </>
        ) : null}
      </dl>
      <p className="setup-panel__note">
        {w ? '핫패스·랜드·루트 치수는 파일에서 읽었습니다. ' : '용접 치수 정보가 없습니다. '}
        {estimated.length ? `${estimated.join('·')}은 파일 코드로 정했지만 다른 값을 가진 파일이 없어 추정입니다. ` : ''}
        {undecoded.length ? `${undecoded.join('·')}은 아직 해석하지 못했습니다.` : ''}
      </p>
    </Panel>
  )
}

function SpecimenPanel({ spec }: { spec: ScanPlanSpec }) {
  if (isOpdSpec(spec)) return <OpdSpecimenPanel spec={spec} />
  const s = spec.specimen
  const w = s.weld
  return (
    <Panel title="시편·용접">
      <dl className="kv">
        <Row k="형상">{SHAPE_LABEL[s.shape]}</Row>
        <Row k="두께">
          <Q v={s.thicknessMm} u="mm" />
        </Row>
        {s.shape === 'pipe' ? (
          <Row k="외경 · 원주 범위">
            <Q v={s.outerRadiusMm === null ? null : s.outerRadiusMm * 2} u="mm" /> ·{' '}
            {s.angularOpeningDeg === 360 ? '전체 원주' : deg(s.angularOpeningDeg)}
          </Row>
        ) : null}
        <Row k="재질">{s.materialName ?? w?.materialName ?? DASH}</Row>
        {w ? (
          <>
            <Row k="개선">
              {w.bevelShape ?? DASH} · {symmetryLabel(w.symmetry)} · 용접각 {deg(w.weldAngleDeg)}
            </Row>
            <Row k="상부 캡">
              {w.upperCap ? (
                <>
                  {num(w.upperCap.widthMm)} × <Q v={w.upperCap.heightMm} u="mm" />
                </>
              ) : (
                DASH
              )}
            </Row>
            <Row k="하부 캡">
              {w.lowerCap ? (
                <>
                  {num(w.lowerCap.widthMm)} × <Q v={w.lowerCap.heightMm} u="mm" />
                </>
              ) : (
                DASH
              )}
            </Row>
            <Row k="핫패스">{angleHeight(w.hotPass)}</Row>
            <Row k="랜드">
              <Q v={w.land?.heightMm} u="mm" />
            </Row>
            <Row k="루트">{angleHeight(w.root)}</Row>
            {w.fills.map((f, i) => (
              <Row key={i} k={w.fills.length > 1 ? `채움 ${i + 1}층` : '채움'}>
                {angleHeight(f)}
              </Row>
            ))}
          </>
        ) : (
          <Row k="개선">용접 형상 정보 없음</Row>
        )}
      </dl>
    </Panel>
  )
}

function ProbePanel({ spec, names }: { spec: ScanPlanSpec; names: string[] }) {
  const opd = isOpdSpec(spec)
  return (
    <Panel title="탐촉자·웨지">
      {displayOrder(spec, names).map((gi) => {
        const g = spec.groups[gi]!
        return (
        <div className="setup-panel__group" key={gi}>
          <p className="setup-panel__caption">{groupLabel(names, gi)}</p>
          <dl className="kv">
            {g.probes.map((gp, pi) => (
              <Fragment key={pi}>
                <Row k={probeLabel(gp, g.probes.length > 1)}>
                  {gp.probe.model ?? DASH} · <Q v={gp.probe.centralFrequencyMHz} u="MHz" d={2} />
                  {gp.probe.elementCount && gp.probe.elementCount > 1 ? (
                    <>
                      {' '}
                      · {gp.probe.elementCount}소자 · 피치 <Q v={gp.probe.pitchMm} u="mm" d={2} />
                    </>
                  ) : opd ? (
                    <>
                      {' '}
                      · 소자 수 {UNKNOWN} · 피치 <Q v={gp.probe.pitchMm} u="mm" d={2} />
                    </>
                  ) : null}
                  {gp.orientation === 'Reverse' ? ' · 역방향 장착' : ''}
                  {/* OPD: 탐촉자 종류·장착 방향은 파일 칸이 없어 상수로 둔 값 (core/opd/normalize OPD_ASSUMED_FIELDS) */}
                  {opd ? <span className="text-faint" title="파일에 칸이 없어 모든 OPD 플랜에 같은 값으로 둔 추정입니다(지문을 가르지 않음)"> · 선형 위상배열·정방향 장착(추정)</span> : null}
                </Row>
                <Row k={gp.wedge?.kind === 'fluidColumn' ? '액주' : '웨지'}>
                  {gp.wedge ? (
                    <>
                      {gp.wedge.model ?? DASH} · {deg(gp.wedge.wedgeAngleDeg)}
                    </>
                  ) : (
                    '없음'
                  )}
                </Row>
              </Fragment>
            ))}
          </dl>
        </div>
        )
      })}
    </Panel>
  )
}

function PositionPanel({ spec, names }: { spec: ScanPlanSpec; names: string[] }) {
  return (
    <Panel title="탐촉자 위치">
      <dl className="kv">
        {displayOrder(spec, names).flatMap((gi) =>
          spec.groups[gi]!.probes.map((gp, pi, all) => (
            <Row key={`${gi}-${pi}`} k={`${groupLabel(names, gi)}${all.length > 1 ? ` ${ROLE_LABEL[gp.role]}` : ''}`}>
              {gp.position ? (
                <>
                  인덱스 {signedMm(gp.position.vOffsetMm)} · 스캔 {signedMm(gp.position.uOffsetMm)} · 스큐 {deg(gp.position.skewDeg)}
                  {gp.position.surface ? ` · ${SURFACE_LABEL[gp.position.surface] ?? gp.position.surface}` : ''}
                </>
              ) : (
                '위치 정보 없음'
              )}
            </Row>
          ))
        )}
      </dl>
      <p className="setup-panel__note">인덱스는 용접 중심 기준 웨지 위치입니다.</p>
    </Panel>
  )
}

function beamTags(g: BeamGroupSpec): string[] {
  return [TECHNIQUE_LABEL[g.technique], FORMATION_LABEL[g.formation]].filter(Boolean)
}

function BeamPanel({ spec, names }: { spec: ScanPlanSpec; names: string[] }) {
  const opd = isOpdSpec(spec)
  return (
    <Panel title="빔 구성">
      {displayOrder(spec, names).map((gi) => {
        const g = spec.groups[gi]!
        return (
        <div className="setup-panel__group" key={gi}>
          <p className="setup-panel__caption row">
            {groupLabel(names, gi)}
            {beamTags(g).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </p>
          <dl className="kv">
            {g.firstElement !== null || g.aperture !== null ? (
              <Row k="소자">
                첫 소자 {g.firstElement ?? DASH} · 어퍼처 {g.aperture ?? DASH}
                {g.elementStep ? ` · 스텝 ${g.elementStep}` : ''}
              </Row>
            ) : null}
            <Row k="굴절각">{angleRange(g.refractedAngle)}</Row>
            <Row k="집속">
              {g.focusing.mode ?? (opd ? `방식 ${UNKNOWN}` : DASH)}
              {g.focusing.distanceMm !== null ? (
                <>
                  {' '}
                  · <Q v={g.focusing.distanceMm} u="mm" />
                </>
              ) : null}
            </Row>
            <Row k="파 모드">{g.waveMode === null && opd ? UNKNOWN : waveLabel(g.waveMode)}</Row>
            {opd ? (
              <Row k="데이터 형식">
                {OPD_FORMAT_LABEL}
                {typeof g.techniqueParams['opdSpecRule'] === 'number' ? ` · 스펙 규칙 ${g.techniqueParams['opdSpecRule']}` : ''}
              </Row>
            ) : null}
            {Object.entries(g.techniqueParams)
              .filter(() => !opd)
              .map(([k, v]) => (
                <Row key={k} k={k}>
                  {v === null ? DASH : String(v)}
                </Row>
              ))}
          </dl>
        </div>
        )
      })}
    </Panel>
  )
}

export function SetupPanels({ spec, groupNames }: { spec: ScanPlanSpec; groupNames: string[] }) {
  return (
    <div className="setup-grid">
      <SpecimenPanel spec={spec} />
      <ProbePanel spec={spec} names={groupNames} />
      <PositionPanel spec={spec} names={groupNames} />
      <BeamPanel spec={spec} names={groupNames} />
    </div>
  )
}
