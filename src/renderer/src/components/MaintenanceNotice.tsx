import { useState } from 'react'
import type { StoreMaintenanceReport } from '@shared/types'
import { useApp } from '../state/AppContext'

function lines(r: StoreMaintenanceReport): string[] {
  const out: string[] = []
  if (r.interruptedBatchCount) out.push(`끝나지 않은 가져오기 ${r.interruptedBatchCount}건을 '중단됨'으로 정리했습니다. 기록까지 끝난 파일만 저장소에 남았습니다.`)
  if (r.quarantined.length) {
    out.push(
      `카탈로그에 기록되지 않은 사본 ${r.quarantined.length}개를 ${r.quarantineDir ?? '미등록_파일'} 폴더로 옮겼습니다. 같은 원본을 다시 가져오면 정상 등록됩니다.`
    )
  }
  if (r.upgradedPlanIds.length) out.push(`판정 규칙이 바뀌어 스캔플랜 ${r.upgradedPlanIds.length}개(${r.upgradedPlanIds.join(', ')})의 지문을 다시 계산했습니다.`)
  out.push(...r.upgradeProblems, ...r.problems.slice(0, 3))
  return out
}

/** 저장소를 열 때 한 점검·복구 결과 알림 (알릴 내용이 있을 때만, 닫으면 이번 실행 동안 숨김) */
export function MaintenanceNotice() {
  const { maintenance } = useApp()
  const [closedAt, setClosedAt] = useState<string | null>(null)
  if (!maintenance || closedAt === maintenance.checkedAt) return null
  const items = lines(maintenance)
  if (items.length === 0) return null
  const hasProblem = maintenance.upgradeProblems.length + maintenance.problems.length > 0
  return (
    <div className={hasProblem ? 'notice notice--error maintenance' : 'notice notice--accent maintenance'} role="status">
      <div className="notice__body">
        <p className="notice__title">저장소를 열면서 점검했습니다</p>
        <ul className="maintenance__list">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setClosedAt(maintenance.checkedAt)}>
        닫기
      </button>
    </div>
  )
}
