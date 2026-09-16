import test from 'node:test';import assert from 'node:assert/strict';import {transferRule,ruleStatus} from './platform-rules.mjs';import {validatePlatform} from './platform-admin.mjs';
const layout={stationKey:'test',name:'Test',groups:[{tracks:['4','5'],kind:'opposite',minutes:'',pockets:['5']},{tracks:['A','B'],kind:'same',minutes:''}]};
test('sections, letter tracks, specific times and status boundaries',()=>{for(const [a,b,n]of [['5A','4',1],['5A','4A',1],['5A','4B',2],['5 A-C','4 C-E',1],['A','B',2]])assert.equal(transferRule(a,b,layout).minimum,n);const r=transferRule('5A','4B',layout);assert.equal(ruleStatus(2,r),'feasible');assert.equal(ruleStatus(1,r),'uncertain');assert.equal(ruleStatus(0,r),'missed');assert.equal(transferRule('?','4',layout).relation,'unknown');const custom=structuredClone(layout);custom.groups[0].minutes=8;assert.equal(transferRule('5A','4A',custom).minimum,8);assert.equal(transferRule('5','4',{platformGroups:[['4','5']]}).minimum,1)});
test('validates data and rejects duplicate tracks, executable links and invalid uploads',()=>{assert.equal(validatePlatform(layout).groups[0].pockets[0],'5');for(const patch of [{map:'javascript:alert(1)'},{photo:'data:image/svg+xml,abc'},{groups:[...layout.groups,layout.groups[0]]},{groups:[{...layout.groups[0],minutes:-1}]}])assert.throws(()=>validatePlatform({...layout,...patch}));});
test('track notes persist, match sections and never change transfer times',()=>{
 const edited=validatePlatform({...layout,trackNotes:[{track:'5',text:'Via spoor 4'},{track:'A',text:'Ondergronds'}]});
 assert.equal(edited.trackNotes.length,2);
 for(const track of ['5','5A','5 A-C','Spoor 5B'])assert.equal(transferRule(track,'4B',edited).fromNote,'Via spoor 4');
 assert.equal(transferRule('50','4',edited).fromNote,'');
 assert.equal(transferRule('A','B',edited).fromNote,'Ondergronds');
 assert.equal(transferRule('5A','4B',edited).minimum,transferRule('5A','4B',layout).minimum);
 assert.deepEqual(validatePlatform(layout).trackNotes,[]);
 for(const trackNotes of [[{track:'5',text:'x'},{track:'5',text:'y'}],[{track:'',text:'x'}],[{track:'A',text:'x'.repeat(2001)}]])assert.throws(()=>validatePlatform({...layout,trackNotes}));
});
