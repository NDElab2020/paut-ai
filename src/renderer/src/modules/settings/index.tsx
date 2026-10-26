/** 설정: 저장소 위치 · 테마 · 앱 정보(네트워크 미사용 명시) */
import { useState } from 'react'
import type { ModuleProps } from '@shared/modules'
import { getApi, toUiError, unwrap, type UiError } from '../../api'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import { DASH } from '../../lib/format'
import { useApp, type Theme } from '../../state/AppContext'

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'light', label: '라이트', hint: '흰 바탕 (기본)' },
  { value: 'dark', label: '다크', hint: '어두운 바탕' }
]

const PLATFORM: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', web: '브라우저 미리보기' }

export default function SettingsModule(_props: ModuleProps) {
  const { settings, settingsError, info, theme, setTheme, reloadSettings, bumpData } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UiError | null>(null)

  const changeRoot = async (): Promise<void> => {
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
    <div className="settings">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">설정</h1>
          <p className="page-header__desc">바꾼 내용은 바로 저장됩니다.</p>
        </div>
      </div>
      {settingsError ? <ErrorNotice title="설정을 읽지 못했습니다" error={settingsError} onRetry={reloadSettings} /> : null}

      <section className="panel settings__panel" aria-labelledby="set-store">
        <h2 className="panel__title" id="set-store">
          저장소
        </h2>
        <dl className="kv">
          <dt>현재 위치</dt>
          <dd className="mono break">{settings?.storeRoot ?? '정해지지 않음'}</dd>
          <dt>카탈로그</dt>
          <dd className="mono break">{info?.catalogPath ?? DASH}</dd>
          <dt>폴더 구조</dt>
          <dd className="mono">스캔플랜 / 플랜 ID / 시편 ID / 원본 파일명</dd>
        </dl>
        {error ? <ErrorNotice title="저장소를 바꾸지 못했습니다" error={error} /> : null}
        <div className="settings__actions">
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void changeRoot()}>
            <Icon name="folder" />
            {settings?.storeRoot ? '위치 바꾸기' : '저장소 폴더 선택'}
          </button>
          <span className="t-caption">위치를 바꿔도 이전 저장소의 파일은 옮기지 않습니다.</span>
        </div>
      </section>

      <section className="panel settings__panel" aria-labelledby="set-theme">
        <h2 className="panel__title" id="set-theme">
          화면
        </h2>
        <div role="radiogroup" aria-labelledby="set-theme" className="settings__radios">
          {THEMES.map((t) => (
            <label key={t.value} className="check settings__radio">
              <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => setTheme(t.value)} />
              <span>
                <span className="t-label">{t.label}</span> <span className="t-caption">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel settings__panel" aria-labelledby="set-info">
        <h2 className="panel__title" id="set-info">
          앱 정보
        </h2>
        <dl className="kv">
          <dt>이름</dt>
          <dd>{info?.appName ?? DASH}</dd>
          <dt>버전</dt>
          <dd className="num">{info?.version ?? DASH}</dd>
          <dt>실행 환경</dt>
          <dd>
            {info ? PLATFORM[info.platform] ?? info.platform : DASH}
            {info?.electron ? ` · Electron ${info.electron}` : ''}
            {info?.node ? ` · Node ${info.node}` : ''}
          </dd>
        </dl>
        <div className="notice notice--accent settings__network">
          <div className="notice__body">
            <p className="notice__title">네트워크를 쓰지 않습니다</p>
            <p>외부 서버 연결, 자동 업데이트, 사용 통계 전송이 없습니다. 글꼴과 아이콘도 프로그램 안에 들어 있어 폐쇄망에서 그대로 동작합니다.</p>
          </div>
        </div>
        {info?.mock ? <p className="setup-panel__note">지금은 브라우저 미리보기로 실행 중이며 가짜 데이터를 보여 줍니다.</p> : null}
      </section>
    </div>
  )
}
