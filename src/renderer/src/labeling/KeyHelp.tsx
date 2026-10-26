/**
 * 라벨 모드 단축키 표 (도움말). 지금 쓰는 뷰어 키(화살표·G·Z·=·−·0·A)와 겹치지 않게 라벨 키를 정했다(규격_초안.md 7절).
 * 입력란 안에서는 뷰어 키가 듣지 않는다. 길이 이름은 OmniPC 측정값 규칙대로 S(m−r)(S = 스캔축, U = 초음파축 — 설명서 3판).
 * OmniPC 6.6 의 같은 조작 열은 캡처 47(단축키 목록) 뒤에 더한다(조사_보고 X6).
 */
export const LABEL_KEYS: ReadonlyArray<{ keys: string; what: string }> = [
  { keys: 'L', what: '라벨 모드 켜고 끄기 (보통 모드 그림은 그대로)' },
  { keys: '1 · 2 · 3 · 4', what: '도구: 점 · 사각형 · 길이 · 검토 구간' },
  { keys: 'N', what: '지금 칸 ± 2 칸·± 2 빔의 게이트 최대를 최대 진폭 점으로 (그 칸으로 커서를 옮김)' },
  { keys: 'T', what: 'A-scan 시간 커서 깊이를 지금 찍을 점으로 (팁 피크 깊이)' },
  { keys: 'R · Shift+R', what: '지금 커서를 기준 커서 R 로 · R 지우기 (R → 현재 커서 = 길이 S(m−r))' },
  { keys: 'S-scan 클릭 · 끌기', what: "점 찍기 · 사각형 (에코 범위). '최대 진폭' 점은 ± 1 빔·± 1.5 mm 국소 최대로 붙음" },
  { keys: 'C/B-scan 끌기', what: '길이 도구: R(누른 곳) → 커서(놓은 곳) = S(m−r) · 검토 구간 도구: 구간' },
  { keys: 'A-scan 클릭', what: '시간(깊이) 커서 — 그 깊이의 진폭' },
  { keys: 'S-scan 휠 · Alt+휠 · Shift+휠', what: '깊이 확대 · V 확대 · 옮기기 (라벨 모드에서만)' },
  { keys: '눈금자 끌기 · 더블클릭', what: '그 구간으로 확대 · 그 축 초기화' },
  { keys: 'Z · Shift+Z', what: '범위 초기화 (S-scan 확대 포함) · 모두' },
  { keys: 'Ctrl/Cmd+Enter', what: '기록 저장' },
  { keys: 'Delete', what: '고른 점·사각형 지우기 (패널 안에서는 듣지 않음)' },
  { keys: 'Esc', what: '끄는 중 취소 · 선택 풀기' },
  { keys: 'Ctrl/Cmd+Z', what: '마지막 고침 되돌리기 (후처리·라벨 초안 가운데 마지막 것)' },
  { keys: '←/→ · ↑/↓ · G', what: '스캔 · 빔 · 다음 그룹 (보통 모드와 같음)' },
  { keys: '= · − · 0 · A', what: '화면 이득 (보통 모드와 같음 — 기록 진폭은 늘 파일 이득 0 dB)' },
  { keys: '지시 표 ↑/↓ · Enter', what: '기록 고르기 · 고치기' },
  { keys: '[ · ]', what: '같은 플랜의 이전 · 다음 파일 (시편 → 이름 순서, 라벨 모드 그대로 — 저장 안 한 초안·후처리는 앱을 닫기 전까지 파일마다 남음. 라벨 패널 안에서는 받지 않음)' }
]

export function KeyHelp() {
  return (
    <section className="label-panel__section" aria-label="단축키">
      <details className="label-details">
        <summary>단축키</summary>
        <dl className="label-keys">
          {LABEL_KEYS.map((k) => (
            <div key={k.keys} className="label-keys__row">
              <dt>
                <span className="label-keys__key">{k.keys}</span>
              </dt>
              <dd>{k.what}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
