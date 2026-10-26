/**
 * 맥 앱 만들기 (arm64, 서명 없는 사내용). `npm run dist:mac` 이 electron-vite build 뒤에 부른다.
 *  1) electron-builder --mac dir: 설치된 node_modules/electron/dist 를 그대로 써서 내려받기 없이 포장
 *     (productName 은 번들 안 이름을 위해 영문으로 덮어씀 — electron-builder.yml 의 설명 참고)
 *  2) ad-hoc 서명 (Apple Silicon 은 서명이 없으면 실행이 안 됨; Developer ID 가 없으므로 '-')
 *  3) .app 이름을 한글(NFC) 'PAUT 데이터 관리.app' 으로
 */
const { execFileSync } = require('node:child_process')
const { existsSync, renameSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const outDir = join(root, 'dist', 'mac-arm64')
const builtName = 'PAUT-DataManager'
const finalName = 'PAUT 데이터 관리'.normalize('NFC')
const builtApp = join(outDir, `${builtName}.app`)
const finalApp = join(outDir, `${finalName}.app`)

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })

rmSync(builtApp, { recursive: true, force: true })
rmSync(finalApp, { recursive: true, force: true })
run(join(root, 'node_modules', '.bin', 'electron-builder'), ['--mac', 'dir', '--arm64', '-c.electronDist=node_modules/electron/dist', `-c.productName=${builtName}`])
if (!existsSync(builtApp)) throw new Error(`빌드 결과가 없습니다: ${builtApp}`)
run('codesign', ['--force', '--deep', '--sign', '-', builtApp])
run('codesign', ['--verify', '--deep', '--strict', builtApp])
renameSync(builtApp, finalApp)
console.log(`\n완료: ${finalApp}\n설치: /Applications 로 복사 (예: ditto "${finalApp}" "/Applications/${finalName}.app")`)
