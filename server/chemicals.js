import { json, errorResponse } from './auth-session.js';
import { authenticate } from './documents.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clean = value => value.trim().replace(/\s+/gu, ' ');
const key = value => clean(value).normalize('NFKC').toLocaleLowerCase('ko-KR');
const text = (value, max, required = false) => typeof value === 'string' && value.trim().length <= max && (!required || Boolean(value.trim()));
const quantity = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9);
const date = () => new Date().toISOString();

function guard(request, methods) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  if (!['GET','HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  }
  return null;
}
async function input(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_CONTENT_TYPE');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16384) throw new Error('PAYLOAD_TOO_LARGE');
  return JSON.parse(raw);
}
const inputError = error => errorResponse(error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT', error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
const failure = error => errorResponse(String(error).includes('no such table') ? 'MIGRATION_REQUIRED' : 'INTERNAL_SERVER_ERROR', String(error).includes('no such table') ? 503 : 500);

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
  return { companyId,userId,departmentId: department?.id || null,manage:grant,report:Boolean(grant || department) };
}
const fields = `p.id,p.company_id AS companyId,p.product_name AS productName,p.manufacturer,p.supplier,p.product_code AS productCode,p.general_use AS generalUse,p.product_status AS productStatus,
 p.created_at AS createdAt,p.updated_at AS updatedAt,creator.name AS createdByName,
 v.id AS currentVersionId,v.version_no AS versionNo,v.original_filename AS originalFilename,v.issue_date AS issueDate,v.revision_date AS revisionDate,v.submission_number AS submissionNumber,v.review_status AS reviewStatus,v.uploaded_at AS uploadedAt,uploader.name AS uploadedByName`;
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
  if (!a.report || (!a.manage && departmentId !== a.departmentId)) return false;
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
    return json({ok:true,access:{companyId:a.companyId,departmentId:a.departmentId,read:true,report:a.report,manage:a.manage},departments:departments.results});
  } catch(error){return failure(error);}
}
export async function dashboard({ request,env }) {
  const rejected=guard(request,['GET']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    const summary=await env.DB.prepare(`SELECT COUNT(*) AS products,COUNT(v.id) AS withMsds,COUNT(*)-COUNT(v.id) AS withoutMsds,
      COUNT(CASE WHEN v.review_status='UNREVIEWED' THEN 1 END) AS unreviewed
      FROM chemical_products p LEFT JOIN chemical_msds_versions v ON v.product_id=p.id AND v.company_id=p.company_id AND v.is_current=1 WHERE p.company_id=?`).bind(a.companyId).first();
    const departments=await env.DB.prepare(`SELECT d.id,d.name,COUNT(DISTINCT u.product_id) AS products,
      COUNT(DISTINCT CASE WHEN v.id IS NULL THEN u.product_id END) AS withoutMsds,
      COUNT(DISTINCT CASE WHEN v.review_status='UNREVIEWED' THEN u.product_id END) AS unreviewed
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
      if(!text(q,200)||!['all','with-msds','without-msds','unreviewed','reviewed','ACTIVE','ARCHIVED'].includes(status)||departmentId&&!UUID.test(departmentId)||!/^\d+$/.test(rawOffset)||!Number.isSafeInteger(Number(rawOffset)))return errorResponse('INVALID_FILTER',400);
      const pattern=`%${key(q).replace(/[\\%_]/g,'\\$&')}%`;
      const rows=await env.DB.prepare(`SELECT ${fields},(SELECT GROUP_CONCAT(name, ', ') FROM (SELECT DISTINCT d.name FROM chemical_usages u INNER JOIN company_departments d ON d.id=u.department_id AND d.company_id=u.company_id WHERE u.company_id=p.company_id AND u.product_id=p.id ORDER BY d.name)) AS departmentNames
        ${joins} WHERE p.company_id=? AND (p.product_name_key LIKE ? ESCAPE '\\' OR p.manufacturer_key LIKE ? ESCAPE '\\')
        AND (?='' OR EXISTS(SELECT 1 FROM chemical_usages u WHERE u.company_id=p.company_id AND u.product_id=p.id AND u.department_id=?))
        AND (?='all' OR (?='with-msds' AND v.id IS NOT NULL) OR (?='without-msds' AND v.id IS NULL) OR (?='unreviewed' AND v.review_status='UNREVIEWED') OR (?='reviewed' AND v.review_status='REVIEWED') OR p.product_status=?)
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
export async function item({ request,env,params }) {
  const rejected=guard(request,['GET','PATCH']); if(rejected)return rejected;
  try { const a=await access(request,env); if(a.response)return a.response;
    if(!UUID.test(params.id||''))return errorResponse('NOT_FOUND',404);
    const p=await product(env,a,params.id);if(!p)return errorResponse('NOT_FOUND',404);
    if(request.method==='GET') {
      const usages=await env.DB.prepare(`SELECT ${usageFields} ${usageJoins} WHERE u.company_id=? AND u.product_id=? ORDER BY d.name,u.created_at,u.id`).bind(a.companyId,p.id).all();
      const versions=await env.DB.prepare(`SELECT v.id,v.version_no AS versionNo,v.original_filename AS originalFilename,v.issue_date AS issueDate,v.revision_date AS revisionDate,v.submission_number AS submissionNumber,v.is_current AS isCurrent,v.review_status AS reviewStatus,v.uploaded_at AS uploadedAt,v.reviewed_at AS reviewedAt,u.name AS uploadedByName
        FROM chemical_msds_versions v LEFT JOIN users u ON u.id=v.uploaded_by WHERE v.company_id=? AND v.product_id=? ORDER BY v.version_no DESC`).bind(a.companyId,p.id).all();
      return json({ok:true,product:p,usages:usages.results,versions:versions.results});
    }
    if(!a.manage)return errorResponse('CHEMICAL_MANAGE_REQUIRED',403);
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
    await env.DB.prepare(`INSERT INTO chemical_usages (id,company_id,product_id,department_id,purpose,use_location,storage_location,stock_quantity,stock_unit,average_usage_quantity,average_usage_period,usage_unit,reported_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,a.companyId,params.id,body.departmentId,...usageValues(body),a.userId,now,now).run();
    await env.DB.prepare('UPDATE chemical_products SET updated_at=? WHERE id=? AND company_id=?').bind(now,params.id,a.companyId).run();
    return json({ok:true,usageId:id},201);
  }catch(error){return failure(error);}
}
export async function usageItem({ request,env,params }) {
  const rejected=guard(request,['GET','PATCH']);if(rejected)return rejected;
  try {const a=await access(request,env);if(a.response)return a.response;
    if(!UUID.test(params.usageId||''))return errorResponse('NOT_FOUND',404);
    const row=await env.DB.prepare(`SELECT ${usageFields} ${usageJoins} WHERE u.company_id=? AND u.id=?`).bind(a.companyId,params.usageId).first();
    if(!row)return errorResponse('NOT_FOUND',404);
    if(request.method==='GET')return json({ok:true,usage:row});
    if(!a.manage && row.departmentId!==a.departmentId)return errorResponse('DEPARTMENT_ACCESS_DENIED',403);
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
    // No persistent object store is bound. Never create a metadata row for an unstored PDF.
    return errorResponse('PERSISTENT_STORAGE_REQUIRED',503);
  }catch(error){return failure(error);}
}
