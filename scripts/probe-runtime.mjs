// 런타임 점검: h5wasm/node 로 NDE 셋업 읽기 + node:sqlite. 사용: node scripts/probe-runtime.mjs [nde경로]
// Electron 내장 Node 점검: ELECTRON_RUN_AS_NODE=1 npx electron scripts/probe-runtime.mjs [nde경로]
import h5wasm from "h5wasm/node";
import { DatabaseSync } from "node:sqlite";

const p = process.argv[2] ?? "../../06_원시데이터/02_라벨완료/X3_12T-SV/12T-SV-01-Cap on.nde";
await h5wasm.ready;
const t0 = performance.now();
const f = new h5wasm.File(p, "r");
const keys = f.keys();
const setupPath = keys.includes("Domain") ? "Domain/Setup" : "Public/Setup";
const setup = JSON.parse(f.get(setupPath).value);
const ms = Math.round(performance.now() - t0);
f.close();
const db = new DatabaseSync(":memory:");
const sqlite = db.prepare("select sqlite_version() v").get().v;
db.close();
console.log(JSON.stringify({
  runtime: process.versions.electron ? `electron ${process.versions.electron}` : "node",
  node: process.versions.node,
  navigator: typeof globalThis.navigator,
  keys, setupVersion: setup.version, groups: (setup.groups ?? []).map((g) => g.name), ms, sqlite,
}));
