import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  copyVerified,
  ensureStoreRoot,
  hashFile,
  plannedRelPath,
  resolveStoreLayout,
  safeFileName,
  scanInputPaths,
  toAbsolutePath,
  toRelPath
} from '@core/storage'
import { AppError } from '@shared/errors'

const dir = mkdtempSync(join(tmpdir(), 'paut-storage-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
function sub(name = 'd'): string {
  const p = join(dir, `${name}-${++n}`)
  mkdirSync(p, { recursive: true })
  return p
}

const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex')

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (err) {
    return err instanceof AppError ? err.code : `not AppError: ${String(err)}`
  }
  return undefined
}

describe('저장 경로 규칙', () => {
  it('스캔플랜/<플랜ID>/<시편ID>/<파일명>', () => {
    expect(plannedRelPath('SP001', 'PL23833', '12T-SV-01-Cap on.nde')).toBe('스캔플랜/SP001/PL23833/12T-SV-01-Cap on.nde')
  })

  it('윈도우 금지문자·끝 공백/마침표·예약어 치환, 확장자 보존', () => {
    expect(plannedRelPath('SP001', 'A<B>:C', 'x?y*"z|.nde')).toBe('스캔플랜/SP001/A_B__C/x_y__z_.nde')
    expect(plannedRelPath('SP001', 'PL1. ', 'name. .nde  ')).toBe('스캔플랜/SP001/PL1/name.nde')
    expect(plannedRelPath('SP001', 'CON', 'con.nde')).toBe('스캔플랜/SP001/CON_/con_.nde')
    expect(plannedRelPath('SP001', 'com1.x', 'LPT9')).toBe('스캔플랜/SP001/com1_.x/LPT9_')
    expect(plannedRelPath('SP001', 'a/b\\c', '.hidden.nde')).toBe('스캔플랜/SP001/a_b_c/_.hidden.nde')
    expect(safeFileName(`${'가'.repeat(300)}.nde`)).toMatch(/^가{146}\.nde$/)
  })

  it('NFD 입력은 NFC 로', () => {
    const nfd = '시편-가'.normalize('NFD')
    const rel = plannedRelPath('SP001', nfd, `${'용접'.normalize('NFD')}.nde`)
    expect(rel).toBe('스캔플랜/SP001/시편-가/용접.nde')
    expect(rel).toBe(rel.normalize('NFC'))
  })

  it('잘못된 플랜 ID·빈 이름은 INVALID_ARGUMENT', async () => {
    expect(await codeOf(() => plannedRelPath('X1', 'a', 'b.nde'))).toBe('INVALID_ARGUMENT')
    expect(await codeOf(() => plannedRelPath('SP001', '...', 'b.nde'))).toBe('INVALID_ARGUMENT')
    expect(await codeOf(() => plannedRelPath('SP001', 'a', ' . '))).toBe('INVALID_ARGUMENT')
  })

  it('상대↔절대 변환과 저장소 밖 이탈 방지', async () => {
    const root = join(dir, 'root')
    expect(toAbsolutePath(root, '스캔플랜/SP001/a/b.nde')).toBe(join(root, '스캔플랜', 'SP001', 'a', 'b.nde'))
    expect(toRelPath(root, join(root, '스캔플랜', 'SP001', 'a', 'b.nde'))).toBe('스캔플랜/SP001/a/b.nde')
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', '', 'a//b'])
      expect(await codeOf(() => toAbsolutePath(root, bad)), bad).toBe('INVALID_ARGUMENT')
    expect(await codeOf(() => toRelPath(root, join(dir, 'other')))).toBe('INVALID_ARGUMENT')
  })

  it('저장소 레이아웃과 준비', async () => {
    const root = join(sub(), '새 저장소')
    const layout = await ensureStoreRoot(root)
    expect(layout).toEqual(resolveStoreLayout(root))
    expect(layout.catalogPath).toBe(join(root, 'catalog.db'))
    expect(statSync(layout.plansDir).isDirectory()).toBe(true)
    expect(readdirSync(root)).toEqual(['스캔플랜'])
    const file = join(sub(), 'file')
    writeFileSync(file, 'x')
    expect(await codeOf(ensureStoreRoot(file))).toBe('STORE_ROOT_INVALID')
    expect(await codeOf(() => resolveStoreLayout('  '))).toBe('NO_STORE_ROOT')
  })
})

describe('해시', () => {
  it('스트리밍 SHA-256 과 진행률', async () => {
    const p = join(sub(), 'abc.bin')
    writeFileSync(p, 'abc')
    const calls: [number, number][] = []
    expect(await hashFile(p, { onBytes: (d, t) => calls.push([d, t]) })).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(calls.at(-1)).toEqual([3, 3])
    const big = join(sub(), 'big.bin')
    const buf = Buffer.alloc(20 * 1024 * 1024 + 7, 7)
    writeFileSync(big, buf)
    const progress: number[] = []
    expect(await hashFile(big, { onBytes: (d) => progress.push(d) })).toBe(sha(buf))
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.at(-1)).toBe(buf.length)
    expect(await codeOf(hashFile(join(dir, 'none')))).toBe('NOT_FOUND')
  })

  it('취소 신호', async () => {
    const p = join(sub(), 'x.bin')
    writeFileSync(p, 'x')
    const ac = new AbortController()
    ac.abort()
    expect(await codeOf(hashFile(p, { signal: ac.signal }))).toBe('CANCELLED')
  })
})

describe('검증 복사', () => {
  function source(content: string, name = 'src.nde'): string {
    const p = join(sub('src'), name)
    writeFileSync(p, content)
    utimesSync(p, new Date('2024-09-03T01:00:00Z'), new Date('2024-09-03T01:32:26Z'))
    return p
  }

  it('복사 후 해시 일치, 원본 불변, 수정 시각 보존, partial 없음', async () => {
    const src = source('hello paut')
    const before = statSync(src)
    const destDir = join(sub('store'), '스캔플랜', 'SP001', 'PL1')
    const r = await copyVerified(src, join(destDir, 'src.nde'), sha('hello paut'))
    expect(r).toEqual({ destPath: join(destDir, 'src.nde'), sha256: sha('hello paut'), sizeBytes: 10, reusedExisting: false })
    expect(readFileSync(r.destPath, 'utf8')).toBe('hello paut')
    expect(statSync(r.destPath).mtimeMs).toBe(before.mtimeMs)
    expect(statSync(src).mtimeMs).toBe(before.mtimeMs)
    expect(readFileSync(src, 'utf8')).toBe('hello paut')
    expect(readdirSync(destDir)).toEqual(['src.nde'])
  })

  it('같은 이름 다른 내용이면 " (2)", 같은 내용 잔여물이면 재사용', async () => {
    const destDir = sub('store')
    writeFileSync(join(destDir, 'a.nde'), 'old')
    const r2 = await copyVerified(source('new'), join(destDir, 'a.nde'), sha('new'))
    expect(r2.destPath).toBe(join(destDir, 'a (2).nde'))
    const r3 = await copyVerified(source('newer'), join(destDir, 'a.nde'), sha('newer'))
    expect(r3.destPath).toBe(join(destDir, 'a (3).nde'))
    const again = await copyVerified(source('new'), join(destDir, 'a.nde'), sha('new'))
    expect(again).toMatchObject({ destPath: join(destDir, 'a (2).nde'), reusedExisting: true })
    expect(readFileSync(join(destDir, 'a.nde'), 'utf8')).toBe('old')
    expect(readdirSync(destDir).sort()).toEqual(['a (2).nde', 'a (3).nde', 'a.nde'])
  })

  it('해시가 다르면 HASH_MISMATCH, 임시 파일·대상 파일을 남기지 않음', async () => {
    const destDir = sub('store')
    const src = source('content')
    expect(await codeOf(copyVerified(src, join(destDir, 'x.nde'), sha('other')))).toBe('HASH_MISMATCH')
    expect(readdirSync(destDir)).toEqual([])
    expect(readFileSync(src, 'utf8')).toBe('content')
  })

  it('없는 원본은 NOT_FOUND, 취소는 CANCELLED (임시 파일 없음)', async () => {
    const destDir = sub('store')
    expect(await codeOf(copyVerified(join(dir, 'none.nde'), join(destDir, 'x.nde'), sha('')))).toBe('NOT_FOUND')
    const ac = new AbortController()
    ac.abort()
    expect(await codeOf(copyVerified(source('c'), join(destDir, 'x.nde'), sha('c'), { signal: ac.signal }))).toBe('CANCELLED')
    expect(readdirSync(destDir)).toEqual([])
  })

  it('NFD 이름의 원본도 NFC 이름으로 저장', async () => {
    const nfdName = '용접-캡.nde'.normalize('NFD')
    const src = source('nfd', nfdName)
    const destDir = sub('store')
    const r = await copyVerified(src, join(destDir, nfdName), sha('nfd'))
    expect(r.destPath).toBe(join(destDir, '용접-캡.nde'.normalize('NFC')))
    expect(existsSync(r.destPath)).toBe(true)
  })

  it('복사·검증 진행률', async () => {
    const buf = Buffer.alloc(9 * 1024 * 1024, 1)
    const src = join(sub('src'), 'big.nde')
    writeFileSync(src, buf)
    const copied: number[] = []
    const verified: number[] = []
    await copyVerified(src, join(sub('store'), 'big.nde'), sha(buf), {
      onBytes: (d) => copied.push(d),
      onVerifyBytes: (d) => verified.push(d)
    })
    expect(copied.at(-1)).toBe(buf.length)
    expect(verified.at(-1)).toBe(buf.length)
  })
})

describe('입력 경로 탐색', () => {
  it('숨김 폴더·파일 건너뜀, 심볼릭 링크 미추적, 중복 제거, 정렬, NFC 파일명', async () => {
    const root = sub('in')
    const files: Record<string, string> = {
      'b.nde': 'b',
      'a/c.nde': 'c',
      'a/memo.txt': 't',
      [`${'한글'.normalize('NFD')}.nde`]: 'k',
      '.claude/x.nde': 'h',
      '.git/y.nde': 'h',
      '.cc-writes/z.nde': 'h',
      'a/.hidden.nde': 'h',
      'Thumbs.db': 'h',
      'desktop.ini': 'h',
      '$RECYCLE.BIN/r.nde': 'h'
    }
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), body)
    }
    symlinkSync(join(root, 'b.nde'), join(root, 'link.nde'))
    symlinkSync(join(root, 'a'), join(root, 'linkdir'))
    const r = await scanInputPaths([root, join(root, 'a'), join(root, 'b.nde')])
    expect(r.files.map((f) => f.path.slice(root.length + 1).normalize('NFC'))).toEqual(['a/c.nde', 'a/memo.txt', 'b.nde', '한글.nde'])
    expect(r.files.find((f) => f.ext === '.txt')?.fileName).toBe('memo.txt')
    expect(r.files.at(-1)?.fileName).toBe('한글.nde'.normalize('NFC'))
    expect(r.files[0]).toMatchObject({ ext: '.nde', sizeBytes: 1 })
    expect(r.skippedHiddenCount).toBe(7)
    expect(r.skippedLinkCount).toBe(2)
    expect(r.unreadablePaths).toEqual([])
  })

  it('없는 경로는 NOT_FOUND', async () => {
    expect(await codeOf(scanInputPaths([join(dir, 'nope')]))).toBe('NOT_FOUND')
  })
})
