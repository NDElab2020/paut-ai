/**
 * 뷰어 '◀ 이전 · 다음 ▶' (OmniPC 조사 X9 — 앱 자체 기능, OmniPC 기능 따라 하기 아님). 순수 계산 (tests/viewerNav.test.ts).
 *   같은 스캔플랜의 파일 전체를 시편 → 파일 이름 순서로 (2026-10-07 기본값 (가) — 예전에는 같은 시편 안에서만이라 X3 2인 판독 4개처럼
 *   시편이 모두 다른 플랜은 단추가 보이지 않았다. README '사용자 결정 대기' 2번, 사용자 확인 대기).
 *   시편·파일 이름 모두 사람이 읽는 순서(숫자는 값으로 — '_2' < '_10', 장비 Numeric 꼬리 `_0001`·Timestamp 꼬리도 그대로 맞음, 대소문자 무시),
 *   같은 이름이면 파일 ID 순. 끝에서는 멈춘다(돌아가지 않음).
 *   확장자를 뗀 줄기(stem)끼리 먼저 견준다: 'TP14-ROOT-L.opd' 가 'TP14-ROOT-L_0001.opd' 보다 앞 (통째로 견주면 ICU 에서 '_' < '.' 라
 *   꼬리 없는 원래 이름이 번호 꼬리 파일들 뒤로 간다 — 2026-10-07 검토). core/nde/naming.ts 에는 꼬리 정렬 함수가 없어 여기서 정한다.
 * 파일마다 라벨 세션·후처리 세션 캐시는 뷰어 key 로 따로 남고, 작업 이벤트는 뷰어가 닫히고 열리며 파일 닫기·열기로 남는다(workSession).
 */

export interface NavFile {
  id: number
  planId: string
  specimenId: string
  storedFileName: string
}

export interface FileNav<T extends NavFile = NavFile> {
  /** 같은 플랜 파일 (시편 → 이름 순) */
  files: T[]
  /** 지금 파일의 자리 (0부터, 목록에 없으면 −1) */
  index: number
  prev: T | null
  next: T | null
}

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })

/** '이름.확장자' → [줄기, 확장자] (점이 없거나 맨 앞이면 확장자 '') */
function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.')
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']
}

/** 이름 순서 비교 (줄기 먼저 — 숫자는 값으로, 대소문자 무시 — 다음 확장자, 같으면 ID) */
export function compareFileNames(a: Pick<NavFile, 'id' | 'storedFileName'>, b: Pick<NavFile, 'id' | 'storedFileName'>): number {
  const [sa, ea] = splitExt(a.storedFileName)
  const [sb, eb] = splitExt(b.storedFileName)
  return collator.compare(sa, sb) || collator.compare(ea, eb) || a.id - b.id
}

/** 플랜 안 순서: 시편 ID(사람이 읽는 순서) → 파일 이름 (compareFileNames) */
export function compareNavFiles(a: Pick<NavFile, 'id' | 'specimenId' | 'storedFileName'>, b: Pick<NavFile, 'id' | 'specimenId' | 'storedFileName'>): number {
  return collator.compare(a.specimenId, b.specimenId) || compareFileNames(a, b)
}

/** 지금 파일 기준 이전·다음 (같은 플랜 전체 — 목록에 다른 플랜이 섞여 와도 거른다) */
export function fileNavOf<T extends NavFile>(items: readonly T[], current: Pick<NavFile, 'id' | 'planId'>): FileNav<T> {
  const files = items.filter((f) => f.planId === current.planId).sort(compareNavFiles)
  const index = files.findIndex((f) => f.id === current.id)
  return {
    files,
    index,
    prev: index > 0 ? files[index - 1]! : null,
    next: index >= 0 && index < files.length - 1 ? files[index + 1]! : null
  }
}
