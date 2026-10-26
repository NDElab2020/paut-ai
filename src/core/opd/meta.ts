/**
 * OPD 구조 읽기 결과(OpdFile) → 가져오기용 파일 메타(NdeFileMeta)·셋업 원문·미리보기 경고 (판단.md 7절 4·5단계).
 * 메타 칸은 파일에서 읽은 값만 쓴다: 형식 'opd'·읽기 규칙 버전, 장비 저장 이름, 저장 시각(OLE DATE, 시간대 없음),
 * 장비 모듈·시리얼, 장비 앱(MXU) 버전.
 */
import type { NdeFileMeta, NdeFormatVersion } from '@shared/types'
import { OPD_FORMAT_NOTE } from './normalize'
import type { OpdFile } from './types'

/** 미리보기·파일 상세에서 OPD 를 가리키는 짧은 표시 (화면과 같은 값 — shared/types) */
export { OPD_FORMAT_LABEL } from '@shared/types'

/** file_setups 에 넣는 셋업 원문의 형식 표시 (.nde 셋업 JSON 과 구별) */
export const OPD_SETUP_FORMAT = 'opd-structure'

/** 'OPD · MXU - 4.4R5' — major·minor·patch 는 MXU 4.4R5 → 4.4.5 (MXU 문자열을 못 읽었으면 0) */
export function opdFormatVersion(file: OpdFile): NdeFormatVersion {
  const m = file.header.mxu
  return {
    raw: `OPD · ${file.header.mxuVersion}`.trim(),
    family: 'opd',
    major: m?.major ?? 0,
    minor: m?.minor ?? 0,
    patch: m?.revision ?? 0,
    preRelease: null
  }
}

/** 'MXU - 4.4R5' → { name: 'MXU', version: '4.4R5' } (모양이 다르면 이름에 통째로) */
function application(mxuVersion: string): NdeFileMeta['application'] {
  const m = /^\s*(\S+)\s*-\s*(\S+)\s*$/.exec(mxuVersion)
  if (m) return { name: m[1]!, version: m[2]! }
  return { name: mxuVersion.trim() || null, version: null }
}

/** OPD → 파일 메타 (해시·크기·경로 제외) */
export function opdFileMeta(file: OpdFile): NdeFileMeta {
  const h = file.header
  return {
    ndeVersion: opdFormatVersion(file),
    deviceFileName: h.deviceFileName ? h.deviceFileName.normalize('NFC') : null,
    // 장비 이름(OmniScan MX2/SX)을 적은 칸은 없다 — 모듈 문자열(OMNISX-PA1664PR)만 그대로 둔다
    device: { platform: null, model: h.module || null, serialNumber: h.serialNumber, name: null },
    createdAt: h.savedAt,
    modifiedAt: null,
    application: application(h.mxuVersion),
    scenario: null,
    reader: { name: file.reader.name, version: file.reader.version }
  }
}

/**
 * file_setups 에 넣는 셋업 원문: 우리가 읽은 구조 JSON (날 값 + 읽기 규칙 버전).
 * 플랜 지문을 다시 계산할 때는 이 원문이 아니라 저장소 사본을 다시 읽는다(읽기 규칙이 바뀌면 새 칸이 생길 수 있어서).
 */
export function opdSetupText(file: OpdFile): string {
  return JSON.stringify({ format: OPD_SETUP_FORMAT, ...file })
}

const stemOf = (fileName: string): string => (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]+$/, '').normalize('NFC')

/** 구분자(-, _, 공백)를 하나로, 대소문자 무시 */
const loose = (s: string): string => s.normalize('NFC').trim().toLowerCase().replace(/[-_\s]+/g, '-')

/**
 * 장비 저장 이름과 파일 이름이 같은 측정을 가리키는지.
 * - 'TP14-ROOT-L-##' 처럼 '#' 자리표시가 있으면 그 자리에 숫자가 오는 이름과 같다 (구분자·대소문자 무시)
 * - 자리표시가 없으면 같거나, 장비 이름이 파일 이름을 앞뒤 낱말로 품으면 같다 ('450A S36-1' ↔ 'S36-1')
 */
export function deviceNameMatchesFile(deviceFileName: string, fileName: string): boolean {
  const stem = loose(stemOf(fileName))
  const dev = loose(deviceFileName)
  if (!dev || !stem) return true
  if (dev.includes('#')) {
    const pattern = dev
      .split(/(#+)/)
      .map((part) => (part.startsWith('#') ? '\\d+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('')
    return new RegExp(`^${pattern}$`).test(stem)
  }
  return dev === stem || dev.endsWith(`-${stem}`) || dev.startsWith(`${stem}-`)
}

/**
 * 미리보기 항목 경고 (OPD 만): 장비 저장 이름 ≠ 파일 이름, 구조 읽기 경고(두께 불일치·2축·위치 수 등).
 * 늘 붙는 '공개되지 않은 형식' 경고는 'OPD · 자체 해석 · 대조 전' 표시와 '정확도 대조 전 — 자동 변환·학습 내보내기 막힘' 줄로 대신해 넣지 않는다.
 */
export function opdImportWarnings(file: OpdFile, fileName: string): string[] {
  const out: string[] = []
  const dev = file.header.deviceFileName
  if (dev && !deviceNameMatchesFile(dev, fileName)) {
    out.push(`장비 저장 이름(${dev})이 파일 이름과 다릅니다. 시편 ID·좌우(L/R)를 확인하세요.`)
  }
  for (const w of file.warnings) {
    if (w === OPD_FORMAT_NOTE) continue
    if (file.raster.twoAxis && w.startsWith('2축 스캔')) {
      const t = file.raster.twoAxis
      out.push(`2축 스캔(인덱스 ${t.indexLines}줄 × 스캔 ${t.scanCount}칸)이라 보관만 합니다. 이미지 보기·라벨링은 아직 지원하지 않습니다.`)
      continue
    }
    out.push(w)
  }
  return out
}
