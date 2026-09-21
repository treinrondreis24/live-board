import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2]||'all';
if(!['all','syntax','unit','browser'].includes(mode))throw Error('Unknown check group: '+mode);
const omitted=new Set(['.git','node_modules','outputs','.npm-cache']);
function scan(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{if(e.name.startsWith('.')||omitted.has(e.name))return [];const path=resolve(dir,e.name);return e.isDirectory()?scan(path):/\.(?:mjs|js|cjs)$/.test(e.name)?[relative(root,path)]:[];});}
const source=scan(root).sort();
const tests=source.filter(f=>!f.includes('/')&&!f.includes('\\')&&(/^(test-.*|test)\.mjs$/.test(f)||f.endsWith('.test.mjs')));
const browser=tests.filter(f=>f.endsWith('-browser.mjs'));
const unit=tests.filter(f=>!browser.includes(f));
const failed=[];let passed=0;
function run(label,args,timeout){const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:8*1024*1024,env:{...process.env,NODE_ENV:'test',PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH||resolve(root,'.playwright-browsers')}});if(r.error||r.status!==0){failed.push(label);console.error('FAIL '+label+'\n'+(r.error?.message||'')+'\n'+(r.stdout||'')+(r.stderr||''));}else{passed++;console.log('PASS '+label);}}
if(mode==='all'||mode==='syntax')for(const f of source)run('syntax '+f,['--check',f],30000);
if(mode==='all'||mode==='unit')for(const f of unit)run(f,['--experimental-test-module-mocks',f],90000);
if(mode==='all'||mode==='browser')for(const f of browser)run(f,[f],120000);
console.log(`\n${passed} passed; ${failed.length} failed. Group: ${mode}.`);
if(failed.length){console.error(failed.join('\n'));process.exitCode=1;}
