import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const APP_ROOT = resolve(import.meta.dirname, '..')
export const TOOL_ROOT = resolve(APP_ROOT, '..')
/** 실데이터 (읽기 전용) */
export const X3_DIR = resolve(TOOL_ROOT, '../06_원시데이터/02_라벨완료/X3_12T-SV')
export const X3_FILES = ['12T-SV-01-Cap on.nde', '12T-SV-02-Cap on.nde', '12T-SV-03-Cap off.nde', '12T-SV-04-Cap on.nde'].map(
  (n) => resolve(X3_DIR, n)
)
/** OmniScan X4 NDE 4.2 시험 데이터 (읽기 전용): 컴파운드 1그룹, 섹토리얼 + 리니어 2그룹 */
export const X4_TF_DIR = resolve(TOOL_ROOT, 'testdata/X4_TF')
export const X4_TF_COMPOUND = resolve(X4_TF_DIR, 'TF_01_C_L_0001.nde')
export const X4_TF_LINEAR = resolve(X4_TF_DIR, 'TF_01_L_0001.nde')
/** 공식 예제 (읽기 전용) */
export const EXAMPLES_DIR = resolve(TOOL_ROOT, 'testdata/nde_공식예제')

/** 공식 예제 .nde 11개 (숨김 폴더 .claude 등 제외) */
export function listExampleFiles(): string[] {
  const visible = (n: string): boolean => !n.startsWith('.')
  return readdirSync(EXAMPLES_DIR)
    .filter(visible)
    .sort()
    .flatMap((v) =>
      readdirSync(resolve(EXAMPLES_DIR, v))
        .filter((n) => visible(n) && n.toLowerCase().endsWith('.nde'))
        .sort()
        .map((n) => resolve(EXAMPLES_DIR, v, n))
    )
}

/** OPD (OmniScan MX2 .opd) 원시데이터 (읽기 전용) — 경로는 이 폴더 기준 상대경로로 쓴다 (OPD_조사/1_파서실험_전수결과.csv 와 같음) */
export const RAW_DATA_DIR = resolve(TOOL_ROOT, '../06_원시데이터')
/** OPD 전수 기준표 원본 CSV (조사 문서, 읽기 전용). tests/fixtures/opd/survey.json 이 이 표를 옮긴 것 */
export const OPD_SURVEY_CSV = resolve(TOOL_ROOT, 'OPD_조사/1_파서실험_전수결과.csv')
/** 대표 OPD (OPD_조사/판단.md 7절 1단계): 상대경로 */
export const OPD_FILES = {
  tp14RootL: '02_라벨완료/PCN교육/TP14/TP14-ROOT-L-01.opd',
  tp14RootR: '02_라벨완료/PCN교육/TP14/TP14-ROOT-R-01.opd',
  tp14SwL: '02_라벨완료/PCN교육/TP14/TP14-SW-L-01.opd',
  tp14TopL: '02_라벨완료/PCN교육/TP14/TP14-TOP-L-01.opd',
  tp01SwL: '02_라벨완료/PCN교육/TP01/TP01-SW-L-01.opd',
  pl23861RootL: '02_라벨완료/PCN교육/PL23861/PL23861-ROOT-L-01.opd',
  sec20sr01_01: '03_라벨미확인/인천지사/SEC20/200_dh_91_053_uh1_S20_sr01_01.opd',
  sec20sr02_01: '03_라벨미확인/인천지사/SEC20/200_dh_91_053_uh1_S20_sr02_01.opd',
  sec20sr03_01: '03_라벨미확인/인천지사/SEC20/200_dh_91_053_uh1_S20_sr03_01.opd',
  sec25sr1_01: '03_라벨미확인/인천지사/SEC25-2/200_dh_91_029_uh1_S25-2 sr1_01.opd',
  sec25sr1_04: '03_라벨미확인/인천지사/SEC25-2/200_dh_91_029_uh1_S25-2 sr1_04.opd',
  s36_1: '03_라벨미확인/6.4T_불량/S36-1.opd',
  corrosionC10: '04_부식시험/2026-05-21/01_기존세트/C10_01.opd'
} as const
export function opdPath(rel: string): string {
  return resolve(RAW_DATA_DIR, rel)
}
