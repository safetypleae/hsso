import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';
import { validateCasRegistryNumber } from '../assets/msds-composition-parser.js';
import { evaluateRegulatory } from './regulatory-master-v1.js';
import { chemicalWorkbook, XLSX_MIME } from './chemical-xlsx.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clean = value => value.trim().replace(/\s+/gu, ' ');
const key = value => clean(value).normalize('NFKC').toLocaleLowerCase('ko-KR');
const text = (value, max, required = false) => typeof value === 'string' && value.trim().length <= max && (!required || Boolean(value.trim()));
const quantity = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9);
const date = () => new Date().toISOString();
export const MAX_MSDS_BYTES = 20 * 1024 * 1024;
const PDF_TYPE = 'application/pdf';
const CAS_STATUSES = new Set(['KNOWN','ABSENT','TRADE_SECRET']);
const REVIEW_STATUSES = new Set(['AUTO_EXTRACTED','REVIEWED','MANUALLY_ADDED']);
const SOURCE_TYPES = new Set(['AUTO','MANUAL']);
const PARSER_CONFIDENCES = new Set(['high','medium','low']);
const PARSER_STATUSES = new Set(['SUCCESS','PARTIAL','UNRESOLVED','NO_COMPOSITION_SECTION','VARIANT_TABLE']);
const BLOCKED_AUTO_STATUSES = new Set(['UNRESOLVED','NO_COMPOSITION_SECTION','VARIANT_TABLE']);
const ingredientFields = `i.id,i.chemical_name AS chemicalName,i.synonym,i.cas_value AS casValue,i.cas_status AS casStatus,
 i.amount_raw AS amountRaw,i.trade_secret AS tradeSecret,i.parser_confidence AS parserConfidence,i.review_status AS reviewStatus,
 i.source_type AS sourceType,i.sort_order AS sortOrder,i.reviewed_by_user_id AS reviewedByUserId,i.reviewed_at AS reviewedAt,
 i.created_at AS createdAt,i.updated_at AS updatedAt`;

function guard(request, methods) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  if (!['GET','HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  }
  return null;
}
async function input(request,maxBytes=16384) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  return JSON.parse(raw);
}
const inputError = error => errorResponse(error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
const failure = error => {
  const migrationMissing = /no such (?:table|column)/i.test(String(error));
  return errorResponse(migrationMissing ? 'MIGRATION_REQUIRED' : 'INTERNAL_SERVER_ERROR', migrationMissing ? 503 : 500);
};
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
const isoDate = value => { if(value==='')return true;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value; };
const safeFilename = value => value.replace(/[\r\n\0]/g,'').slice(0,255);
const nullableClean = value => typeof value === 'string' && value.trim() ? clean(value) : null;
const normalizedCas = value => clean(value).replace(/\s+/gu,'').replace(/[‐‑‒–—―]/gu,'-');

function normalizeIngredients(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.ingredients) || value.ingredients.length > 100) return null;
  const parserStatus = typeof value.parserStatus === 'string' ? value.parserStatus : null;
  if (parserStatus!==null&&!PARSER_STATUSES.has(parserStatus)) return null;
  const ingredients=[];
  for (const row of value.ingredients) {
    if (!row || !text(row.chemicalName,500,true) || !text(row.synonym ?? '',500) || !text(row.amountRaw ?? '',200)
      || !CAS_STATUSES.has(row.casStatus) || !REVIEW_STATUSES.has(row.reviewStatus) || !SOURCE_TYPES.has(row.sourceType)
      || typeof row.tradeSecret !== 'boolean') return null;
    const confidence=row.parserConfidence ?? null;
    if (confidence!==null&&!PARSER_CONFIDENCES.has(confidence)) return null;
    if (row.sourceType==='MANUAL'&&(row.reviewStatus!=='MANUALLY_ADDED'||confidence!==null)) return null;
    if (row.sourceType==='AUTO'&&row.reviewStatus==='MANUALLY_ADDED') return null;
    if (BLOCKED_AUTO_STATUSES.has(parserStatus)&&row.sourceType==='AUTO') return null;
    const rawCas=typeof row.casValue==='string'?row.casValue.trim():'';
    if (row.casStatus==='KNOWN'&&(!rawCas||!validateCasRegistryNumber(rawCas))) return null;
    if (row.casStatus!=='KNOWN'&&rawCas) return null;
    ingredients.push({
      chemicalName:clean(row.chemicalName),synonym:nullableClean(row.synonym),casValue:rawCas?normalizedCas(rawCas):null,
      casStatus:row.casStatus,amountRaw:clean(row.amountRaw ?? ''),tradeSecret:row.tradeSecret,
      parserConfidence:confidence,reviewStatus:row.reviewStatus,sourceType:row.sourceType
    });
  }
  return {parserStatus,ingredients};
}

function parseIngredientsJson(raw) {
  if (raw===null||raw===undefined||raw==='') return {parserStatus:null,ingredients:[]};
  if (typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>131072) return null;
  try{return normalizeIngredients(JSON.parse(raw));}catch{return null;}
}

function ingredientInserts(env,a,productId,versionId,ingredients,now) {
  return ingredients.map((row,index)=>env.DB.prepare(`INSERT INTO chemical_msds_ingredients
    (id,company_id,product_id,version_id,chemical_name,synonym,cas_value,cas_status,amount_raw,trade_secret,parser_confidence,review_status,source_type,sort_order,reviewed_by_user_id,reviewed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(),a.companyId,productId,versionId,row.chemicalName,row.synonym,row.casValue,row.casStatus,row.amountRaw,row.tradeSecret?1:0,
      row.parserConfidence,row.reviewStatus,row.sourceType,index,row.reviewStatus==='AUTO_EXTRACTED'?null:a.userId,row.reviewStatus==='AUTO_EXTRACTED'?null:now,now,now));
}
function disposition(filename,download) {
  const fallback=filename.replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_')||'msds.pdf';
  return `${download?'attachment':'inline'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function access(request, env) {
  const companyId = new URL(request.url).searchParams.get('companyId');
  if (!UUID.test(companyId || '')) return { response: errorResponse('NOT_FOUND', 404) };
  const userId = await authenticate(request, env);
  if (!userId) return { response: errorResponse('UNAUTHENTICATED', 401) };
  const membership = await env.DB.prepare(`SELECT m.role,m.primary_department_id AS departmentId,c.status AS companyStatus,m.status AS memberStatus
    FROM company_memberships m INNER JOIN companies c ON c.id=m.company_id WHERE m.company_id=? AND m.user_id=? LIMIT 1`).bind(companyId,userId).first();
  if (!membership) return { response: errorResponse('NOT_FOUND', 404) };
  if (membership.companyStatus !== 'active' || membership.memberStatus !== 'active') return { response: errorResponse('ACCESS_DENIED', 403) };
  const grant = membership.role === 'company_admin' ? true : Boolean(await env.DB.prepare(`SELECT 1 FROM company_permission_grants g INNER JOIN company_departments d ON d.id=g.department_id AND d.company_id=g.company_id
    WHERE g.company_id=? AND g.user_id=? AND g.permission='msds_manage' AND g.status='active' AND d.status='active' LIMIT 1`).bind(companyId,userId).first());
  const department = membership.departmentId && await env.DB.prepare("SELECT id FROM company_departments WHERE id=? AND company_id=? AND status='active'").bind(membership.departmentId,companyId).first();
  return { companyId,userId,departmentId: department?.id || null,companyAdmin:membership.role === 'company_admin',manage:grant,report:true };
}
const fields = `p.id,p.company_id AS companyId,p.product_name AS productName,p.manufacturer,p.supplier,p.product_code AS productCode,p.general_use AS generalUse,p.product_status AS productStatus,
 p.created_at AS createdAt,p.updated_at AS updatedAt,creator.name AS createdByName,
 v.id AS currentVersionId,v.version_no AS versionNo,v.original_filename AS originalFilename,v.content_type AS contentType,v.size_bytes AS fileSize,v.checksum_sha256 AS checksumSha256,v.issue_date AS issueDate,v.revision_date AS revisionDate,v.submission_number AS submissionNumber,v.review_status AS reviewStatus,v.uploaded_at AS uploadedAt,uploader.name AS uploadedByName,
 CASE WHEN v.id IS NOT NULL AND EXISTS(SELECT 1 FROM chemical_msds_ingredients status_i WHERE status_i.version_id=v.id AND status_i.company_id=p.company_id AND status_i.review_status='AUTO_EXTRACTED') THEN 1 ELSE 0 END AS needsReview`;
const joins = `FROM chemical_products p LEFT JOIN users creator ON creator.id=p.created_by LEFT JOIN chemical_msds_versions v ON v.product_id=p.id AND v.company_id=p.company_id AND v.is_current=1 LEFT JOIN users uploader ON uploader.id=v.uploaded_by`;
async function product(env, a, id) { return env.DB.prepare(`SELECT ${fields} ${joins} WHERE p.company_id=? AND p.id=?`).bind(a.companyId,id).first(); }
function productInput(value) {
  return value && text(value.productName,200,true) && text(value.manufacturer,200) && text(value.supplier,200) && text(value.productCode,100) && text(value.generalUse,1000);
}
function usageInput(value) {
  return value && UUID.test(value.departmentId || '') && text(value.purpose,500,true) && text(value.useLocation,500,true)
    && text(value.storageLocation,500,true) && quantity(value.stockQuantity) && text(value.stockUnit,40)
    && quantity(value.averageUsageQuantity) && text(value.averageUsagePeriod,40) && text(value.usageUnit,40);
}
async function allowedDepartment(env,a,departmentId) {
  if (!a.report) return false;
  return Boolean(await env.DB.prepare("SELECT 1 FROM company_departments WHERE id=? AND company_id=? AND status='active'").bind(departmentId,a.companyId).first());
}
const usageFields = `u.id,u.product_id AS productId,u.department_id AS departmentId,d.name AS departmentName,u.purpose,u.use_location AS useLocation,u.storage_location AS storageLocation,
 u.stock_quantity AS stockQuantity,u.stock_unit AS stockUnit,u.average_usage_quantity AS averageUsageQuantity,u.average_usage_period AS averageUsagePeriod,u.usage_unit AS usageUnit,
 u.created_at AS createdAt,u.updated_at AS updatedAt,reporter.name AS reportedByName`;
const usageJoins = `FROM chemical_usages u INNER JOIN company_departments d ON d.id=u.department_id AND d.company_id=u.company_id LEFT JOIN users reporter ON reporter.id=u.reported_by`;
const usageValues = u => [clean(u.purpose),clean(u.useLocation),clean(u.storageLocation),u.stockQuantity,clean(u.stockUnit),u.averageUsageQuantity,clean(u.averageUsagePeriod),clean(u.usageUnit)];

export async function context({ request,env }) {
  const rejected=guard(request,['GET']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    const departments=await env.DB.prepare("SELECT id,name FROM company_departments WHERE company_id=? AND status='active' ORDER BY name,id").bind(a.companyId).all();
    return json({ok:true,access:{companyId:a.companyId,departmentId:a.departmentId,read:true,report:a.report,manage:a.manage,companyAdmin:a.companyAdmin},departments:departments.results});
  } catch(error){return failure(error);}
}
export async function dashboard({ request,env }) {
  const rejected=guard(request,['GET']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    const summary=await env.DB.prepare(`SELECT COUNT(*) AS products,COUNT(v.id) AS withMsds,COUNT(*)-COUNT(v.id) AS withoutMsds,
      COUNT(CASE WHEN v.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chemical_msds_ingredients i WHERE i.version_id=v.id AND i.company_id=p.company_id AND i.review_status='AUTO_EXTRACTED') THEN 1 END) AS registered,
      COUNT(CASE WHEN EXISTS(SELECT 1 FROM chemical_msds_ingredients i WHERE i.version_id=v.id AND i.company_id=p.company_id AND i.review_status='AUTO_EXTRACTED') THEN 1 END) AS needsReview
      FROM chemical_products p LEFT JOIN chemical_msds_versions v ON v.product_id=p.id AND v.company_id=p.company_id AND v.is_current=1 WHERE p.company_id=?`).bind(a.companyId).first();
    const departments=await env.DB.prepare(`SELECT d.id,d.name,COUNT(DISTINCT u.product_id) AS products,
      COUNT(DISTINCT CASE WHEN v.id IS NULL THEN u.product_id END) AS withoutMsds,
      COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM chemical_msds_ingredients i WHERE i.version_id=v.id AND i.company_id=u.company_id AND i.review_status='AUTO_EXTRACTED') THEN u.product_id END) AS needsReview
      FROM company_departments d LEFT JOIN chemical_usages u ON u.department_id=d.id AND u.company_id=d.company_id
      LEFT JOIN chemical_msds_versions v ON v.product_id=u.product_id AND v.company_id=u.company_id AND v.is_current=1
      WHERE d.company_id=? AND d.status='active' GROUP BY d.id,d.name ORDER BY products DESC,d.name`).bind(a.companyId).all();
    const gaps=await env.DB.prepare(`SELECT COUNT(CASE WHEN TRIM(use_location)='' THEN 1 END) AS useLocationEmpty,
      COUNT(CASE WHEN TRIM(storage_location)='' THEN 1 END) AS storageLocationEmpty FROM chemical_usages WHERE company_id=?`).bind(a.companyId).first();
    return json({ok:true,summary,departments:departments.results,gaps});
  } catch(error){return failure(error);}
}
export async function candidates({ request,env }) {
  const rejected=guard(request,['GET']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    const params=new URL(request.url).searchParams, name=params.get('name')||'', manufacturer=params.get('manufacturer')||'';
    if(!text(name,200,true)||!text(manufacturer,200))return errorResponse('INVALID_FILTER',400);
    const rows=await env.DB.prepare(`SELECT id,product_name AS productName,manufacturer,product_status AS productStatus FROM chemical_products
      WHERE company_id=? AND product_name_key LIKE ? ESCAPE '\\' AND (?='' OR manufacturer_key LIKE ? ESCAPE '\\') ORDER BY product_name_key LIMIT 10`)
      .bind(a.companyId,`%${key(name).replace(/[\\%_]/g,'\\$&')}%`,key(manufacturer),`%${key(manufacturer).replace(/[\\%_]/g,'\\$&')}%`).all();
    return json({ok:true,candidates:rows.results});
  } catch(error){return failure(error);}
}
export async function collection({ request,env }) {
  const rejected=guard(request,['GET','POST']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    if(request.method==='GET') {
      const params=new URL(request.url).searchParams,q=params.get('q')||'',status=params.get('status')||'all',departmentId=params.get('departmentId')||'',rawOffset=params.get('offset')||'0';
      if(!text(q,200)||!['all','with-msds','without-msds','registered','needs-review','ACTIVE','ARCHIVED'].includes(status)||departmentId&&!UUID.test(departmentId)||!/^\d+$/.test(rawOffset)||!Number.isSafeInteger(Number(rawOffset)))return errorResponse('INVALID_FILTER',400);
      const pattern=`%${key(q).replace(/[\\%_]/g,'\\$&')}%`;
      const rows=await env.DB.prepare(`SELECT ${fields},(SELECT GROUP_CONCAT(name, ', ') FROM (SELECT DISTINCT d.name FROM chemical_usages u INNER JOIN company_departments d ON d.id=u.department_id AND d.company_id=u.company_id WHERE u.company_id=p.company_id AND u.product_id=p.id ORDER BY d.name)) AS departmentNames
        ${joins} WHERE p.company_id=? AND (p.product_name_key LIKE ? ESCAPE '\\' OR p.manufacturer_key LIKE ? ESCAPE '\\')
        AND (?='' OR EXISTS(SELECT 1 FROM chemical_usages u WHERE u.company_id=p.company_id AND u.product_id=p.id AND u.department_id=?))
        AND (?='all' OR (?='with-msds' AND v.id IS NOT NULL) OR (?='without-msds' AND v.id IS NULL)
          OR (?='registered' AND v.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chemical_msds_ingredients filter_i WHERE filter_i.version_id=v.id AND filter_i.company_id=p.company_id AND filter_i.review_status='AUTO_EXTRACTED'))
          OR (?='needs-review' AND EXISTS(SELECT 1 FROM chemical_msds_ingredients filter_i WHERE filter_i.version_id=v.id AND filter_i.company_id=p.company_id AND filter_i.review_status='AUTO_EXTRACTED')) OR p.product_status=?)
        ORDER BY p.updated_at DESC,p.id DESC LIMIT 101 OFFSET ?`).bind(a.companyId,pattern,pattern,departmentId,departmentId,status,status,status,status,status,status,Number(rawOffset)).all();
      return json({ok:true,products:rows.results.slice(0,100),hasMore:rows.results.length>100});
    }
    if(!a.report)return errorResponse('CHEMICAL_REPORT_REQUIRED',403);
    let body;try{body=await input(request);}catch(error){return inputError(error);}
    if(!body||!productInput(body.product)||!usageInput(body.usage)||typeof body.createNew!=='boolean')return errorResponse('INVALID_PRODUCT',400);
    if(!await allowedDepartment(env,a,body.usage.departmentId))return errorResponse('DEPARTMENT_ACCESS_DENIED',403);
    const p=body.product,u=body.usage,normalized=key(p.productName),manufacturerKey=key(p.manufacturer);
    const duplicate=await env.DB.prepare('SELECT id,product_name AS productName,manufacturer FROM chemical_products WHERE company_id=? AND product_name_key=? AND manufacturer_key=? LIMIT 1').bind(a.companyId,normalized,manufacturerKey).first();
    if(duplicate&&!body.createNew)return json({ok:false,error:'DUPLICATE_CANDIDATE',candidate:duplicate},409);
    const id=crypto.randomUUID(),usageId=crypto.randomUUID(),now=date();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO chemical_products (id,company_id,product_name,product_name_key,manufacturer,manufacturer_key,supplier,product_code,general_use,product_status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?)`)
        .bind(id,a.companyId,clean(p.productName),normalized,clean(p.manufacturer),manufacturerKey,clean(p.supplier),clean(p.productCode),clean(p.generalUse),a.userId,now,now),
      env.DB.prepare(`INSERT INTO chemical_usages (id,company_id,product_id,department_id,purpose,use_location,storage_location,stock_quantity,stock_unit,average_usage_quantity,average_usage_period,usage_unit,reported_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(usageId,a.companyId,id,u.departmentId,...usageValues(u),a.userId,now,now)
    ]);
    return json({ok:true,productId:id,usageId,msdsPresent:false},201);
  } catch(error){return failure(error);}
}

const regulatoryText = (category,result) => {
  const state=result.state,base=state === 'REVIEW_REQUIRED' ? '확인 필요'
    : ['WORK_ENVIRONMENT','SPECIAL_HEALTH'].includes(category)
      ? state === 'MATCH' ? '대상 유해인자 포함' : '해당 성분 없음'
      : state === 'MATCH' ? '해당' : '비해당';
  const evidence=state==='MATCH'?result.matches:state==='REVIEW_REQUIRED'?result.reviews:[],names=[...new Set(evidence.map(item=>item.chemicalName?.trim()).filter(Boolean))];
  return names.length?`${base}\n(${names.join(', ')})`:base;
};
const kstDate = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const exportFilename = (company,dateValue) => `HSSO_MSDS_관리대장_${String(company).replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,80)||'회사'}_${dateValue}.xlsx`;

export async function exportWorkbook({request,env}) {
  const rejected=guard(request,['GET']);if(rejected)return rejected;
  try{
    const a=await access(request,env);if(a.response)return a.response;
    const params=new URL(request.url).searchParams,q=params.get('q')||'',status=params.get('status')||'all',departmentId=params.get('departmentId')||'';
    if(!text(q,200)||!['all','with-msds','without-msds','registered','needs-review','ACTIVE','ARCHIVED'].includes(status)||departmentId&&!UUID.test(departmentId))return errorResponse('INVALID_FILTER',400);
    const company=await env.DB.prepare('SELECT name FROM companies WHERE id=? AND status=?').bind(a.companyId,'active').first();
    if(!company)return errorResponse('NOT_FOUND',404);
    const pattern=`%${key(q).replace(/[\\%_]/g,'\\$&')}%`;
    const rows=await env.DB.prepare(`SELECT p.id AS productId,p.product_name AS productName,p.manufacturer,p.supplier,
      u.id AS usageId,u.department_id AS departmentId,d.name AS departmentName,u.purpose,u.use_location AS useLocation,u.storage_location AS storageLocation,
      u.stock_quantity AS stockQuantity,u.stock_unit AS stockUnit,u.average_usage_quantity AS averageUsageQuantity,u.average_usage_period AS averageUsagePeriod,u.usage_unit AS usageUnit,
      v.id AS currentVersionId,v.revision_date AS revisionDate,v.submission_number AS submissionNumber,
      CASE WHEN v.id IS NOT NULL AND EXISTS(SELECT 1 FROM chemical_msds_ingredients status_i WHERE status_i.version_id=v.id AND status_i.company_id=p.company_id AND status_i.review_status='AUTO_EXTRACTED') THEN 1 ELSE 0 END AS needsReview
      FROM chemical_usages u INNER JOIN chemical_products p ON p.id=u.product_id AND p.company_id=u.company_id
      INNER JOIN company_departments d ON d.id=u.department_id AND d.company_id=u.company_id
      LEFT JOIN chemical_msds_versions v ON v.product_id=p.id AND v.company_id=p.company_id AND v.is_current=1
      WHERE p.company_id=? AND (p.product_name_key LIKE ? ESCAPE '\\' OR p.manufacturer_key LIKE ? ESCAPE '\\')
      AND (?='' OR u.department_id=?)
      AND (?='all' OR (?='with-msds' AND v.id IS NOT NULL) OR (?='without-msds' AND v.id IS NULL)
        OR (?='registered' AND v.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chemical_msds_ingredients filter_i WHERE filter_i.version_id=v.id AND filter_i.company_id=p.company_id AND filter_i.review_status='AUTO_EXTRACTED'))
        OR (?='needs-review' AND EXISTS(SELECT 1 FROM chemical_msds_ingredients filter_i WHERE filter_i.version_id=v.id AND filter_i.company_id=p.company_id AND filter_i.review_status='AUTO_EXTRACTED')) OR p.product_status=?)
      ORDER BY d.name,d.id,p.product_name_key,p.manufacturer_key,u.created_at,u.id`)
      .bind(a.companyId,pattern,pattern,departmentId,departmentId,status,status,status,status,status,status).all();
    const selectedProducts=new Set(rows.results.map(row=>row.productId)),ingredientsByVersion=new Map();
    if(selectedProducts.size){
      const ingredientRows=await env.DB.prepare(`SELECT i.product_id AS productId,i.version_id AS versionId,${ingredientFields} FROM chemical_msds_ingredients i
        INNER JOIN chemical_msds_versions v ON v.id=i.version_id AND v.company_id=i.company_id AND v.product_id=i.product_id AND v.is_current=1
        WHERE i.company_id=? ORDER BY i.version_id,i.sort_order,i.id`).bind(a.companyId).all();
      for(const ingredient of ingredientRows.results){if(!selectedProducts.has(ingredient.productId)&&ingredient.productId!==undefined)continue;if(!ingredientsByVersion.has(ingredient.versionId))ingredientsByVersion.set(ingredient.versionId,[]);ingredientsByVersion.get(ingredient.versionId).push(ingredient);}
    }
    const regulatoryByProduct=new Map();
    for(const row of rows.results){if(!regulatoryByProduct.has(row.productId))regulatoryByProduct.set(row.productId,evaluateRegulatory(ingredientsByVersion.get(row.currentVersionId)||[],{versionId:row.currentVersionId}));}
    const departments=new Map();
    for(const source of rows.results){
      const regulatory=regulatoryByProduct.get(source.productId),categories=regulatory.categories;
      const review=Boolean(source.needsReview)||Object.values(categories).some(value=>value.state==='REVIEW_REQUIRED');
      if(!departments.has(source.departmentId))departments.set(source.departmentId,{id:source.departmentId,name:source.departmentName,rows:[],products:new Map()});
      const department=departments.get(source.departmentId);
      department.rows.push({
        productName:source.productName,manufacturer:source.manufacturer,supplier:source.supplier,purpose:source.purpose,useLocation:source.useLocation,storageLocation:source.storageLocation,
        stockQuantity:source.stockQuantity,stockUnit:source.stockUnit,averageUsageQuantity:source.averageUsageQuantity,averageUsagePeriod:source.averageUsagePeriod,usageUnit:source.usageUnit,
        revisionDate:source.revisionDate||'',submissionNumber:source.submissionNumber||'',managed:regulatoryText('MANAGED',categories.MANAGED),specialManaged:regulatoryText('SPECIAL_MANAGED',categories.SPECIAL_MANAGED),
        workEnvironment:regulatoryText('WORK_ENVIRONMENT',categories.WORK_ENVIRONMENT),specialHealth:regulatoryText('SPECIAL_HEALTH',categories.SPECIAL_HEALTH),reviewRequired:review?'예':'아니오'
      });
      if(!department.products.has(source.productId))department.products.set(source.productId,{msds:Boolean(source.currentVersionId),review});
      else if(review)department.products.get(source.productId).review=true;
    }
    const workbookDepartments=[...departments.values()].map(department=>{
      const products=[...department.products.values()],msdsCount=products.filter(product=>product.msds).length;
      return {id:department.id,name:department.name,rows:department.rows,productCount:products.length,msdsCount,missingCount:products.length-msdsCount,reviewCount:products.filter(product=>product.review).length};
    });
    const outputDate=kstDate(new Date()),bytes=chemicalWorkbook({companyName:company.name,outputDate,departments:workbookDepartments}),filename=exportFilename(company.name,outputDate);
    return new Response(bytes,{headers:{'Content-Type':XLSX_MIME,'Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="hsso-msds-register.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return failure(error);}
}
async function objectBytes(object){
  if(typeof object.arrayBuffer==='function')return object.arrayBuffer();
  if(object.body instanceof ArrayBuffer)return object.body;
  if(ArrayBuffer.isView(object.body))return object.body.buffer.slice(object.body.byteOffset,object.body.byteOffset+object.body.byteLength);
  if(typeof object.body?.arrayBuffer==='function')return object.body.arrayBuffer();
  return new Response(object.body).arrayBuffer();
}
async function restoreObjects(bucket,backups){for(const row of backups)await bucket.put(row.storageKey,row.bytes,{httpMetadata:{contentType:row.contentType||PDF_TYPE}});}

export async function item({ request,env,params }) {
  const rejected=guard(request,['GET','PATCH','DELETE']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    if(!UUID.test(params.id||''))return errorResponse('NOT_FOUND',404);
    const p=await product(env,a,params.id);if(!p)return errorResponse('NOT_FOUND',404);
    if(request.method==='GET') {
      const usages=await env.DB.prepare(`SELECT ${usageFields} ${usageJoins} WHERE u.company_id=? AND u.product_id=? ORDER BY d.name,u.created_at,u.id`).bind(a.companyId,p.id).all();
      const versions=await env.DB.prepare(`SELECT v.id,v.version_no AS versionNo,v.original_filename AS originalFilename,v.content_type AS contentType,v.size_bytes AS fileSize,v.checksum_sha256 AS checksumSha256,v.issue_date AS issueDate,v.revision_date AS revisionDate,v.submission_number AS submissionNumber,v.is_current AS isCurrent,v.review_status AS reviewStatus,v.uploaded_at AS uploadedAt,v.reviewed_at AS reviewedAt,u.name AS uploadedByName,
        CASE WHEN EXISTS(SELECT 1 FROM chemical_msds_ingredients i WHERE i.version_id=v.id AND i.company_id=v.company_id AND i.review_status='AUTO_EXTRACTED') THEN 1 ELSE 0 END AS needsReview
        FROM chemical_msds_versions v LEFT JOIN users u ON u.id=v.uploaded_by WHERE v.company_id=? AND v.product_id=? ORDER BY v.version_no DESC`).bind(a.companyId,p.id).all();
      const currentIngredients=p.currentVersionId?await env.DB.prepare(`SELECT ${ingredientFields} FROM chemical_msds_ingredients i
        WHERE i.company_id=? AND i.product_id=? AND i.version_id=? ORDER BY i.sort_order,i.id`).bind(a.companyId,p.id,p.currentVersionId).all():{results:[]};
      const regulatory=evaluateRegulatory(currentIngredients.results,{versionId:p.currentVersionId});
      return json({ok:true,product:p,usages:usages.results,versions:versions.results,currentIngredients:currentIngredients.results,regulatory});
    }
    if(!a.manage)return errorResponse('CHEMICAL_MANAGE_REQUIRED',403);
    if(request.method==='DELETE'){
      const versionRows=await env.DB.prepare('SELECT storage_key AS storageKey,content_type AS contentType FROM chemical_msds_versions WHERE company_id=? AND product_id=? ORDER BY version_no').bind(a.companyId,p.id).all();
      const bucket=env?.MSDS_BUCKET;
      if(versionRows.results.length&&(!bucket||typeof bucket.get!=='function'||typeof bucket.delete!=='function'||typeof bucket.put!=='function'))return errorResponse('MSDS_STORAGE_UNAVAILABLE',503);
      const backups=[];
      try{
        for(const row of versionRows.results){const object=await bucket.get(row.storageKey);if(!object)throw new Error('missing');backups.push({...row,bytes:await objectBytes(object)});}
      }catch{return errorResponse('MSDS_STORAGE_READ_FAILED',502);}
      const deleted=[];
      try{for(const row of backups){await bucket.delete(row.storageKey);deleted.push(row);}}
      catch{try{await restoreObjects(bucket,deleted);}catch{return errorResponse('PRODUCT_DELETE_ROLLBACK_FAILED',502);}return errorResponse('MSDS_STORAGE_DELETE_FAILED',502);}
      try{
        const latestRows=await env.DB.prepare('SELECT storage_key AS storageKey FROM chemical_msds_versions WHERE company_id=? AND product_id=? ORDER BY version_no').bind(a.companyId,p.id).all();
        if(latestRows.results.length!==backups.length||latestRows.results.some((row,index)=>row.storageKey!==backups[index].storageKey)){await restoreObjects(bucket,backups);return errorResponse('PRODUCT_CHANGED_DURING_DELETE',409);}
        const removal=await env.DB.prepare('DELETE FROM chemical_products WHERE id=? AND company_id=?').bind(p.id,a.companyId).run();
        if(removal?.success===false)throw new Error('product delete');
      }catch{try{await restoreObjects(bucket,backups);}catch{return errorResponse('PRODUCT_DELETE_ROLLBACK_FAILED',500);}return errorResponse('PRODUCT_DELETE_DB_FAILED',500);}
      return json({ok:true,deletedProductId:p.id,deletedVersions:backups.length});
    }
    let body;try{body=await input(request);}catch(error){return inputError(error);}
    if(!productInput(body)||!['ACTIVE','ARCHIVED'].includes(body.productStatus))return errorResponse('INVALID_PRODUCT',400);
    await env.DB.prepare(`UPDATE chemical_products SET product_name=?,product_name_key=?,manufacturer=?,manufacturer_key=?,supplier=?,product_code=?,general_use=?,product_status=?,updated_at=? WHERE id=? AND company_id=?`)
      .bind(clean(body.productName),key(body.productName),clean(body.manufacturer),key(body.manufacturer),clean(body.supplier),clean(body.productCode),clean(body.generalUse),body.productStatus,date(),p.id,a.companyId).run();
    return json({ok:true});
  } catch(error){return failure(error);}
}
export async function usages({ request,env,params }) {
  const rejected=guard(request,['POST']);if(rejected)return rejected;
  try {const a=await access(request,env);if(a.response)return a.response;
    if(!UUID.test(params.id||'')||!await product(env,a,params.id))return errorResponse('NOT_FOUND',404);
    let body;try{body=await input(request);}catch(error){return inputError(error);}
    if(!usageInput(body))return errorResponse('INVALID_USAGE',400);
    if(!await allowedDepartment(env,a,body.departmentId))return errorResponse('DEPARTMENT_ACCESS_DENIED',403);
    const id=crypto.randomUUID(),now=date();
    const inserted=await env.DB.prepare(`INSERT INTO chemical_usages (id,company_id,product_id,department_id,purpose,use_location,storage_location,stock_quantity,stock_unit,average_usage_quantity,average_usage_period,usage_unit,reported_by,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM chemical_usages WHERE company_id=? AND product_id=? AND department_id=?)`)
      .bind(id,a.companyId,params.id,body.departmentId,...usageValues(body),a.userId,now,now,a.companyId,params.id,body.departmentId).run();
    if(inserted.meta?.changes!==1)return errorResponse('USAGE_ALREADY_EXISTS',409);
    await env.DB.prepare('UPDATE chemical_products SET updated_at=? WHERE id=? AND company_id=?').bind(now,params.id,a.companyId).run();
    return json({ok:true,usageId:id},201);
  }catch(error){return failure(error);}
}
export async function usageItem({ request,env,params }) {
  const rejected=guard(request,['GET','PATCH','DELETE']);if(rejected)return rejected;
  try {const a=await access(request,env);if(a.response)return a.response;
    if(!UUID.test(params.usageId||''))return errorResponse('NOT_FOUND',404);
    const row=await env.DB.prepare(`SELECT ${usageFields} ${usageJoins} WHERE u.company_id=? AND u.id=?`).bind(a.companyId,params.usageId).first();
    if(!row)return errorResponse('NOT_FOUND',404);
    if(request.method==='GET')return json({ok:true,usage:row});
    if(!a.manage)return errorResponse('CHEMICAL_MANAGE_REQUIRED',403);
    if(request.method==='DELETE'){
      if(!await allowedDepartment(env,a,row.departmentId))return errorResponse('DEPARTMENT_ACCESS_DENIED',403);
      const now=date(),results=await env.DB.batch([
        env.DB.prepare('DELETE FROM chemical_usages WHERE id=? AND company_id=? AND product_id=? AND department_id=?').bind(row.id,a.companyId,row.productId,row.departmentId),
        env.DB.prepare('UPDATE chemical_products SET updated_at=? WHERE id=? AND company_id=?').bind(now,row.productId,a.companyId)
      ]);
      if(results[0].meta?.changes!==1||results[1].meta?.changes!==1)throw new Error('usage delete');
      return json({ok:true});
    }
    let body;try{body=await input(request);}catch(error){return inputError(error);}
    if(!usageInput(body)||body.departmentId!==row.departmentId)return errorResponse('INVALID_USAGE',400);
    if(!await allowedDepartment(env,a,row.departmentId))return errorResponse('DEPARTMENT_ACCESS_DENIED',403);
    const now=date();
    await env.DB.prepare(`UPDATE chemical_usages SET purpose=?,use_location=?,storage_location=?,stock_quantity=?,stock_unit=?,average_usage_quantity=?,average_usage_period=?,usage_unit=?,updated_at=? WHERE id=? AND company_id=?`)
      .bind(...usageValues(body),now,row.id,a.companyId).run();
    await env.DB.prepare('UPDATE chemical_products SET updated_at=? WHERE id=? AND company_id=?').bind(now,row.productId,a.companyId).run();
    return json({ok:true});
  }catch(error){return failure(error);}
}
export async function versions({ request,env,params }) {
  const rejected=guard(request,['POST']);if(rejected)return rejected;
  try {const a=await access(request,env);if(a.response)return a.response;
    if(!UUID.test(params.id||'')||!await product(env,a,params.id))return errorResponse('NOT_FOUND',404);
    if(!a.manage)return errorResponse('CHEMICAL_MANAGE_REQUIRED',403);
    const bucket=env?.MSDS_BUCKET;if(!bucket||typeof bucket.put!=='function')return errorResponse('MSDS_STORAGE_UNAVAILABLE',503);
    const contentType=request.headers.get('Content-Type')||'';
    if(!contentType.toLowerCase().startsWith('multipart/form-data;'))return errorResponse('INVALID_CONTENT_TYPE',400);
    const contentLength=Number(request.headers.get('Content-Length')||0);
    if(contentLength>MAX_MSDS_BYTES+1024*1024)return errorResponse('MSDS_FILE_TOO_LARGE',413);
    let form;try{form=await request.formData();}catch{return errorResponse('INVALID_UPLOAD',400);}
    const file=form.get('file'),issueDate=String(form.get('issueDate')||''),revisionDate=String(form.get('revisionDate')||''),submissionNumber=String(form.get('submissionNumber')||'').trim();
    const composition=parseIngredientsJson(form.get('composition'));
    if(!composition)return errorResponse('INVALID_MSDS_INGREDIENTS',400);
    if(!file||typeof file.arrayBuffer!=='function'||typeof file.name!=='string')return errorResponse('MSDS_FILE_REQUIRED',400);
    const filename=safeFilename(file.name);
    if(!filename||!/\.pdf$/i.test(filename)||String(file.type).toLowerCase()!==PDF_TYPE)return errorResponse('INVALID_MSDS_FILE',400);
    if(!Number.isSafeInteger(file.size)||file.size<5)return errorResponse('INVALID_MSDS_FILE',400);
    if(file.size>MAX_MSDS_BYTES)return errorResponse('MSDS_FILE_TOO_LARGE',413);
    if(!isoDate(issueDate)||!isoDate(revisionDate)||!text(submissionNumber,100))return errorResponse('INVALID_MSDS_METADATA',400);
    const bytes=await file.arrayBuffer(),signature=new TextDecoder('ascii').decode(bytes.slice(0,5));
    if(signature!=='%PDF-')return errorResponse('INVALID_MSDS_FILE',400);
    const checksum=hex(await crypto.subtle.digest('SHA-256',bytes));
    const versionId=crypto.randomUUID(),storageKey=`companies/${a.companyId}/chemicals/${params.id}/msds/${versionId}.pdf`,now=date();
    try{await bucket.put(storageKey,bytes,{httpMetadata:{contentType:PDF_TYPE}});}catch{return errorResponse('MSDS_STORAGE_WRITE_FAILED',502);}
    try{
      const latest=await env.DB.prepare('SELECT COALESCE(MAX(version_no),0) AS versionNo FROM chemical_msds_versions WHERE company_id=? AND product_id=?').bind(a.companyId,params.id).first();
      const versionNo=Number(latest.versionNo)+1;
      const results=await env.DB.batch([
        env.DB.prepare('UPDATE chemical_msds_versions SET is_current=0 WHERE company_id=? AND product_id=? AND is_current=1').bind(a.companyId,params.id),
        env.DB.prepare(`INSERT INTO chemical_msds_versions (id,company_id,product_id,version_no,storage_key,original_filename,content_type,size_bytes,issue_date,revision_date,submission_number,is_current,uploaded_by,uploaded_at,review_status,checksum_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,'UNREVIEWED',?)`).bind(versionId,a.companyId,params.id,versionNo,storageKey,filename,PDF_TYPE,file.size,issueDate||null,revisionDate||null,submissionNumber,a.userId,now,checksum),
        ...ingredientInserts(env,a,params.id,versionId,composition.ingredients,now),
        env.DB.prepare('UPDATE chemical_products SET updated_at=? WHERE id=? AND company_id=?').bind(now,params.id,a.companyId)
      ]);
      if(results.some(result=>!result.success)||results[1].meta?.changes!==1||results.at(-1).meta?.changes!==1)throw new Error('version insert');
      return json({ok:true,version:{id:versionId,versionNo,isCurrent:true,originalFilename:filename,contentType:PDF_TYPE,fileSize:file.size,checksumSha256:checksum,issueDate:issueDate||null,revisionDate:revisionDate||null,submissionNumber,reviewStatus:'UNREVIEWED',uploadedAt:now},ingredientCount:composition.ingredients.length},201);
    }catch(error){if(typeof bucket.delete==='function')try{await bucket.delete(storageKey);}catch{}return failure(error);}
  }catch(error){return failure(error);}
}

export async function ingredients({request,env,params}) {
  const rejected=guard(request,['GET','PUT']);if(rejected)return rejected;
  try{const a=await access(request,env);if(a.response)return a.response;
    if(!UUID.test(params.id||'')||!UUID.test(params.versionId||''))return errorResponse('NOT_FOUND',404);
    const version=await env.DB.prepare(`SELECT v.id FROM chemical_msds_versions v INNER JOIN chemical_products p ON p.id=v.product_id AND p.company_id=v.company_id
      WHERE v.id=? AND v.product_id=? AND v.company_id=?`).bind(params.versionId,params.id,a.companyId).first();
    if(!version)return errorResponse('NOT_FOUND',404);
    if(request.method==='GET'){
      const rows=await env.DB.prepare(`SELECT ${ingredientFields} FROM chemical_msds_ingredients i WHERE i.company_id=? AND i.product_id=? AND i.version_id=? ORDER BY i.sort_order,i.id`)
        .bind(a.companyId,params.id,params.versionId).all();
      return json({ok:true,productId:params.id,versionId:params.versionId,ingredients:rows.results});
    }
    if(!a.manage)return errorResponse('CHEMICAL_MANAGE_REQUIRED',403);
    let body;try{body=await input(request,131072);}catch(error){return inputError(error);}
    const composition=normalizeIngredients(body);if(!composition)return errorResponse('INVALID_MSDS_INGREDIENTS',400);
    const now=date(),statements=[
      env.DB.prepare('DELETE FROM chemical_msds_ingredients WHERE company_id=? AND product_id=? AND version_id=?').bind(a.companyId,params.id,params.versionId),
      ...ingredientInserts(env,a,params.id,params.versionId,composition.ingredients,now),
      env.DB.prepare('UPDATE chemical_products SET updated_at=? WHERE id=? AND company_id=?').bind(now,params.id,a.companyId)
    ];
    const results=await env.DB.batch(statements);
    if(results.some(result=>!result.success)||results.at(-1).meta?.changes!==1)throw new Error('ingredient replace');
    return json({ok:true,ingredientCount:composition.ingredients.length});
  }catch(error){return failure(error);}
}

export async function versionFile({request,env,params}) {
  const rejected=guard(request,['GET']);if(rejected)return rejected;
  try{const a=await access(request,env);if(a.response)return a.response;
    if(!UUID.test(params.id||'')||!UUID.test(params.versionId||''))return errorResponse('NOT_FOUND',404);
    const row=await env.DB.prepare(`SELECT v.storage_key AS storageKey,v.original_filename AS originalFilename,v.content_type AS contentType,v.size_bytes AS fileSize
      FROM chemical_msds_versions v INNER JOIN chemical_products p ON p.id=v.product_id AND p.company_id=v.company_id
      WHERE v.id=? AND v.product_id=? AND v.company_id=?`).bind(params.versionId,params.id,a.companyId).first();
    if(!row)return errorResponse('NOT_FOUND',404);
    const bucket=env?.MSDS_BUCKET;if(!bucket||typeof bucket.get!=='function')return errorResponse('MSDS_STORAGE_UNAVAILABLE',503);
    let object;try{object=await bucket.get(row.storageKey);}catch{return errorResponse('MSDS_STORAGE_READ_FAILED',502);}
    if(!object)return errorResponse('MSDS_FILE_NOT_FOUND',404);
    const download=new URL(request.url).searchParams.get('download')==='1';
    return new Response(object.body,{headers:{'Content-Type':PDF_TYPE,'Content-Length':String(row.fileSize),'Content-Disposition':disposition(row.originalFilename,download),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return failure(error);}
}
