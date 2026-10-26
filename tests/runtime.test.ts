import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { EXAMPLES_DIR, X3_FILES, listExampleFiles } from './paths'

async function openH5() {
  const h5wasm = (await import('h5wasm/node')).default
  await h5wasm.ready
  return h5wasm
}

describe('런타임 전제', () => {
  it('node:sqlite 사용 가능', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('create table t(a text)')
    db.prepare('insert into t values (?)').run('스캔플랜')
    expect(db.prepare('select a from t').get()).toEqual({ a: '스캔플랜' })
    db.close()
  })

  it.skipIf(!existsSync(X3_FILES[0]!))('h5wasm 으로 X3(3.3) 셋업 읽기', async () => {
    const h5 = await openH5()
    const f = new h5.File(X3_FILES[0]!, 'r')
    try {
      expect(f.keys()).toEqual(expect.arrayContaining(['Applications', 'Domain']))
      const setup = JSON.parse(String((f.get('Domain/Setup') as { value: unknown }).value))
      expect(setup.version).toBe('3.3.0')
      expect(setup.groups.map((g: { name: string }) => g.name)).toEqual(['Skew90', 'Skew270'])
    } finally {
      f.close()
    }
  })

  it.skipIf(!existsSync(EXAMPLES_DIR))('h5wasm 으로 공식 예제(3.3~4.2) 셋업 모두 읽기', async () => {
    const h5 = await openH5()
    const files = listExampleFiles()
    expect(files.length).toBe(11)
    for (const p of files) {
      const f = new h5.File(p, 'r')
      try {
        const keys = f.keys()
        const path = keys.includes('Domain') ? 'Domain/Setup' : 'Public/Setup'
        const setup = JSON.parse(String((f.get(path) as { value: unknown }).value))
        expect(typeof setup.version, p).toBe('string')
      } finally {
        f.close()
      }
    }
  })
})
