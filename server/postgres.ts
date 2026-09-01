import "server-only";

import {Pool, type PoolConfig} from "pg";

import type {AdminDetailRole, AppUserIdentity, AppUserRole} from "./admin-auth";
import type {CompanionAssignmentCommand} from "./admin-companion-assignments";
import type {HospitalGuideItem} from "./admin-hospital-guides";
import type {
  AppointmentPublicCodeLookup,
  AppointmentPublicCodeSearchItem,
} from "./admin-appointment-search";
import {SUPABASE_ROOT_CA} from "./supabase-root-ca";

type HospitalGuideRow = {
  readonly id: string;
  readonly hospital_name: string;
  readonly department_name: string;
  readonly steps: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

type AppUserRow = {
  readonly app_user_id: string;
  readonly app_role: unknown;
  readonly admin_role: unknown;
  readonly break_glass_expires_at: Date | string | null;
};

type AppointmentPublicCodeSearchRow = {
  readonly lookup_status: "FOUND" | "NOT_FOUND" | "RATE_LIMITED";
  readonly appointment_request_id: string | null;
  readonly public_code: string | null;
  readonly appointment_status: string | null;
  readonly appointment_at: Date | string | null;
  readonly hospital_name: string | null;
  readonly department_name: string | null;
  readonly patient_name: string | null;
  readonly guardian_name: string | null;
  readonly manager_user_id: string | null;
  readonly manager_name: string | null;
};

const globalForPostgres = globalThis as typeof globalThis & {
  bodeulAdminPool?: Pool;
};

export async function findAppUserByFirebaseUid(firebaseUid: string): Promise<AppUserIdentity | null> {
  const result = await getAdminPool().query<AppUserRow>(
    [
      "select app_user_id, app_role, admin_role, break_glass_expires_at",
      "from bodeul.resolve_admin_authorization($1::text)",
    ].join(" "),
    [firebaseUid],
  );

  const row = result.rows[0];
  return row && isAppUserRole(row.app_role)
    ? {
        id: String(row.app_user_id),
        role: row.app_role,
        adminRole: isAdminDetailRole(row.admin_role) ? row.admin_role : null,
        breakGlassExpiresAt: row.break_glass_expires_at
          ? toTimestampString(row.break_glass_expires_at)
          : null,
      }
    : null;
}

export type AdminAuditCommand = {
  readonly actorAdminUserId: string;
  readonly action:
    | "VIEW"
    | "RAW_VIEW"
    | "DOWNLOAD"
    | "UPDATE"
    | "DELETE"
    | "ROLE_CHANGE"
    | "BREAK_GLASS_GRANT"
    | "BREAK_GLASS_REVOKE";
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason: string;
  readonly outcome: "ALLOWED" | "DENIED" | "FAILED";
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly operationId?: string;
};

export async function recordAdminAccessAudit(command: AdminAuditCommand): Promise<string> {
  const result = await getAdminPool().query<{readonly audit_id: string}>(
    [
      "select bodeul.record_admin_access_audit(",
      "$1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::uuid",
      ") as audit_id",
    ].join(" "),
    [
      command.actorAdminUserId,
      command.action,
      command.resourceType,
      command.resourceId,
      command.reason,
      command.outcome,
      JSON.stringify(command.metadata || {}),
      command.operationId || null,
    ],
  );
  const auditId = result.rows[0]?.audit_id;
  if (!auditId) {
    throw new Error("관리자 감사 함수가 ID를 반환하지 않았습니다.");
  }
  return String(auditId);
}

export type AdminRoleAssignmentItem = {
  readonly adminUserId: string;
  readonly adminRole: AdminDetailRole;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
  readonly breakGlassGrantId: string | null;
  readonly breakGlassExpiresAt: string | null;
};

type AdminRoleAssignmentRow = {
  readonly admin_user_id: string;
  readonly admin_role: unknown;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
  readonly break_glass_grant_id: string | null;
  readonly break_glass_expires_at: Date | string | null;
};

export async function listAdminRoleAssignments(
  actorAdminUserId: string,
): Promise<readonly AdminRoleAssignmentItem[]> {
  const result = await getAdminPool().query<AdminRoleAssignmentRow>(
    "select * from bodeul.list_admin_role_assignments($1::uuid)",
    [actorAdminUserId],
  );
  return result.rows.flatMap((row) => isAdminDetailRole(row.admin_role) ? [{
    adminUserId: String(row.admin_user_id),
    adminRole: row.admin_role,
    grantedAt: toTimestampString(row.granted_at),
    revokedAt: row.revoked_at ? toTimestampString(row.revoked_at) : null,
    breakGlassGrantId: row.break_glass_grant_id ? String(row.break_glass_grant_id) : null,
    breakGlassExpiresAt: row.break_glass_expires_at
      ? toTimestampString(row.break_glass_expires_at)
      : null,
  }] : []);
}

export async function setAdminRoleAssignment(
  targetAdminUserId: string,
  adminRole: AdminDetailRole,
  actorAdminUserId: string,
  reason: string,
): Promise<void> {
  await getAdminPool().query(
    "select bodeul.set_admin_role_assignment($1::uuid, $2::text, $3::uuid, $4::text)",
    [targetAdminUserId, adminRole, actorAdminUserId, reason],
  );
}

export async function revokeAdminRoleAssignment(
  targetAdminUserId: string,
  actorAdminUserId: string,
  reason: string,
): Promise<void> {
  await getAdminPool().query(
    "select bodeul.revoke_admin_role_assignment($1::uuid, $2::uuid, $3::text)",
    [targetAdminUserId, actorAdminUserId, reason],
  );
}

export async function grantAdminBreakGlass(
  targetAdminUserId: string,
  actorAdminUserId: string,
  reason: string,
  durationMinutes: number,
): Promise<string> {
  const result = await getAdminPool().query<{readonly grant_id: string}>(
    "select bodeul.grant_admin_break_glass($1::uuid, $2::uuid, $3::text, $4::integer) as grant_id",
    [targetAdminUserId, actorAdminUserId, reason, durationMinutes],
  );
  const grantId = result.rows[0]?.grant_id;
  if (!grantId) {
    throw new Error("긴급 접근 승인 함수가 ID를 반환하지 않았습니다.");
  }
  return String(grantId);
}

export async function revokeAdminBreakGlass(
  grantId: string,
  actorAdminUserId: string,
  reason: string,
): Promise<boolean> {
  const result = await getAdminPool().query<{readonly revoked: boolean}>(
    "select bodeul.revoke_admin_break_glass($1::uuid, $2::uuid, $3::text) as revoked",
    [grantId, actorAdminUserId, reason],
  );
  return result.rows[0]?.revoked === true;
}

export type AdminAuditItem = {
  readonly id: string;
  readonly actorAdminUserId: string;
  readonly actorAdminRole: AdminDetailRole;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason: string;
  readonly outcome: string;
  readonly createdAt: string;
};

type AdminAuditRow = {
  readonly audit_id: string;
  readonly audited_actor_admin_user_id: string;
  readonly audited_actor_admin_role: unknown;
  readonly audited_action: string;
  readonly audited_resource_type: string;
  readonly audited_resource_id: string;
  readonly audited_reason: string;
  readonly audited_outcome: string;
  readonly audited_at: Date | string;
};

export async function listAdminAccessAudits(
  actorAdminUserId: string,
  limit: number,
): Promise<readonly AdminAuditItem[]> {
  const result = await getAdminPool().query<AdminAuditRow>(
    "select * from bodeul.list_admin_access_audits($1::uuid, $2::integer)",
    [actorAdminUserId, limit],
  );
  return result.rows.flatMap((row) => isAdminDetailRole(row.audited_actor_admin_role) ? [{
    id: String(row.audit_id),
    actorAdminUserId: String(row.audited_actor_admin_user_id),
    actorAdminRole: row.audited_actor_admin_role,
    action: String(row.audited_action),
    resourceType: String(row.audited_resource_type),
    resourceId: String(row.audited_resource_id),
    reason: String(row.audited_reason),
    outcome: String(row.audited_outcome),
    createdAt: toTimestampString(row.audited_at),
  }] : []);
}

export async function assignCompanionSession(command: CompanionAssignmentCommand): Promise<string> {
  const result = await getAdminPool().query<{readonly session_id: string}>(
    [
      "select bodeul.assign_companion_session(",
      "$1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text",
      ") as session_id",
    ].join(" "),
    [
      command.appointmentRequestId,
      command.managerUserId,
      command.actorAdminUserId,
      command.expectedAppointmentVersion,
      command.reason,
    ],
  );

  const sessionId = result.rows[0]?.session_id;
  if (!sessionId) {
    throw new Error("배정 함수가 세션 ID를 반환하지 않았습니다.");
  }
  return String(sessionId);
}

export async function findAppointmentByPublicCode(
  actorAdminUserId: string,
  publicCode: string,
): Promise<AppointmentPublicCodeLookup> {
  const result = await getAdminPool().query<AppointmentPublicCodeSearchRow>(
    "select * from bodeul.search_appointment_by_public_code($1::uuid, $2::text)",
    [actorAdminUserId, publicCode],
  );
  const row = result.rows[0];
  if (!row || row.lookup_status !== "FOUND") {
    return {
      status: row?.lookup_status === "RATE_LIMITED" ? "RATE_LIMITED" : "NOT_FOUND",
      item: null,
    };
  }

  const item: AppointmentPublicCodeSearchItem = {
    id: requiredDatabaseText(row.appointment_request_id, "appointment_request_id"),
    publicCode: requiredDatabaseText(row.public_code, "public_code"),
    status: requiredDatabaseText(row.appointment_status, "appointment_status"),
    appointmentAt: toTimestampString(row.appointment_at),
    hospitalName: requiredDatabaseText(row.hospital_name, "hospital_name"),
    departmentName: requiredDatabaseText(row.department_name, "department_name"),
    patientName: row.patient_name || "",
    guardianName: row.guardian_name || "",
    managerUserId: row.manager_user_id || "",
    managerName: row.manager_name || "",
  };
  return {status: "FOUND", item};
}

export async function listHospitalGuides(limit: number): Promise<readonly HospitalGuideItem[]> {
  const result = await getAdminPool().query<HospitalGuideRow>(
    [
      "select id, hospital_name, department_name, steps, created_at, updated_at",
      "from bodeul.hospital_guides",
      "order by updated_at desc, hospital_name asc, department_name asc",
      "limit $1",
    ].join(" "),
    [limit],
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    hospitalName: String(row.hospital_name),
    departmentName: String(row.department_name),
    steps: Array.isArray(row.steps) ? row.steps : [],
    createdAt: toTimestampString(row.created_at),
    updatedAt: toTimestampString(row.updated_at),
  }));
}

function getAdminPool(): Pool {
  if (!globalForPostgres.bodeulAdminPool) {
    globalForPostgres.bodeulAdminPool = new Pool(createPoolConfig());
  }

  return globalForPostgres.bodeulAdminPool;
}

function createPoolConfig(): PoolConfig {
  const connectionString = process.env.ADMIN_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("ADMIN_DATABASE_URL이 설정되지 않았습니다.");
  }

  const hostname = new URL(connectionString).hostname.toLowerCase();
  const isLocalDatabase = hostname === "localhost" || hostname === "127.0.0.1";

  return {
    connectionString,
    application_name: "bodeul-admin-web",
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    ssl: isLocalDatabase
      ? false
      : {
          ca: SUPABASE_ROOT_CA,
          rejectUnauthorized: true,
        },
  };
}

function isAppUserRole(value: unknown): value is AppUserRole {
  return value === "PATIENT" || value === "GUARDIAN" || value === "MANAGER" || value === "ADMIN";
}

function isAdminDetailRole(value: unknown): value is AdminDetailRole {
  return value === "SUPER_ADMIN" || value === "OPERATIONS" || value === "DEVELOPER";
}

function toTimestampString(value: Date | string | null): string {
  if (value === null) {
    return "";
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function requiredDatabaseText(value: string | null, fieldName: string): string {
  const normalized = value?.trim() || "";
  if (!normalized) {
    throw new Error(`예약 코드 검색 응답에 ${fieldName} 값이 없습니다.`);
  }
  return normalized;
}
