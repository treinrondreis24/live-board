import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {initKKStore,kkPut,kkScorecardProofs} from './kk-store.mjs';
import {buildScorecard,personalScorecard,scorecardOptions} from './kk-scorecard.mjs';
import {calculateHilta} from './kk-hilta.mjs';
const user={id:'a',approval:'approved',fullName:'Test <&> deelnemer',edition:24};
const mk=(id,from,to,prev,station=to)=>({id,created:1789855200000+Number(id)*60000,proof:{kind:'proof',station},route:{...calculateHilta(from,to),status:'participant-confirmed',confirmedBy:'a',previousProofId:prev}});
const rows=[mk('1','Meppel','Zwolle',null),mk('2','Zwolle','Meppel','1'),mk('3','Meppel','Zwolle','2'),mk('4','Rotterdam Centraal','Rotterdam Centraal','3'),mk('5','Meppel','Zwolle','4'),mk('6','Zwolle','Meppel','5'),mk('7','Meppel','Zwolle','6')];
function inspect(b){const z=unzipSync(b),xml=strFromU8(z['xl/worksheets/sheet1.xml']);new XMLParser().parse(xml);const get=ref=>Number(xml.match(new RegExp('<x:c[^>]*r="'+ref+'"[^>]*>[\\s\\S]*?<x:v>([^<]*)'))?.[1]);return {xml,get,note:strFromU8(z['xl/worksheets/sheet2.xml'])};}
let result=inspect(buildScorecard(user,rows,'4'));assert.equal(result.get('D20'),2);assert.equal(result.get('E20'),2);assert.equal(result.get('G20'),110.8);assert.equal(result.get('E3'),110.8);assert.match(result.xml,/Test &lt;&amp;&gt; deelnemer/);assert.match(result.note,/Maximum toegepast/);assert.match(result.xml,/D20:E20 D122:E122/);
result=inspect(buildScorecard(user,rows,'not-yet'));assert.equal(result.get('D20'),2);assert.equal(result.get('E20'),0);assert.equal(result.get('E3'),55.4);
assert.throws(()=>buildScorecard(user,rows,'someone-else'),/Selecteer/);
for(const [from,to,row,expected] of [['Roermond','Sittard',122,97.6],['Leeuwarden','Harlingen Haven',8,52.8]]){
 const sample=[mk('1',from,to,null),mk('2',to,from,'1'),mk('3','Rotterdam Centraal','Rotterdam Centraal','2'),mk('4',from,to,'3'),mk('5',to,from,'4')];
 const checked=inspect(buildScorecard(user,sample,'3'));assert.equal(checked.get('G'+row),expected);assert.equal(checked.get('E3'),expected);
}
rows[0].route.status='proposed';rows[1].route.confirmedBy='b';rows[2].route.sourceHash='obsolete';rows[4].route.previousProofId='removed-proof';result=inspect(buildScorecard(user,rows,'4'));assert.match(result.note,/4 niet meegetelde delen/);
const db=new DatabaseSync(':memory:');await initKKStore({sqlite:db});try{for(let i=0;i<205;i++)await kkPut('submission','proof'+i,'a',{kind:'proof',station:'Almelo'});await kkPut('submission','private','b',{kind:'proof',station:'Rotterdam Centraal'});assert.equal((await kkScorecardProofs('a')).length,205);assert.equal((await scorecardOptions(user)).checkpoints.length,0);await assert.rejects(personalScorecard({...user,approval:'pending',manualRegistration:true},'not-yet'),/goedgekeurd/);assert.throws(()=>buildScorecard(user,[], 'private'),/Selecteer/);}finally{db.close();}
console.log('PASS personal XLSX: before/after caps, cached totals, escaped identity, pending/stale exclusion, private data and >200 proofs');
