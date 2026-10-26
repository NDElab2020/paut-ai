import { useState, type DragEvent } from 'react'
import type { ChoosePathsMode } from '@shared/api'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { BigIcon, Icon } from '../../components/Icon'
import { ErrorNotice } from '../../components/ErrorNotice'
import { analyze } from './store'

/** 큰 드롭 영역 + 파일/폴더 선택 버튼. 놓거나 고르면 바로 분석을 시작한다 */
export function Dropzone() {
  const api = getApi()
  const [over, setOver] = useState(false)
  const [error, setError] = useState<UiError | null>(null)

  const choose = async (mode: ChoosePathsMode): Promise<void> => {
    setError(null)
    try {
      const paths = await unwrap(api.import.choosePaths(mode))
      if (paths.length) await analyze(paths)
    } catch (e) {
      setError(toUiError(e))
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setOver(false)
    const paths = [...e.dataTransfer.files].map((f) => api.files.pathForFile(f)).filter(Boolean)
    if (paths.length) void analyze(paths)
  }

  return (
    <>
      {error ? <ErrorNotice title="파일을 고르지 못했습니다" error={error} /> : null}
      <div
        className={over ? 'dropzone import-drop is-dragover' : 'dropzone import-drop'}
        role="region"
        aria-label="NDE·OPD 파일 또는 폴더 놓는 곳"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!over) setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={onDrop}
        onClick={(e) => {
          if (e.target === e.currentTarget) void choose('files')
        }}
      >
        <BigIcon name="upload" className="dropzone__icon" />
        <span className="dropzone__title">{over ? '놓으면 분석을 시작합니다' : 'NDE·OPD 파일이나 폴더를 여기에 놓으세요'}</span>
        <span className="dropzone__hint">
          .nde·.opd 를 정리하고 .oud·.wkb 는 보류로 표시합니다 · 숨김 폴더는 건너뜁니다 · 원본은 바꾸지 않고 복사합니다
        </span>
        <div className="dropzone__actions">
          <button type="button" className="btn btn--secondary" onClick={() => void choose('files')}>
            <Icon name="file" />
            파일 선택
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void choose('folder')}>
            <Icon name="folder" />
            폴더 선택
          </button>
        </div>
      </div>
    </>
  )
}
