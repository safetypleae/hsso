import { json, errorResponse, hashToken, hex } from './auth-session.js';
import { authenticate } from './documents.js';
import { normalizeEmail } from './email-verification.js';
import { requireCompanyAdmin } from './company-workspaces.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
const PERMISSIONS = new Set(['msds_manage']);
const INVITE_DAYS = 7;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function guard(request, methods, mutations = []) {
  if (!methods.includes(request.method)) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
  const origin = request.headers.get('Origin');
  if (mutations.includes(request.method) && origin !== null && origin !== new URL(request.url).origin) return errorResponse('ORIGIN_NOT_ALLOWED', 403);
  return null;
}

async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('INVALID_JSON');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16384) throw new Error('PAYLOAD_TOO_LARGE');
  try { return JSON.parse(text); } catch { throw new Error('INVALID_JSON'); }
}

function bodyError(error) { return errorResponse(error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON', error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400); }
const nowIso = () => new Date().toISOString();
const tokenValue = () => hex(crypto.getRandomValues(new Uint8Array(32)));

async function expireInvitations(env, companyId, now) {
  await env.DB.prepare("UPDATE company_invitations SET status='expired' WHERE company_id=? AND status='pending' AND julianday(expires_at)<=julianday(?)").bind(companyId, now).run();
}

export async function hasDepartmentPermission(env, userId, companyId, departmentId, permission) {
  if (!UUID.test(companyId || '') || !UUID.test(departmentId || '') || !PERMISSIONS.has(permission)) return false;
  const row = await env.DB.prepare(`SELECT m.role,m.status AS membership_status,c.status AS company_status,
    EXISTS(SELECT 1 FROM company_permission_grants g INNER JOIN company_departments d ON d.id=g.department_id AND d.company_id=g.company_id WHERE g.company_id=c.id AND g.user_id=m.user_id AND g.department_id=? AND d.status='active' AND g.permission=? AND g.status='active') AS has_grant
    FROM companies c INNER JOIN company_memberships m ON m.company_id=c.id WHERE c.id=? AND m.user_id=? LIMIT 1`)
    .bind(departmentId, permission, companyId, userId).first();
  return Boolean(row && row.company_status === 'active' && row.membership_status === 'active' && (row.role === 'company_admin' || row.has_grant));
}

export async function canManageCompanyMsds(env, userId, companyId, departmentId) {
  if (!UUID.test(companyId || '')) return false;
  const membership = await env.DB.prepare("SELECT m.role,m.status AS membership_status,c.status AS company_status FROM company_memberships m INNER JOIN companies c ON c.id=m.company_id WHERE m.company_id=? AND m.user_id=? LIMIT 1").bind(companyId, userId).first();
  if (!membership || membership.company_status !== 'active' || membership.membership_status !== 'active') return false;
  if (membership.role === 'company_admin') {
    if (!departmentId) return true;
    return Boolean(await env.DB.prepare("SELECT id FROM company_departments WHERE id=? AND company_id=? AND status='active'").bind(departmentId, companyId).first());
  }
  return departmentId ? hasDepartmentPermission(env, userId, companyId, departmentId, 'msds_manage') : false;
}

export async function invitations({ request, env, params }) {
  const rejected = guard(request, ['GET', 'POST'], ['POST']); if (rejected) return rejected;
  let access; try { access = await requireCompanyAdmin(request, env, params.companyId); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (access.response) return access.response;
  try {
    const now = nowIso(); await expireInvitations(env, params.companyId, now);
    if (request.method === 'GET') {
      const rows = await env.DB.prepare(`SELECT i.id,i.invitee_email AS inviteeEmail,i.permission,i.status,i.created_at AS createdAt,i.expires_at AS expiresAt,i.accepted_at AS acceptedAt,
        d.id AS departmentId,d.name AS departmentName,u.name AS invitedByName
        FROM company_invitations i INNER JOIN company_departments d ON d.id=i.department_id INNER JOIN users u ON u.id=i.invited_by_user_id
        WHERE i.company_id=? ORDER BY i.created_at DESC,i.id DESC`).bind(params.companyId).all();
      return json({ ok: true, invitations: rows.results });
    }
    let input; try { input = await body(request); } catch (error) { return bodyError(error); }
    const email = normalizeEmail(input?.email);
    if (!exact(input, ['email', 'departmentId', 'permission']) || !email || !UUID.test(input.departmentId || '') || !PERMISSIONS.has(input.permission)) return errorResponse('INVALID_INVITATION', 400);
    const department = await env.DB.prepare("SELECT id FROM company_departments WHERE id=? AND company_id=? AND status='active'").bind(input.departmentId, params.companyId).first();
    if (!department) return errorResponse('DEPARTMENT_NOT_AVAILABLE', 400);
    const existingAdmin = await env.DB.prepare("SELECT m.id FROM users u INNER JOIN company_memberships m ON m.user_id=u.id WHERE u.email=? AND m.company_id=? AND m.role='company_admin' AND m.status='active' LIMIT 1").bind(email, params.companyId).first();
    if (existingAdmin) return errorResponse('COMPANY_ADMIN_ALREADY_HAS_ACCESS', 409);
    const duplicate = await env.DB.prepare("SELECT id FROM company_invitations WHERE company_id=? AND department_id=? AND invitee_email=? AND permission=? AND status='pending' LIMIT 1").bind(params.companyId, input.departmentId, email, input.permission).first();
    if (duplicate) return errorResponse('PENDING_INVITATION_EXISTS', 409);
    const id = crypto.randomUUID(), rawToken = tokenValue(), tokenHash = await hashToken(rawToken), expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(), eventId = crypto.randomUUID();
    try {
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO company_invitations (id,company_id,department_id,invitee_email,permission,token_hash,status,expires_at,invited_by_user_id,created_at) VALUES (?,?,?,?,?,?,'pending',?,?,?)").bind(id, params.companyId, input.departmentId, email, input.permission, tokenHash, expiresAt, access.userId, now),
        env.DB.prepare("INSERT INTO company_access_events (id,company_id,department_id,actor_user_id,invitee_email,permission,action,created_at) VALUES (?,?,?,?,?,?,'invite_created',?)").bind(eventId, params.companyId, input.departmentId, access.userId, email, input.permission, now)
      ]);
      if (results.some(result => !result.success || result.meta?.changes !== 1)) throw new Error('insert');
    } catch (error) {
      if (String(error.message).toLowerCase().includes('unique')) return errorResponse('PENDING_INVITATION_EXISTS', 409);
      throw error;
    }
    return json({ ok: true, invitation: { id, inviteeEmail: email, departmentId: input.departmentId, permission: input.permission, status: 'pending', createdAt: now, expiresAt }, invitePath: `/?companyInvite=${rawToken}#mypage` }, 201);
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function invitationItem({ request, env, params }) {
  const rejected = guard(request, ['DELETE'], ['DELETE']); if (rejected) return rejected;
  let access; try { access = await requireCompanyAdmin(request, env, params.companyId); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (access.response) return access.response;
  if (!UUID.test(params.invitationId || '')) return errorResponse('NOT_FOUND', 404);
  try {
    const now = nowIso(), revocationId = crypto.randomUUID(), eventId = crypto.randomUUID();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE company_invitations SET status='revoked',revoked_at=?,revocation_id=? WHERE id=? AND company_id=? AND status='pending' AND julianday(expires_at)>julianday(?)").bind(now, revocationId, params.invitationId, params.companyId, now),
      env.DB.prepare("INSERT INTO company_access_events (id,company_id,department_id,actor_user_id,invitee_email,permission,action,created_at) SELECT ?,company_id,department_id,?,invitee_email,permission,'invite_revoked',? FROM company_invitations WHERE id=? AND company_id=? AND revocation_id=?").bind(eventId, access.userId, now, params.invitationId, params.companyId, revocationId)
    ]);
    if (results.some(result => !result.success || result.meta?.changes !== 1)) {
      await expireInvitations(env, params.companyId, now);
      const row = await env.DB.prepare('SELECT status FROM company_invitations WHERE id=? AND company_id=?').bind(params.invitationId, params.companyId).first();
      return errorResponse(row ? 'INVITATION_NOT_PENDING' : 'NOT_FOUND', row ? 409 : 404);
    }
    return json({ ok: true });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

async function invitationForToken(env, token, userId) {
  if (!TOKEN.test(token || '')) return null;
  return env.DB.prepare(`SELECT i.*,c.name AS company_name,c.status AS company_status,d.name AS department_name,d.status AS department_status,u.email AS user_email
    FROM company_invitations i INNER JOIN companies c ON c.id=i.company_id INNER JOIN company_departments d ON d.id=i.department_id CROSS JOIN users u
    WHERE i.token_hash=? AND u.id=? LIMIT 1`).bind(await hashToken(token), userId).first();
}

export async function acceptInvitation({ request, env, params }) {
  const rejected = guard(request, ['GET', 'POST'], ['POST']); if (rejected) return rejected;
  let userId; try { userId = await authenticate(request, env); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (!userId) return errorResponse('UNAUTHENTICATED', 401);
  try {
    if (request.method === 'POST') {
      let input; try { input = await body(request); } catch (error) { return bodyError(error); }
      if (!exact(input, [])) return errorResponse('INVALID_ACCEPTANCE', 400);
    }
    const invite = await invitationForToken(env, params.token, userId);
    if (!invite) return errorResponse('NOT_FOUND', 404);
    const email = normalizeEmail(invite.user_email);
    if (email !== invite.invitee_email) return errorResponse('INVITEE_EMAIL_MISMATCH', 403);
    const expired = Date.parse(invite.expires_at) <= Date.now();
    if (request.method === 'GET') return json({ ok: true, invitation: { companyName: invite.company_name, departmentName: invite.department_name, permission: invite.permission, status: expired && invite.status === 'pending' ? 'expired' : invite.status, expiresAt: invite.expires_at, inviteeEmail: invite.invitee_email } });
    if (invite.status !== 'pending' || expired) {
      if (expired && invite.status === 'pending') await env.DB.prepare("UPDATE company_invitations SET status='expired' WHERE id=? AND status='pending'").bind(invite.id).run();
      return errorResponse(expired ? 'INVITATION_EXPIRED' : 'INVITATION_NOT_PENDING', 409);
    }
    if (invite.company_status !== 'active' || invite.department_status !== 'active') return errorResponse('INVITATION_NOT_AVAILABLE', 409);
    const now = nowIso(), acceptanceId = crypto.randomUUID(), membershipId = crypto.randomUUID(), grantId = crypto.randomUUID();
    const acceptedEventId = crypto.randomUUID(), grantedEventId = crypto.randomUUID();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE company_invitations SET status='accepted',accepted_by_user_id=?,accepted_at=?,acceptance_id=? WHERE id=? AND status='pending' AND julianday(expires_at)>julianday(?)").bind(userId, now, acceptanceId, invite.id, now),
      env.DB.prepare(`INSERT INTO company_memberships (id,company_id,user_id,role,status,primary_department_id,position_title,created_at,updated_at)
        SELECT ?,company_id,?,'member','active',department_id,'',?,? FROM company_invitations WHERE id=? AND acceptance_id=?
        ON CONFLICT(company_id,user_id) DO UPDATE SET status='active',primary_department_id=COALESCE(company_memberships.primary_department_id,excluded.primary_department_id),updated_at=excluded.updated_at`).bind(membershipId, userId, now, now, invite.id, acceptanceId),
      env.DB.prepare(`INSERT INTO company_permission_grants (id,company_id,user_id,department_id,permission,status,granted_by_user_id,created_at,updated_at)
        SELECT ?,company_id,?,department_id,permission,'active',invited_by_user_id,?,? FROM company_invitations WHERE id=? AND acceptance_id=?
        ON CONFLICT(company_id,user_id,department_id,permission) DO UPDATE SET status='active',granted_by_user_id=excluded.granted_by_user_id,revoked_by_user_id=NULL,revocation_id=NULL,revoked_at=NULL,updated_at=excluded.updated_at`).bind(grantId, userId, now, now, invite.id, acceptanceId),
      env.DB.prepare("INSERT INTO company_access_events (id,company_id,department_id,actor_user_id,target_user_id,invitee_email,permission,action,created_at) SELECT ?,company_id,department_id,?,?,invitee_email,permission,'invite_accepted',? FROM company_invitations WHERE id=? AND acceptance_id=?").bind(acceptedEventId, userId, userId, now, invite.id, acceptanceId),
      env.DB.prepare("INSERT INTO company_access_events (id,company_id,department_id,actor_user_id,target_user_id,invitee_email,permission,action,created_at) SELECT ?,company_id,department_id,invited_by_user_id,?,invitee_email,permission,'permission_granted',? FROM company_invitations WHERE id=? AND acceptance_id=?").bind(grantedEventId, userId, now, invite.id, acceptanceId)
    ]);
    if (results.some(result => !result.success || result.meta?.changes !== 1)) return errorResponse('INVITATION_NOT_PENDING', 409);
    return json({ ok: true, companyId: invite.company_id, departmentId: invite.department_id, permission: invite.permission });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function members({ request, env, params }) {
  const rejected = guard(request, ['GET']); if (rejected) return rejected;
  let access; try { access = await requireCompanyAdmin(request, env, params.companyId); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (access.response) return access.response;
  try {
    const memberships = await env.DB.prepare(`SELECT m.id,m.user_id AS userId,u.name,u.email,m.role,m.status,m.position_title AS positionTitle
      FROM company_memberships m INNER JOIN users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY m.role,m.created_at,m.id`).bind(params.companyId).all();
    const grants = await env.DB.prepare(`SELECT g.id,g.user_id AS userId,g.permission,g.status,g.department_id AS departmentId,d.name AS departmentName
      FROM company_permission_grants g INNER JOIN company_departments d ON d.id=g.department_id WHERE g.company_id=? ORDER BY d.name,g.permission,g.id`).bind(params.companyId).all();
    const byUser = new Map(memberships.results.map(member => [member.userId, { ...member, assignments: [] }]));
    for (const grant of grants.results) byUser.get(grant.userId)?.assignments.push(grant);
    return json({ ok: true, members: [...byUser.values()] });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function permissionItem({ request, env, params }) {
  const rejected = guard(request, ['DELETE'], ['DELETE']); if (rejected) return rejected;
  let access; try { access = await requireCompanyAdmin(request, env, params.companyId); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (access.response) return access.response;
  if (!UUID.test(params.grantId || '')) return errorResponse('NOT_FOUND', 404);
  try {
    const now = nowIso(), revocationId = crypto.randomUUID(), eventId = crypto.randomUUID();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE company_permission_grants SET status='revoked',revoked_by_user_id=?,revoked_at=?,revocation_id=?,updated_at=? WHERE id=? AND company_id=? AND status='active'").bind(access.userId, now, revocationId, now, params.grantId, params.companyId),
      env.DB.prepare("INSERT INTO company_access_events (id,company_id,department_id,actor_user_id,target_user_id,permission,action,created_at) SELECT ?,company_id,department_id,?,user_id,permission,'permission_revoked',? FROM company_permission_grants WHERE id=? AND company_id=? AND revocation_id=?").bind(eventId, access.userId, now, params.grantId, params.companyId, revocationId)
    ]);
    if (results.some(result => !result.success || result.meta?.changes !== 1)) {
      const found = await env.DB.prepare('SELECT status FROM company_permission_grants WHERE id=? AND company_id=?').bind(params.grantId, params.companyId).first();
      return errorResponse(found ? 'PERMISSION_NOT_ACTIVE' : 'NOT_FOUND', found ? 409 : 404);
    }
    return json({ ok: true });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}

export async function myPermissions({ request, env }) {
  const rejected = guard(request, ['GET']); if (rejected) return rejected;
  let userId; try { userId = await authenticate(request, env); } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
  if (!userId) return errorResponse('UNAUTHENTICATED', 401);
  try {
    const rows = await env.DB.prepare(`SELECT g.id,g.company_id AS companyId,c.name AS companyName,g.department_id AS departmentId,d.name AS departmentName,g.permission,g.status
      FROM company_permission_grants g INNER JOIN companies c ON c.id=g.company_id INNER JOIN company_departments d ON d.id=g.department_id
      INNER JOIN company_memberships m ON m.company_id=g.company_id AND m.user_id=g.user_id
      WHERE g.user_id=? AND c.status='active' AND m.status='active' ORDER BY c.name,d.name,g.permission`).bind(userId).all();
    return json({ ok: true, permissions: rows.results });
  } catch { return errorResponse('INTERNAL_SERVER_ERROR', 500); }
}
