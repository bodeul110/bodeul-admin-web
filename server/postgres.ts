import "server-only";

import {Pool, type PoolConfig} from "pg";

import type {AppUserRole, HospitalGuideItem} from "./admin-hospital-guides";

type HospitalGuideRow = {
  readonly id: string;
  readonly hospital_name: string;
  readonly department_name: string;
  readonly steps: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

const globalForPostgres = globalThis as typeof globalThis & {
  bodeulAdminPool?: Pool;
};

export async function findRoleByFirebaseUid(firebaseUid: string): Promise<AppUserRole | null> {
  const result = await getAdminPool().query<{readonly role: unknown}>(
    "select role from bodeul.app_users where firebase_uid = $1 limit 1",
    [firebaseUid],
  );

  const role = result.rows[0]?.role;
  return isAppUserRole(role) ? role : null;
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
    ssl: isLocalDatabase ? false : {rejectUnauthorized: true},
  };
}

function isAppUserRole(value: unknown): value is AppUserRole {
  return value === "PATIENT" || value === "GUARDIAN" || value === "MANAGER" || value === "ADMIN";
}

function toTimestampString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
