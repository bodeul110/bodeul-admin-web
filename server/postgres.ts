import "server-only";

import {Pool, type PoolConfig} from "pg";

import type {AppUserIdentity, AppUserRole} from "./admin-auth";
import type {CompanionAssignmentCommand} from "./admin-companion-assignments";
import type {HospitalGuideItem} from "./admin-hospital-guides";
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

function toTimestampString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
