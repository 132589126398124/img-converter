// Optional local benchmark; opt-in public camera fixture or synthetic stress input.
import Vips from 'wasm-vips';
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const baseline = process.argv.includes('--baseline');
const stress = process.argv.includes('--stress');
const size = process.argv.includes('--size');
const runs = Number(process.argv.find(a => a.startsWith('--runs='))?.split('=')[1] || 3);
if (baseline) {
  mkdirSync('tests/fixtures/generated', { recursive: true });
  const source = execFileSync('git', ['show', '0b40f2b:src/engine/core.js'], { encoding: 'utf8' });
  writeFileSync('tests/fixtures/generated/core-baseline.mjs', source.replaceAll("'./", "'../../../src/engine/"));
}
const { createEngine } = await import(baseline
  ? '../tests/fixtures/generated/core-baseline.mjs' : '../src/engine/core.js');
const input = stress
  ? await sharp({create:{width:12000,height:8000,channels:3,background:'#5389a3'}})
    .jpeg({quality:95,progressive:true,chromaSubsampling:'4:4:4'}).toBuffer()
  : readFileSync('tests/fixtures/external/r6-iii-raw.CR3');
console.log('input ready', input.length);
const v = await Vips({dynamicLibraries:['vips-heif.wasm']});
console.log('engine ready');
const engine = createEngine(v, {adobePath:'public/profiles/AdobeCompat-v2.icc'});
try {
  for(let n=0;n<runs;n++) {
    global.gc?.();
    const start=performance.now();
    try {
      const result=await engine.run(input,stress?'stress.jpg':'r6-iii-raw.CR3',{
        quality:95,longEdge:0,...(size?{purpose:'size',maxBytes:3*1048576}:{})
      });
      console.log(JSON.stringify({baseline,stress,size,run:n,ms:Math.round(performance.now()-start),
        bytes:result.artifacts[0].blob.size,quality:result.artifacts[0].quality,width:result.artifacts[0].width,
        trackedMiB:v.Stats.mem()/1048576,peakTrackedMiB:v.Stats.memHighwater()/1048576,
        rssMiB:Math.round(process.memoryUsage().rss/1048576),peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024)}));
    } catch(error) { console.log('FAIL',String(error));process.exitCode=1;break; }
  }
} finally {v.PThread?.terminateAllThreads?.();}
