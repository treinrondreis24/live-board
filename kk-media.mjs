// Private Railway S3 storage adapter. Only call after authorization in a handler.
// Upload URLs deliberately not exposed: completed, validated files are streamed
// from the upload handler, so an expired/unvalidated upload cannot be published.
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
let client;
const names=['KK_S3_BUCKET','KK_S3_ENDPOINT','KK_S3_ACCESS_KEY_ID','KK_S3_SECRET_ACCESS_KEY'];
export function mediaReady(env=process.env){return names.every(k=>!!env[k]);}
export function mediaConfig(env=process.env){
 if(!mediaReady(env))throw Error('Mediaopslag is nog niet aangesloten.');
 const endpoint=new URL(env.KK_S3_ENDPOINT);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('Mediaopslag vereist een HTTPS-endpoint.');
 return {bucket:env.KK_S3_BUCKET,config:{endpoint:endpoint.href,region:env.KK_S3_REGION||'auto',forcePathStyle:env.KK_S3_PATH_STYLE==='true',credentials:{accessKeyId:env.KK_S3_ACCESS_KEY_ID,secretAccessKey:env.KK_S3_SECRET_ACCESS_KEY}}};
}
function connection(){const c=mediaConfig();client??=new S3Client(c.config);return {client,bucket:c.bucket};}
export function mediaKey(owner,id){if(!/^[a-f0-9]{64}$/.test(owner)||! /^[a-f0-9-]{36}$/.test(id))throw Error('Ongeldige mediaverwijzing.');return `kk/2026/${owner}/${id}`;}
export function validateMediaDeclaration({type,size}){
 const image=['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif'].includes(type);
 const video=['video/mp4','video/quicktime','video/webm'].includes(type);
 if(!image&&!video)throw Error('Gebruik een ondersteund foto- of videobestand.');
 const limit=image?15_000_000:100_000_000;
 if(!Number.isSafeInteger(size)||size<1||size>limit)throw Error(image?'Een foto mag maximaal 15 MB zijn.':'Een video mag maximaal 100 MB zijn.');
 return {kind:image?'image':'video',limit};
}
// Caller must first check actual file signature, video duration and owner quota.
export async function putValidatedMedia({owner,id,type,size,stream}){
 validateMediaDeclaration({type,size});const {client,bucket}=connection();
 await client.send(new PutObjectCommand({Bucket:bucket,Key:mediaKey(owner,id),Body:stream,ContentType:type,ContentLength:size,CacheControl:'private, no-store'}),{abortSignal:AbortSignal.timeout(120000)});
}
export async function inspectStoredMedia(owner,id){const {client,bucket}=connection();return client.send(new HeadObjectCommand({Bucket:bucket,Key:mediaKey(owner,id)}),{abortSignal:AbortSignal.timeout(10000)});}
// No public bucket; handlers grant short-lived links only to authorized viewers.
export async function authorizedMediaUrl(owner,id){const {client,bucket}=connection();return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:mediaKey(owner,id),ResponseCacheControl:'private, no-store'}),{expiresIn:120});}

export async function storedMediaStream(owner,id){const {client,bucket}=connection();const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:mediaKey(owner,id)}),{abortSignal:AbortSignal.timeout(30000)});return result.Body;}

export async function deleteStoredMedia(owner,id){const {client,bucket}=connection();await client.send(new DeleteObjectCommand({Bucket:bucket,Key:mediaKey(owner,id)}),{abortSignal:AbortSignal.timeout(30000)});}
