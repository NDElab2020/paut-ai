/**
 * 이미지 보기 모듈: 얇은 껍데기. 본체(NdeViewer)는 앱 틀과 떼어 viewer/ 에 있다.
 * route.params = { fileId, planId } — 라벨 관리 '검수'의 '영상으로 보기'는 그 기록 위치(scanMm·groupId·beam·recordUuid)와
 * 비교한 두 세트(compareA·compareB = '라벨러|판독 단계|지침서')·from = labels 를 더 넘긴다 → 그 자리로 가서 두 세트 비교 보기를 연다.
 * 뷰어의 '◀ 이전 · 다음 ▶'(X9)은 같은 모듈로 fileId 만 바꿔 연다 — planId·from 은 그대로, 기록 위치·비교 세트는 빼고,
 * 라벨 모드에서 넘어가면 label = 1 (그 파일도 라벨 모드로 연다 — 그 파일의 라벨 세션(초안·도구)은 이어서).
 */
import { memo, useCallback, useMemo } from 'react'
import type { ModuleProps } from '@shared/modules'
import type { ReadingStage } from '@shared/labels/types'
import { EmptyState } from '../../components/EmptyState'
import type { LabelCompare, LabelCompareSide } from '../../labeling/types'
import { NdeViewer, type ViewerTarget } from '../../viewer/NdeViewer'

const STAGES: readonly ReadingStage[] = ['blind', 'reconciled', 'final']

function sideOf(id: string | undefined): LabelCompareSide | null {
  if (!id) return null
  const [labelerId = '', stage = '', guidelineVersion = ''] = id.split('|')
  return labelerId && guidelineVersion && (STAGES as readonly string[]).includes(stage) ? { labelerId, readingStage: stage as ReadingStage, guidelineVersion } : null
}

function ViewerModule({ route, navigate }: ModuleProps) {
  const p = route.params
  const fileId = Number(p.fileId)
  const planId = p.planId
  // 라벨 관리 '검수'의 '영상으로 보기'(from = labels)에서 왔으면 그리로 돌아간다
  const from = p.from
  const back = useCallback(() => (from === 'labels' ? navigate('labels') : navigate('plans', planId ? { planId, fileId: String(fileId) } : {})), [navigate, planId, fileId, from])
  const openFile = useCallback(
    (id: number, opts: { label: boolean }) =>
      navigate('viewer', { fileId: String(id), ...(planId ? { planId } : {}), ...(from ? { from } : {}), ...(opts.label ? { label: '1' } : {}) }),
    [navigate, planId, from]
  )
  const scanMm = p.scanMm !== undefined ? Number(p.scanMm) : NaN
  const groupId = p.groupId !== undefined ? Number(p.groupId) : NaN
  const beam = p.beam !== undefined ? Number(p.beam) : NaN
  const target = useMemo<ViewerTarget | null>(
    () =>
      Number.isFinite(scanMm)
        ? {
            scanMm,
            ...(Number.isSafeInteger(groupId) ? { groupId } : {}),
            ...(Number.isSafeInteger(beam) && beam >= 0 ? { beam } : {}),
            ...(p.recordUuid ? { recordUuid: p.recordUuid } : {})
          }
        : null,
    [scanMm, groupId, beam, p.recordUuid]
  )
  const compare = useMemo<LabelCompare | null>(() => {
    const a = sideOf(p.compareA)
    const b = sideOf(p.compareB)
    return a && b ? { a, b, recordUuid: p.recordUuid ?? null } : null
  }, [p.compareA, p.compareB, p.recordUuid])
  if (!Number.isSafeInteger(fileId) || fileId <= 0) {
    return (
      <EmptyState
        title="볼 파일이 정해지지 않았습니다"
        desc="스캔플랜별 데이터에서 파일을 펼치고 '이미지로 보기'를 누르세요."
        action={
          <button type="button" className="btn btn--secondary btn--lg" onClick={() => navigate('plans')}>
            스캔플랜별 데이터로
          </button>
        }
      />
    )
  }
  return (
    <NdeViewer
      key={fileId}
      fileId={fileId}
      onBack={back}
      backLabel={from === 'labels' ? '라벨 관리로' : undefined}
      target={target}
      compare={compare}
      onOpenFile={openFile}
      startInLabelMode={p.label === '1'}
    />
  )
}

// 앱 전역 상태(가져오기 진행률·테마·검색어)가 바뀔 때마다 영상까지 다시 그리지 않도록 route 가 같으면 건너뛴다
export default memo(ViewerModule)
