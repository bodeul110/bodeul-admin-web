import "server-only";

import {Pool, type PoolConfig} from "pg";

import type {AppUserIdentity, AppUserRole} from "./admin-auth";
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
  readonly id: string;
  readonly role: unknown;
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
    "select id, role from bodeul.app_users where firebase_uid = $1 limit 1",
    [firebaseUid],
  );

  const row = result.rows[0];
  return row && isAppUserRole(row.role)
    ? {id: String(row.id), role: row.role}
    : null;
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
