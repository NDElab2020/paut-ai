/** E2E 결과 요약 Markdown 만들기 */
import { describeDifference } from '@core/nde'
import { formatBytes } from '@shared/ids'
import type { ImportPreview, ImportResult, ScanPlan } from '@shared/types'

export interface E2eStep {
  title: string
  preview: ImportPreview
  result?: ImportResult
  analyzeMs?: number
  commitMs?: number
  plans?: ScanPlan[]
  /** 판정 근거 등 사람이 읽는 설명 */
  notes?: string[]
}

export interface E2eReport {
  startedAt: Date
  storeRoot: string
  steps: E2eStep[]
  /** 그 밖에 확인한 것 */
  extra?: string[]
}

const VERDICT_KO: Record<string, string> = {
  'match-existing': '기존 플랜',
  'new-plan': '새 플랜',
  duplicate: '중복',
  'missing-copy': '사본 복원',
  unsupported: '보류(미지원)',
  error: '오류'
}

function counts(p: ImportPreview): string {
  return Object.entries(p.counts)
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${VERDICT_KO[v] ?? v} ${n}`)
    .join(', ')
}

function stepSection(s: E2eStep): string[] {
  const p = s.preview
  const ndeBytes = p.items.filter((i) => i.sha256).reduce((a, i) => a + i.sizeBytes, 0)
  const out = [
    `### ${s.title}`,
    '',
    `- 판정: ${counts(p)} (숨김 건너뜀 ${p.skippedHiddenCount}, 무관한 확장자 무시 ${p.ignoredCount}, 저장소 폴더 건너뜀 ${p.skippedStoreCount})`,
    `- 분석 시간: ${s.analyzeMs ?? p.elapsedMs} ms (해시 대상 ${formatBytes(ndeBytes)})`
  ]
  for (const n of s.notes ?? []) out.push(`- ${n}`)
  if (s.result) {
    const r = s.result
    out.push(
      `- 확정(${r.status}): 복사 ${r.copiedCount}, 건너뜀 ${r.skippedCount}, 실패 ${r.failedCount}, 새 플랜 ${r.createdPlanIds.join(', ') || '없음'}, 새 시편 ${r.createdSpecimenIds.length}`
    )
    if (s.commitMs !== undefined) out.push(`- 확정 시간(복사·검증·기록): ${s.commitMs} ms`)
  }
  out.push('', '| 파일 | NDE | 판정 | 플랜 | 시편 제안 | 상태 태그 | 결과 |', '|---|---|---|---|---|---|---|')
  for (const i of p.items) {
    const plan = i.matchedPlanId ?? (i.newPlanKey ? p.newPlans.find((n) => n.key === i.newPlanKey)?.provisionalPlanId : null) ?? i.duplicateOf?.planId ?? ''
    const res = s.result?.items.find((x) => x.itemId === i.itemId)
    const dup = i.duplicateOf?.storedRelPath ? `이미 있음: \`${i.duplicateOf.storedRelPath}\`` : i.unsupportedReason ?? ''
    const outcome = res ? `${res.status}${res.storedRelPath ? ` → \`${res.storedRelPath}\`` : ''}${res.errorMessage ? ` (${res.errorMessage})` : ''}` : dup
    out.push(
      `| ${i.fileName} | ${i.meta?.ndeVersion.raw ?? ''} | ${VERDICT_KO[i.verdict]} | ${plan} | ${i.suggestedSpecimenId ?? ''} | ${i.suggestedStateTag ?? ''} | ${outcome} |`
    )
  }
  if (p.newPlans.length > 0) {
    out.push('', '새 플랜 후보 (같은 지문끼리 묶음):', '')
    for (const n of p.newPlans) {
      const files = n.itemIds.map((id) => p.items.find((i) => i.itemId === id)!)
      const versions = files.map((f) => `${f.fileName} (${f.meta?.ndeVersion.raw})`).join(', ')
      out.push(`- **${n.provisionalPlanId}** \`${n.fingerprint.slice(0, 15)}…\` ${n.suggestedName}`)
      out.push(`  - 요약: ${n.summary}`)
      out.push(`  - 파일 ${files.length}개: ${versions}`)
      if (n.nearestPlan) {
        const diffs = n.nearestPlan.differences.slice(0, 4).map(describeDifference).join('; ')
        out.push(`  - 가장 가까운 기존 플랜 ${n.nearestPlan.planId}와 차이 ${n.nearestPlan.differences.length}건: ${diffs}${n.nearestPlan.differences.length > 4 ? ' …' : ''}`)
      }
    }
  }
  out.push('')
  return out
}

export function buildReport(r: E2eReport): string {
  const last = [...r.steps].reverse().find((s) => s.plans)?.plans ?? []
  const lines = [
    '# PAUT 데이터 관리 — 가져오기 E2E 결과',
    '',
    `- 실행: ${r.startedAt.toISOString()} (vitest \`tests/e2e/import.e2e.test.ts\`, Electron 없이 core 서비스만)`,
    '- 저장소: OS 임시 폴더에 만들고 테스트가 끝나면 지움. 원본(06_원시데이터, testdata)은 읽기만 함',
    '- 원본 불변 확인: X3 4개 파일의 크기·수정 시각·권한이 테스트 전후 같음',
    '- 지문 규칙: fp2 (SPEC_VERSION 2 — 반올림 노이즈 제거, 배관 원주 기본 360°, 탐촉자 장착 방향·스캔면, 스큐 0~360 정규화, 액주 웨지 각, TFM 송수신 역할 등). 이전 fp1 카탈로그는 저장소를 열 때 보관된 셋업 원문으로 다시 계산',
    '- 데이터 안전 회귀(강제 종료 흔적 복구, 사라진 사본 복원, 원본 폴더를 저장소로 고르기 거부, 저장소 사본 재수집 방지, 같은 배치 중복 결과)는 `tests/core/import/safety.test.ts` 에서 확인',
    '',
    '## 카탈로그 상태 (X3 + 공식 예제 확정 직후)',
    '',
    `플랜 ${last.length}개, 파일 ${last.reduce((s, p) => s + p.fileCount, 0)}개, 총 ${formatBytes(last.reduce((s, p) => s + p.totalBytes, 0))}`,
    '',
    '| 플랜 | 이름 | 시편 | 파일 | 용량 |',
    '|---|---|---|---|---|',
    ...last.map((p) => `| ${p.id} | ${p.name} | ${p.specimenCount} | ${p.fileCount} | ${formatBytes(p.totalBytes)} |`),
    '',
    '## 단계별 결과',
    '',
    ...r.steps.flatMap(stepSection),
    ...(r.extra?.length ? ['## 그 밖에 확인한 것', '', ...r.extra.map((x) => `- ${x}`), ''] : [])
  ]
  return `${lines.join('\n')}\n`
}
