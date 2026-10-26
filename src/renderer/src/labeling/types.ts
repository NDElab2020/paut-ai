/**
 * 뷰어(NdeViewer) ↔ 라벨 패널 계약 — 오른쪽 열에 붙는 패널(LabelPanel)이 받는 것과 돌려주는 것.
 * 패널 내용(세트·새 기록·제안·속성·저장·관측 표·지시 표·형상 에코·검토 구간)은 LabelPanel.tsx 와 부품들. 뷰어는 이 타입만 보고 패널을 끼운다.
 *
 *   받는 것: 파일·그룹·볼륨·진폭 읽기(파일 이득 0 dB), 라벨 상태(state.ts)와 dispatch, 커서, 기준 커서 길이 S(m−r),
 *            읽기값(마지막으로 찍은 점·시간 커서·올려 둔 점), 후처리 상태(이득·게이트 스냅샷), 뷰별 보이는 범위
 *   돌려주는 것: 덮개(onOverlays — 저장한 기록 상자·팁 점·형상 에코 띠·검토 구간 등, 뷰 축 단위), 커서 옮기기(onGoto), 접기(onCollapse)
 */
import type { Dispatch } from 'react'
import type { FileRecord } from '@shared/types'
import type { PostProcess, ViewKind, ViewViewport, ViewerFileInfo, ViewerGroup } from '@shared/imaging'
import type { GroupAmplitude, ReadingStage } from '@shared/labels'
import type { ViewOverlay } from '../viewer/overlay'
import type { GroupVolume } from '../viewer/volumeStore'
import type { PointReading } from './reading'
import type { LabelAction, LabelState } from './state'
import type { ValueStore } from './store'
import type { WorkSession } from './workSession'

/** 그룹 하나 (볼 수 있는 그룹 전부 — 화면에 안 보이는 그룹도 볼륨을 이미 읽었으면 넘긴다) */
export interface LabelGroupSource {
  group: ViewerGroup
  /** 진폭 볼륨 (아직 읽지 않았으면 null) */
  volume: GroupVolume | null
  /**
   * 변환 계산용 진폭 읽기 (shared/labels derive GroupAmplitude, %FSH = 파일 이득 그대로 = 소프트 이득 0 dB).
   * amplitudeFromVolume(group, volume.amplitude, volume.status) 를 그룹마다 한 번 만든 것. 볼륨이 없으면 null.
   * deriveFileLabels·runDerive 의 DeriveGroupInput.amplitude 로 그대로 넘긴다
   */
  amplitude: GroupAmplitude | null
  /** 화면 소프트 이득 Δ (dB) — 기록의 displayGainDb·화면 스냅샷용. 진폭 계산에는 쓰지 않는다 */
  displayGainDb: number
  /** 지금 화면에 보이는 그룹인가 */
  shown: boolean
}

/** 지금 커서 (스캔 위치는 모든 그룹이 함께, 빔은 그룹마다) */
export interface LabelCursor {
  activeGroupId: number
  /** 활성 그룹 기준 스캔 위치 (mm, 칸 가운데) */
  scanMm: number
  /** 그룹 id → 스캔 칸 */
  scanIndex: Readonly<Record<number, number>>
  /** 그룹 id → 빔 */
  beam: Readonly<Record<number, number>>
}

/**
 * 패널이 영상에 올리는 덮개 (뷰 축 단위 — viewer/overlay.ts 머리 주석). 뷰어는 초안 덮개(labeling/overlays.ts) 위에 합쳐 그린다.
 * S-scan 은 지금 스캔 칸의 것만 넣는다(장면 상자는 칸마다 다름 — cursor.scanIndex 참고). 같은 내용이면 같은 객체를 넘겨 다시 그리지 않게
 */
export interface LabelViewOverlays {
  /** 그룹 id → S-scan (V mm, 펼친 깊이 mm) */
  sscan?: Readonly<Record<number, ViewOverlay>>
  /** 그룹 id → C-scan (스캔 U mm, 빔 번호 실수 — 칸 b = [b − ½, b + ½]) */
  cscan?: Readonly<Record<number, ViewOverlay>>
  /** 활성 그룹·현재 빔 B-scan (스캔 U mm, 펼친 깊이 mm) — A-B-C-S 레이아웃에서만 보인다 */
  bscan?: ViewOverlay
  /** 활성 그룹·현재 빔 A-scan (진폭 %, 펼친 깊이 mm) */
  ascan?: ViewOverlay
}

/** 커서 옮기기 (지시 표의 행을 누를 때 등). beam 이 없으면 그 그룹의 빔은 그대로 */
export interface LabelGotoTarget {
  groupId: number
  scanMm: number
  beam?: number
  /**
   * 기록의 화면 스냅샷(이득·게이트·색표)을 덮은 후처리 — 있으면 뷰어가 그대로 불러온다(postReducer 'load', 후처리 되돌리기 이력은 비움).
   * 패널이 record.ts postWithSnapshot 으로 만든다
   */
  post?: PostProcess
}

export interface LabelPanelProps {
  /** 파일 기록 (sha256 = file.meta.sha256) */
  file: FileRecord
  /** 뷰어 key ('storeRoot|fileId|sha256') — 같은 파일 같은 저장소면 같다 */
  viewerKey: string
  info: ViewerFileInfo
  sha256: string
  /** 볼 수 있는 그룹 전부 (파일 순서) */
  groups: readonly LabelGroupSource[]
  /** 두께 (셋업 시편 두께. 파일 정렬 값은 패널이 덮어쓴다) */
  thicknessMm: number | null
  /** 라벨 상태 (state.ts) — 도구·초안·선택·시간 커서 */
  state: LabelState
  dispatch: Dispatch<LabelAction>
  cursor: LabelCursor
  /** 기준 커서 R 과 현재 커서로 잰 길이 S(m−r) (mm — OmniPC 측정값의 S 는 스캔축). R 이 없으면 null */
  lengthMm: number | null
  /** 마지막으로 찍은(또는 고른) 점의 읽기값 */
  lastReading: PointReading | null
  /** A-scan 시간 커서의 읽기값 */
  timeReading: PointReading | null
  /** S-scan 위에 올려 둔 점의 읽기값 (포인터를 움직일 때마다 바뀜 — useSyncExternalStore 로 읽는다) */
  hover: ValueStore<PointReading | null>
  /** 후처리 상태 (이득 Δ·게이트 override·색표 — 기록의 화면 스냅샷) */
  post: PostProcess
  /** 뷰별 지금 보이는 범위 (그 뷰가 아직 그려지지 않았으면 null) */
  getViewport: (kind: ViewKind, groupId: number) => ViewViewport | null
  /** 덮개를 바꾼다 (null = 패널 덮개 없음) */
  onOverlays: (overlays: LabelViewOverlays | null) => void
  onGoto: (target: LabelGotoTarget) => void
  /** 패널 접기 */
  onCollapse: () => void
  /** 작업 이벤트 세션 (뷰어가 들고 있음 — 라벨 모드를 껐다 켜도 이어짐). 패널은 세트를 정해 주고 기록·검토 이벤트를 남긴다 */
  work: WorkSession
  /** A-scan 시간 커서 깊이를 지금 찍을 점으로 (T 키와 같음) */
  onTimePoint: () => void
  /** 그 그룹만 보기 (그룹이 여럿이면 영상이 작아 빔 줄을 누르기 어렵다) */
  onSingleGroup: (groupId: number) => void
}

/** 세트 하나 (라벨러·판독 단계·지침서) — 검수 비교 보기의 A·B */
export interface LabelCompareSide {
  labelerId: string
  readingStage: ReadingStage
  guidelineVersion: string
}

/** 검수 화면 '영상으로 보기'에서 연 두 세트 비교 (읽기 전용 덮개 — A 기록 자홍, B 기록 주황) */
export interface LabelCompare {
  a: LabelCompareSide
  b: LabelCompareSide
  /** 그 행의 기록 (진하게) */
  recordUuid: string | null
}

export interface ComparePanelProps {
  sha256: string
  compare: LabelCompare
  groups: readonly LabelGroupSource[]
  thicknessMm: number | null
  cursor: LabelCursor
  onOverlays: (overlays: LabelViewOverlays | null) => void
  onGoto: (target: LabelGotoTarget) => void
  /** 비교 보기 끄기 (보통 라벨 패널로) */
  onClose: () => void
}
