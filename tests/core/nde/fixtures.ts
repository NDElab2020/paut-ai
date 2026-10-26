import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { openNde, normalizeSetup, type OpenedNde } from '@core/nde'
import type { NormalizedSetup } from '@shared/types'
import { EXAMPLES_DIR, X3_FILES, listExampleFiles } from '../../paths'

export const HAS_X3 = X3_FILES.every((p) => existsSync(p))
export const HAS_EXAMPLES = existsSync(EXAMPLES_DIR)

export const example = (version: string, name: string): string => resolve(EXAMPLES_DIR, version, name)

export const EX = {
  manualPa33: example('3.3', 'ManualWeldPA.nde'),
  manualUt33: example('3.3', 'ManualWeldUT.nde'),
  manualPa40: example('4.0', 'ManualWeldPA-4.0.nde'),
  tfm41: example('4.1', 'Weld_Plate_4TFM_sk90-4.1.nde'),
  ut41: example('4.1', 'Weld_Plate_UT-sk90-4.1.nde'),
  cod42: example('4.2', 'Weld_COD_2PA-ToFD-4.2.nde'),
  tfm42: example('4.2', 'Weld_Plate_4TFM_sk90-4.2.nde'),
  comp42: example('4.2', 'Weld_Plate_PA-Comp_sk90-2gr-4.2.nde'),
  sect42: example('4.2', 'Weld_Plate_PA-Sect_sk90-4.2.nde'),
  tofd42: example('4.2', 'Weld_Plate_ToFD_Parallel-4.2.nde'),
  ut42: example('4.2', 'Weld_Plate_UT-sk90-4.2.nde')
} as const

export interface Loaded {
  raw: OpenedNde
  norm: NormalizedSetup
  fileName: string
}

const cache = new Map<string, Promise<Loaded>>()

export function load(path: string): Promise<Loaded> {
  let p = cache.get(path)
  if (!p) {
    p = openNde(path).then((raw) => ({ raw, norm: normalizeSetup(raw.setup, raw.version), fileName: basename(path) }))
    cache.set(path, p)
  }
  return p
}

export { X3_FILES, listExampleFiles }

/** 셋업 JSON 깊은 복사 (테스트에서 변형용) */
export function clone<T>(v: T): T {
  return structuredClone(v)
}
