/**
 * JSON 백업 내보내기 범위 고르기: 전체 / 고른 파일만. 저장 위치는 다음 단계의 저장 대화상자에서 고른다.
 * (학습 데이터 내보내기는 TrainingExportDialog — 이것은 라벨 기록 자체를 다른 PC 로 옮기거나 백업하는 것)
 * 2인 독립 모드면 지금 라벨러의 세트만 담긴다(화면에 보이는 숫자와 같은 범위).
 * 담지 않는 것(제출 잠금·대조 사본 출처·분할·시험 잠금·엑셀 표시 — 모두 이 저장소 label_meta·label_import_marks)도 글로 알린다(app README '라벨 JSON 백업이 담지 않는 것').
 */
import { useEffect, useRef, useState } from 'react'

export type ExportScopeChoice = 'all' | 'files'

export function ExportDialog(props: {
  selectedCount: number
  labeledCount: number
  /** 2인 독립 모드면 지금 라벨러 이름 (그 사람 세트만 내보냄) */
  blindLabeler: string | null
  onCancel: () => void
  onExport: (scope: ExportScopeChoice) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [scope, setScope] = useState<ExportScopeChoice>(props.selectedCount > 0 ? 'files' : 'all')

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
    return () => d?.close?.()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="labels-export-title"
      onCancel={(e) => {
        e.preventDefault()
        props.onCancel()
      }}
    >
      <h2 className="dialog__title" id="labels-export-title">
        라벨을 JSON 백업 파일로 내보냅니다
      </h2>
      <div className="dialog__body">
        <p>
          라벨 기록 자체를 담습니다. 다른 PC 에서 'JSON 가져오기'로 합칠 수 있습니다. 지운 기록과 풀지 않은 충돌도 함께 담깁니다. AI 학습용 파일은 '학습 데이터
          내보내기'로 만듭니다.
        </p>
        <p className="t-caption">
          담지 않는 것: 블라인드 세트 제출(잠금), 설계값 대조 사본의 출처, 학습 데이터 분할과 시험 세트 잠금, 엑셀 가져오기 표시. 이것들은 이 저장소에만
          남습니다. 저장소 전체를 백업하려면 앱을 끈 뒤 저장소 폴더의 catalog.db 를 복사하세요.
        </p>
        {props.blindLabeler ? (
          <p className="text-accent">2인 독립 모드라 라벨러 {props.blindLabeler}의 라벨 세트만 담습니다. 다른 라벨러 세트까지 보내려면 2인 모드를 끄고 내보냅니다.</p>
        ) : null}
        <div role="radiogroup" aria-labelledby="labels-export-title" className="stack labels-export__choices">
          <label className="check">
            <input type="radio" name="labels-export" checked={scope === 'all'} onChange={() => setScope('all')} />
            <span>
              전체{' '}
              <span className="t-caption">
                {props.blindLabeler ? `이 라벨러의 라벨 있는 파일 ${props.labeledCount}개` : `라벨 있는 파일 ${props.labeledCount}개와 기록만 있는 파일 모두`}
              </span>
            </span>
          </label>
          <label className="check">
            <input type="radio" name="labels-export" checked={scope === 'files'} disabled={props.selectedCount === 0} onChange={() => setScope('files')} />
            <span>
              고른 파일만 <span className="t-caption">{props.selectedCount > 0 ? `${props.selectedCount}개` : '표에서 파일을 먼저 고르세요'}</span>
            </span>
          </label>
        </div>
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onCancel}>
          취소
        </button>
        <button type="button" className="btn btn--primary" autoFocus onClick={() => props.onExport(scope)}>
          내보내기
        </button>
      </div>
    </dialog>
  )
}
