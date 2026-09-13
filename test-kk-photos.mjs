import assert from 'node:assert/strict';
import sharp from 'sharp';
import {inspectPhoto} from './kk-submissions.mjs';
for(const [format,mime] of [['jpeg','image/jpeg'],['png','image/png'],['webp','image/webp'],['avif','image/avif']]){
 const bytes=await sharp({create:{width:32,height:32,channels:3,background:'red'}}).toFormat(format).toBuffer();
 assert.equal(await inspectPhoto(bytes),mime);
}
await assert.rejects(inspectPhoto(Buffer.from('not a photograph')));
const gif=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).gif().toBuffer();await assert.rejects(inspectPhoto(gif),/niet ondersteund/);
console.log('PASS: JPEG PNG WebP AVIF decoded; corrupt and unsupported images rejected');
