import {scrypt,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {kkGet,kkPut,kkInsert,kkPatchParticipant} from './kk-store.mjs';
const derive=promisify(scrypt),hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
let active=0;
async function passwordHash(password,salt){
 if(typeof password!=='string'||password.length<12||password.length>128)fail('Gebruik een wachtwoord van 12 tot 128 tekens.');
 if(active>=2)fail('Inloggen is even druk. Probeer zo opnieuw.',503);
 active++;try{return await derive(password,salt,64);}finally{active--;}
}
export async function registerPassword(email,data){
 const salt=randomBytes(16).toString('hex'),key=await passwordHash(data.password,salt),id=hash(email);
 const fullName=String(data.fullName||'').trim(),displayName=String(data.displayName||'').trim();
 if(!fullName||fullName.length>200||!displayName||displayName.length>80)fail('Vul je naam en weergavenaam in.');
 const user={id,email,fullName,displayName,createdAt:Date.now(),competition:'2026',manualRegistration:true,approval:'pending'};
 if(!await kkInsert('participant',id,id,user))fail('Aanmelden niet mogelijk. Log in met je bestaande account of neem contact op met de organisatie.',409);
 await kkPut('password',id,id,{salt,key:key.toString('hex')});return user;
}
export async function loginPassword(email,password){
 const id=hash(email),credential=await kkGet('password',id);
 const actual=await passwordHash(password,credential?.value.salt||'00000000000000000000000000000000');
 if(!credential||!timingSafeEqual(actual,Buffer.from(credential.value.key,'hex')))fail('E-mailadres of wachtwoord klopt niet.',401);
 return (await kkGet('participant',id)).value;
}
export function canUseProof(user){return !!user&&(user.approval==='approved'||(!user.manualRegistration&&!user.approval));}
export async function setApproval(id,approved){const row=await kkGet('participant',id);if(!row)fail('Deze aanmelding bestaat niet.',404);await kkPatchParticipant(id,{approval:approved?'approved':'pending',approvalChangedAt:Date.now()});}
