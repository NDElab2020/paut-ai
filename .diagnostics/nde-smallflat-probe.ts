import { readNdeFile } from '../src/core/nde'
import { readViewerInfo, readViewerChunk } from '../src/core/nde/viewer'
import { createAppService } from '../src/core/service'
import { toApiError } from '../src/shared/errors'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const file='/Users/eu/Downloads/small flat Al R_0002.nde'
const out:Record<string,unknown>={file}
try { const r=await readNdeFile(file); out.read={meta:r.meta,spec:r.setup.spec,summary:r.setup.summary,warnings:r.setup.warnings} } catch(e) {out.readError=toApiError(e)}
try { const r=await readViewerInfo(file); out.viewer=r; const g=r.groups.find(g=>g.supported); if(g){const c=await readViewerChunk(file,g,0,1);out.chunk={shape:g.shape,amplitudeType:c.amplitude.constructor.name,length:c.amplitude.length}} } catch(e) {out.viewerError=toApiError(e)}
const work=mkdtempSync(join(tmpdir(),'paut-flatAl-probe-'))
const service=createAppService({settingsPath:join(work,'settings.json')})
try {await service.setStoreRoot(join(work,'store')); const p=await service.analyze([file]); out.import={counts:p.counts,items:p.items,newPlans:p.newPlans}}catch(e){out.importError=toApiError(e)}finally{service.close();rmSync(work,{recursive:true,force:true})}
console.log(JSON.stringify(out,null,2))
