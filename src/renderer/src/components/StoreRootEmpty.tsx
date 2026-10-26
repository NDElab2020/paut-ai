import { useState } from 'react'
import { getApi, toUiError, unwrap, type UiError } from '../api'
import { useApp } from '../state/AppContext'
import { EmptyState } from './EmptyState'
import { ErrorNotice } from './ErrorNotice'

/** 저장소 미설정 빈 상태. 이 화면의 주 행동은 '저장소 폴더 선택' 하나 */
export function StoreRootEmpty() {
  const { reloadSettings, bumpData } = useApp()
  const [error, setError] = useState<UiError | null>(null)
  const [busy, setBusy] = useState(false)
  const choose = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const picked = await unwrap(getApi().settings.chooseStoreRoot())
      if (picked) {
        reloadSettings()
        bumpData()
      }
    } catch (e) {
      setError(toUiError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      {error ? <ErrorNotice title="저장소를 정하지 못했습니다" error={error} /> : null}
      <EmptyState
        icon="store"
        title="저장소 위치가 정해지지 않았습니다"
        desc="가져온 NDE·OPD 파일을 복사해 둘 폴더를 고르면 스캔플랜별 정리를 시작합니다. 원본 파일은 바꾸지 않습니다."
        action={
          <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void choose()}>
            저장소 폴더 선택
          </button>
        }
      />
    </div>
  )
}
