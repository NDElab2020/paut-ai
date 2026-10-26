import { OPD_ACCURACY_NOTE, OPD_FORMAT_LABEL, isOpdMeta, type NdeFileMeta } from '@shared/types'
import { Tag } from '../../components/Status'

/**
 * 파일 형식 표시: .nde = 버전 그대로('4.2.0'), OPD = 'OPD · 자체 해석 · 대조 전'.
 * 대조 상태는 글자로 보인다(툴팁은 키보드·화면 읽기로 닿지 않음). 툴팁에는 장비 앱·읽기 규칙
 */
export function FormatTag({ meta }: { meta: Pick<NdeFileMeta, 'ndeVersion' | 'reader'> }) {
  if (!isOpdMeta(meta)) return <Tag>{meta.ndeVersion.raw}</Tag>
  const reader = meta.reader ? ` · 읽기 규칙 ${meta.reader.name} v${meta.reader.version}` : ''
  return <Tag title={`${meta.ndeVersion.raw}${reader} — 공개되지 않은 형식을 파일 구조를 따라 읽었습니다(OmniPC 대조 전).`}>{OPD_FORMAT_LABEL}</Tag>
}

/** OPD 항목 아래 한 줄 ('정확도 대조 전 — 자동 변환·학습 내보내기 막힘'). .nde 는 없음 */
export function FormatNote({ meta }: { meta: Pick<NdeFileMeta, 'ndeVersion'> | null | undefined }) {
  return isOpdMeta(meta) ? <span className="file-cell__device">{OPD_ACCURACY_NOTE}</span> : null
}
