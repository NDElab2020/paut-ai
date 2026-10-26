/**
 * 시편 다시 묶기 (AI 개발 플랜 T4, 2026-10-26).
 *
 * 시편 ID 패턴(PL·TP·TF 번호)을 찾지 못해 파일명을 임시 시편 ID 로 받은 파일(시편 출처 'filename')을
 * 지금 패턴으로 다시 보고, 패턴 ID 가 나오면 그 시편으로 옮기자고 제안한다.
 * 예: TF_01_C_L_0001 · TF_01_L_0001 · TF_01_R_0002 … → TF_01 (한 시편의 양쪽 스큐·설정·반복 파일).
 *
 * 왜: 학습 분할은 시편 단위이고(export/split.ts), 물리 결함은 (시편 ID, 결함 ID) 로 잇는다.
 *     파일마다 시편이 다르면 같은 시편이 train·test 로 갈리고 L·R 의 같은 결함이 하나로 묶이지 않는다.
 *
 * 옮기지 않는 경우(사유를 보이고 건너뜀)
 *   - 사람이 고른 시편(출처 'manual')·장비 파일명에서 찾은 시편 — 제안 대상이 아님(목록에 안 나옴)
 *   - 지금 시편에 물리 결함(설계값)이 있음 — 결함이 옛 시편 ID 에 남아 연결이 끊긴다. 엑셀에서 먼저 옮길 것
 *   - 지금 시편에 학습 분할이 정해져 있음 — 분할이 옛 시편 키에 남는다
 *   - 옮길 시편이 시험 세트이고 시험 세트가 잠겨 있음 — 잠근 시험 세트 내용이 바뀐다
 * 파일 사본은 옮기지 않는다(카탈로그 moveFilesToSpecimen). 옛 시편 행은 파일이 남지 않으면 지운다.
 */
import type { SpecimenRegroupItem, SpecimenRegroupPreview } from '@shared/api'
import type { PhysicalDefect } from '@shared/labels/types'
import type { SpecimenIdSource } from '@shared/types'
import type { FileIdentity } from '../catalog/specimens'
import { splitOf, type SplitState } from '../labels/export/split'
import { suggestSpecimen } from '../nde'

const key = (id: string): string => id.normalize('NFC').trim().replace(/[A-Z]/g, (c) => c.toLowerCase())

export interface RegroupInputs {
  files: readonly FileIdentity[]
  /** 지운 것 포함 여부와 무관하게, 지우지 않은 물리 결함 */
  physicalDefects: readonly PhysicalDefect[]
  split: SplitState
}

export interface RegroupPlanItem extends SpecimenRegroupItem {
  toSource: SpecimenIdSource
}

/** 미리보기 계산 (순수). 같은 입력이면 같은 결과 */
export function planSpecimenRegroup(inp: RegroupInputs): { items: RegroupPlanItem[] } {
  const defects = new Map<string, number>()
  for (const d of inp.physicalDefects) if (!d.deleted) defects.set(key(d.specimenId), (defects.get(key(d.specimenId)) ?? 0) + 1)
  const items: RegroupPlanItem[] = []
  for (const f of inp.files) {
    if (f.specimenSource !== 'filename') continue
    const g = suggestSpecimen({ deviceFileName: f.deviceFileName }, f.sourceFileName || f.storedFileName)
    if (!g.specimenId || !g.source || key(g.specimenId) === key(f.specimenId)) continue
    const from = f.specimenId
    const to = g.specimenId
    let blocked: string | null = null
    const nDef = defects.get(key(from)) ?? 0
    const fromSplit = splitOf(inp.split, from)
    const toSplit = splitOf(inp.split, to)
    if (nDef > 0) blocked = `시편 ${from} 에 물리 결함(설계값) ${nDef}개가 있습니다. 엑셀 대조용 양식에서 시편 ID 를 먼저 바꾸세요.`
    else if (fromSplit) blocked = `시편 ${from} 에 학습 분할(${fromSplit})이 정해져 있습니다. 분할을 풀고 다시 묶으세요.`
    else if (toSplit === 'test' && inp.split.testLock.locked) blocked = `${to} 는 잠긴 시험 세트입니다. 잠금을 풀어야 파일을 더할 수 있습니다.`
    items.push({
      fileId: f.id,
      fileName: f.storedFileName,
      planId: f.planId,
      fromSpecimenId: from,
      toSpecimenId: to,
      toSource: g.source,
      note: g.notes[0] ?? '',
      blocked
    })
  }
  return { items }
}

/** 화면에 보낼 모양 (출처 칸 뺌) */
export function regroupPreviewOf(plan: { items: RegroupPlanItem[] }): SpecimenRegroupPreview {
  return { items: plan.items.map(({ toSource: _s, ...rest }) => rest) }
}
