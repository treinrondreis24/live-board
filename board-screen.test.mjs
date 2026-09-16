import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8');
const functionSource=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('international board hides trains over three hours away unless at least ten minutes late',()=>{
 const context=vm.createContext({});
 vm.runInContext(functionSource('function withinTrainWindow','function shortStation'),context);
 const now=Date.now(),visible=train=>vm.runInContext(`withinTrainWindow(${JSON.stringify(train)},${now})`,context);
 assert.equal(visible({plannedTimestamp:now+3*3600000}),true);
 assert.equal(visible({plannedTimestamp:now+3*3600000+1,delay:9}),false);
 assert.equal(visible({plannedTimestamp:now+3*3600000+1,delay:10}),true);
 assert.equal(visible({plannedTimestamp:now+3*3600000+1,cancelled:true}),true);
});

test('four or more connections double the connection screen time',()=>{
 const durations=[];
 const context=vm.createContext({
  CONFIG:{connectionScreenMs:10000},connectionCount:3,activeIndex:0,
  screens:Array.from({length:3},()=>({classList:{toggle(){}}})),
  clearScreenTimers(){},setTimeout(_callback,duration){durations.push(duration);return 1;}
 });
 vm.runInContext(functionSource('function enterScreen(index)','window.addEventListener(\'message\''),context);
 vm.runInContext('enterScreen(2)',context);
 vm.runInContext('connectionCount=4;enterScreen(2)',context);
 assert.deepEqual(durations,[10000,20000]);
});
