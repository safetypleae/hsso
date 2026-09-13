import {json,errorResponse} from './auth-session.js';
import {authenticate} from './documents.js';
import {requireAdmin} from './admin-auth.js';

export const MAX_INQUIRY_BODY_BYTES=65536;
const UUID=/^[a-f0-9-]{36}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max,required=false)=>typeof value==='string'&&Array.from(value).length<=max&&(!required||value.trim().length>0);
function guard(request,methods,protectedMethods=[]){if(!methods.includes(request.method))return json({ok:false,error:'METHOD_NOT_ALLOWED'},405,{Allow:methods.join(', ')});const origin=request.headers.get('Origin');if(protectedMethods.includes(request.method)&&origin!==null&&origin!==new URL(request.url).origin)return errorResponse('ORIGIN_NOT_ALLOWED',403);}
async function body(request){if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new Error('INVALID_CONTENT_TYPE');const reader=request.body?.getReader();if(!reader)throw new Error('INVALID_JSON');const chunks=[];let size=0;for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_INQUIRY_BODY_BYTES){await reader.cancel();throw new Error('PAYLOAD_TOO_LARGE');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('INVALID_JSON');}}
function bodyError(error){return errorResponse(error.message==='PAYLOAD_TOO_LARGE'?'PAYLOAD_TOO_LARGE':error.message==='INVALID_CONTENT_TYPE'?'INVALID_CONTENT_TYPE':'INVALID_JSON',error.message==='PAYLOAD_TOO_LARGE'?413:400);}
const SELECT='SELECT id,title,content,status,created_at AS createdAt,updated_at AS updatedAt FROM inquiry_posts';
export async function inquiryCollection({request,env}){const rejected=guard(request,['GET','POST'],['POST']);if(rejected)return rejected;try{const owner=await authenticate(request,env);if(!owner)return errorResponse('UNAUTHENTICATED',401);if(request.method==='POST'){let input;try{input=await body(request);}catch(error){return bodyError(error);}if(!object(input)||!text(input.title,200,true)||!text(input.content,10000,true))return errorResponse('INVALID_INQUIRY',400);const id=crypto.randomUUID(),now=new Date().toISOString(),result=await env.DB.prepare("INSERT INTO inquiry_posts (id,author_user_id,title,content,status,created_at,updated_at) VALUES (?,?,?,?,'waiting',?,?)").bind(id,owner,input.title.trim(),input.content.trim(),now,now).run();if(!result.success||result.meta?.changes!==1)throw new Error('insert');return json({ok:true,inquiry:{id,title:input.title.trim(),status:'waiting',createdAt:now,updatedAt:now}},201);}const params=new URL(request.url).searchParams,rawLimit=params.get('limit')||'20',rawOffset=params.get('offset')||'0';if(!/^\d+$/.test(rawLimit)||!/^\d+$/.test(rawOffset)||Number(rawLimit)<1||!Number.isSafeInteger(Number(rawOffset)))return errorResponse('INVALID_FILTER',400);const limit=Math.min(Number(rawLimit),50),offset=Number(rawOffset),rows=await env.DB.prepare('SELECT id,title,status,created_at AS createdAt,updated_at AS updatedAt FROM inquiry_posts WHERE author_user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(owner,limit+1,offset).all(),total=await env.DB.prepare('SELECT COUNT(*) AS count FROM inquiry_posts WHERE author_user_id=?').bind(owner).first();return json({ok:true,inquiries:rows.results.slice(0,limit),hasMore:rows.results.length>limit,total:Number(total.count),limit,offset});}catch{return errorResponse('INTERNAL_SERVER_ERROR',500);}}
export async function inquiryItem({request,env,params}) {
  const rejected=guard(request,['GET']);if(rejected)return rejected;
  try {
    const owner=await authenticate(request,env);if(!owner)return errorResponse('UNAUTHENTICATED',401);
    if(!UUID.test(params.id||''))return errorResponse('NOT_FOUND',404);
    const row=await env.DB.prepare(`${SELECT} WHERE id=? AND author_user_id=?`).bind(params.id,owner).first();
    if (!row) return errorResponse('NOT_FOUND',404);
    return json({ok:true,inquiry:{...row,answer:await readAnswer(env, row.id)}});
  } catch {return errorResponse('INTERNAL_SERVER_ERROR',500);}
}

async function readAnswer(env, inquiryId) {
  return env.DB.prepare('SELECT id,content,created_at AS createdAt,updated_at AS updatedAt FROM inquiry_answers WHERE inquiry_id=?').bind(inquiryId).first();
}

export async function adminInquiryCollection({request,env}) {
  const rejected=guard(request,['GET']);if(rejected)return rejected;
  const access=await requireAdmin(request,env);if(access.response)return access.response;
  try {
    const params=new URL(request.url).searchParams;
    const status=params.get('status')||'',rawLimit=params.get('limit')||'20',rawOffset=params.get('offset')||'0';
    if(!['','waiting','answered'].includes(status)||!/^\d+$/.test(rawLimit)||!/^\d+$/.test(rawOffset)||!Number.isSafeInteger(Number(rawLimit))||Number(rawLimit)<1||!Number.isSafeInteger(Number(rawOffset)))return errorResponse('INVALID_FILTER',400);
    const limit=Math.min(Number(rawLimit),50),offset=Number(rawOffset);
    const rows=await env.DB.prepare("SELECT p.id,p.title,p.status,p.created_at AS createdAt,p.updated_at AS updatedAt,u.name AS authorName FROM inquiry_posts p INNER JOIN users u ON u.id=p.author_user_id WHERE (?='' OR p.status=?) ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?").bind(status,status,limit+1,offset).all();
    const total=await env.DB.prepare("SELECT COUNT(*) AS count FROM inquiry_posts WHERE (?='' OR status=?)").bind(status,status).first();
    return json({ok:true,inquiries:rows.results.slice(0,limit),hasMore:rows.results.length>limit,total:Number(total.count),limit,offset});
  } catch {return errorResponse('INTERNAL_SERVER_ERROR',500);}
}

export async function adminInquiryItem({request,env,params}) {
  const rejected=guard(request,['GET']);if(rejected)return rejected;
  const access=await requireAdmin(request,env);if(access.response)return access.response;
  try {
    if(!UUID.test(params.id||''))return errorResponse('NOT_FOUND',404);
    const row=await env.DB.prepare('SELECT p.id,p.title,p.content,p.status,p.created_at AS createdAt,p.updated_at AS updatedAt,u.name AS authorName FROM inquiry_posts p INNER JOIN users u ON u.id=p.author_user_id WHERE p.id=?').bind(params.id).first();
    if(!row)return errorResponse('NOT_FOUND',404);
    return json({ok:true,inquiry:{...row,answer:await readAnswer(env,row.id)}});
  } catch {return errorResponse('INTERNAL_SERVER_ERROR',500);}
}

export async function adminInquiryAnswer({request,env,params}) {
  const rejected=guard(request,['PUT'],['PUT']);if(rejected)return rejected;
  const access=await requireAdmin(request,env);if(access.response)return access.response;
  try {
    if(!UUID.test(params.id||''))return errorResponse('NOT_FOUND',404);
    let input;try{input=await body(request);}catch(error){return bodyError(error);}
    if(!object(input)||!text(input.content,10000,true))return errorResponse('INVALID_ANSWER',400);
    const inquiry=await env.DB.prepare('SELECT id FROM inquiry_posts WHERE id=?').bind(params.id).first();
    if(!inquiry)return errorResponse('NOT_FOUND',404);
    const now=new Date().toISOString();
    // D1 batch is transactional: an answer and its status must commit together.
    const results=await env.DB.batch([
      env.DB.prepare('INSERT INTO inquiry_answers (id,inquiry_id,admin_user_id,content,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(inquiry_id) DO UPDATE SET admin_user_id=excluded.admin_user_id,content=excluded.content,updated_at=excluded.updated_at').bind(crypto.randomUUID(),params.id,access.userId,input.content.trim(),now,now),
      env.DB.prepare("UPDATE inquiry_posts SET status='answered',updated_at=? WHERE id=?").bind(now,params.id)
    ]);
    if(results.some(result=>!result.success||result.meta?.changes!==1))throw new Error('answer');
    return json({ok:true,answer:await readAnswer(env,params.id)});
  } catch {return errorResponse('INTERNAL_SERVER_ERROR',500);}
}
