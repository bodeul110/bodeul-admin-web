import {
  authorizeAdmin,
  requireAdminRole,
  type AdminAuthorizationDependencies,
  type AdminErrorBody,
} from "./admin-auth.ts";
import type {AdminAuditItem} from "./postgres.ts";

export type AdminAuditsDependencies = AdminAuthorizationDependencies & {
  readonly listAdminAccessAudits: (actorAdminUserId: string, limit: number) => Promise<readonly AdminAuditItem[]>;
};

export type AdminAuditsResult = {
  readonly status: number;
  readonly body: {readonly items: readonly AdminAuditItem[]; readonly limit: number} | AdminErrorBody;
};

export async function handleAdminAudits(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  rawLimit: string | null,
  dependencies: AdminAuditsDependencies,
): Promise<AdminAuditsResult> {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
  }
  const roleFailure = requireAdminRole(authorization.actor, ["SUPER_ADMIN"]);
  if (roleFailure) {
    return roleFailure;
  }
  const limit = rawLimit === null || rawLimit === "" ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return {status: 400, body: {error: "invalid_audit_limit", message: "limit은 1부터 200 사이의 정수여야 합니다."}};
  }
  try {
    return {
      status: 200,
      body: {
        items: await dependencies.listAdminAccessAudits(authorization.actor.id, limit),
        limit,
      },
    };
  } catch {
    return {status: 503, body: {error: "admin_audit_lookup_failed", message: "관리자 감사 기록을 불러오지 못했습니다."}};
  }
}
