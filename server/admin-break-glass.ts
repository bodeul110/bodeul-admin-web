import {
  authorizeAdmin,
  requireAdminRole,
  type AdminAuthorizationDependencies,
  type AdminErrorBody,
} from "./admin-auth.ts";
import type {AdminAuditCommand} from "./postgres.ts";

export type AdminBreakGlassDependencies = AdminAuthorizationDependencies & {
  readonly grantAdminBreakGlass: (
    targetAdminUserId: string,
    actorAdminUserId: string,
    reason: string,
    durationMinutes: number,
  ) => Promise<string>;
  readonly revokeAdminBreakGlass: (
    grantId: string,
    actorAdminUserId: string,
    reason: string,
  ) => Promise<boolean>;
  readonly recordAdminAccessAudit: (command: AdminAuditCommand) => Promise<string>;
};

export type AdminBreakGlassResult = {
  readonly status: number;
  readonly body: {readonly grantId: string} | {readonly revoked: true} | AdminErrorBody;
};

export async function handleGrantAdminBreakGlass(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  requestBody: unknown,
  dependencies: AdminBreakGlassDependencies,
): Promise<AdminBreakGlassResult> {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
  }
  const roleFailure = requireAdminRole(authorization.actor, ["SUPER_ADMIN"]);
  if (roleFailure) {
    return auditedFailure(dependencies, authorization.actor.id, {
      action: "BREAK_GLASS_GRANT",
      resourceType: "ADMIN_BREAK_GLASS",
      resourceId: requestTargetId(requestBody),
      reason: "긴급 접근 승인 권한이 없습니다.",
    }, "DENIED", roleFailure);
  }
  if (!isRecord(requestBody)) {
    const invalid = failure(400, "invalid_break_glass_request", "요청 본문은 JSON 객체여야 합니다.");
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_GRANT", "invalid", "긴급 접근 승인 요청 형식이 거부되었습니다.", invalid,
    ), "DENIED", invalid);
  }
  const targetAdminUserId = readString(requestBody.targetAdminUserId);
  const reason = readString(requestBody.reason);
  const durationMinutes = requestBody.durationMinutes;
  if (!UUID_PATTERN.test(targetAdminUserId)
      || reason.length < 10 || reason.length > 500
      || !Number.isInteger(durationMinutes) || Number(durationMinutes) < 1 || Number(durationMinutes) > 60) {
    const invalid = failure(400, "invalid_break_glass_request", "대상 UUID, 10~500자 사유와 1~60분 만료 시간을 확인해 주세요.");
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_GRANT",
      UUID_PATTERN.test(targetAdminUserId) ? targetAdminUserId : "invalid",
      "긴급 접근 승인 요청 형식이 거부되었습니다.",
      invalid,
    ), "DENIED", invalid);
  }
  try {
    const grantId = await dependencies.grantAdminBreakGlass(
      targetAdminUserId,
      authorization.actor.id,
      reason,
      Number(durationMinutes),
    );
    return {status: 201, body: {grantId}};
  } catch (error) {
    const mapped = mapFailure(error);
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_GRANT", targetAdminUserId, "긴급 접근 승인 요청이 처리되지 않았습니다.", mapped,
    ), mapped.status === 503 ? "FAILED" : "DENIED", mapped);
  }
}

export async function handleRevokeAdminBreakGlass(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  requestBody: unknown,
  dependencies: AdminBreakGlassDependencies,
): Promise<AdminBreakGlassResult> {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
  }
  const roleFailure = requireAdminRole(authorization.actor, ["SUPER_ADMIN"]);
  if (roleFailure) {
    return auditedFailure(dependencies, authorization.actor.id, {
      action: "BREAK_GLASS_REVOKE",
      resourceType: "ADMIN_BREAK_GLASS",
      resourceId: requestGrantId(requestBody),
      reason: "긴급 접근 회수 권한이 없습니다.",
    }, "DENIED", roleFailure);
  }
  if (!isRecord(requestBody)) {
    const invalid = failure(400, "invalid_break_glass_request", "요청 본문은 JSON 객체여야 합니다.");
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_REVOKE", "invalid", "긴급 접근 회수 요청 형식이 거부되었습니다.", invalid,
    ), "DENIED", invalid);
  }
  const grantId = readString(requestBody.grantId);
  const reason = readString(requestBody.reason);
  if (!UUID_PATTERN.test(grantId) || reason.length < 10 || reason.length > 500) {
    const invalid = failure(400, "invalid_break_glass_request", "승인 UUID와 10~500자 회수 사유를 확인해 주세요.");
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_REVOKE",
      UUID_PATTERN.test(grantId) ? grantId : "invalid",
      "긴급 접근 회수 요청 형식이 거부되었습니다.",
      invalid,
    ), "DENIED", invalid);
  }
  try {
    const revoked = await dependencies.revokeAdminBreakGlass(grantId, authorization.actor.id, reason);
    if (revoked) return {status: 200, body: {revoked: true}};
    const notFound = failure(404, "active_break_glass_not_found", "활성 긴급 접근 승인을 찾지 못했습니다.");
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_REVOKE", grantId, "활성 긴급 접근 승인을 찾지 못했습니다.", notFound,
    ), "DENIED", notFound);
  } catch (error) {
    const mapped = mapFailure(error);
    return auditedFailure(dependencies, authorization.actor.id, failureCommand(
      "BREAK_GLASS_REVOKE", grantId, "긴급 접근 회수 요청이 처리되지 않았습니다.", mapped,
    ), mapped.status === 503 ? "FAILED" : "DENIED", mapped);
  }
}

async function auditedFailure(
  dependencies: AdminBreakGlassDependencies,
  actorAdminUserId: string,
  command: Omit<AdminAuditCommand, "actorAdminUserId" | "outcome">,
  outcome: "DENIED" | "FAILED",
  originalFailure: AdminBreakGlassResult,
): Promise<AdminBreakGlassResult> {
  try {
    await dependencies.recordAdminAccessAudit({...command, actorAdminUserId, outcome});
    return originalFailure;
  } catch {
    return failure(503, "admin_audit_failed", "관리자 감사 기록을 남기지 못해 요청을 중단했습니다.");
  }
}

function failureCommand(
  action: "BREAK_GLASS_GRANT" | "BREAK_GLASS_REVOKE",
  resourceId: string,
  reason: string,
  result: AdminBreakGlassResult,
): Omit<AdminAuditCommand, "actorAdminUserId" | "outcome"> {
  return {
    action,
    resourceType: "ADMIN_BREAK_GLASS",
    resourceId,
    reason,
    metadata: {failureCode: "error" in result.body ? result.body.error : "unknown"},
  };
}

function requestTargetId(value: unknown): string {
  if (!isRecord(value)) return "invalid";
  const targetAdminUserId = readString(value.targetAdminUserId);
  return UUID_PATTERN.test(targetAdminUserId) ? targetAdminUserId : "invalid";
}

function requestGrantId(value: unknown): string {
  if (!isRecord(value)) return "invalid";
  const grantId = readString(value.grantId);
  return UUID_PATTERN.test(grantId) ? grantId : "invalid";
}

function mapFailure(error: unknown): AdminBreakGlassResult {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "42501") {
    return failure(403, "break_glass_forbidden", "긴급 접근 승인 조건을 충족하지 못했습니다.");
  }
  if (code === "22023") {
    return failure(400, "invalid_break_glass_request", "긴급 접근 요청 값을 확인해 주세요.");
  }
  if (code === "P0002") {
    return failure(404, "admin_role_not_found", "대상의 활성 최고 관리자 역할을 찾지 못했습니다.");
  }
  return failure(503, "break_glass_change_failed", "긴급 접근 권한을 변경하지 못했습니다.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function readString(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function failure(status: number, error: string, message: string): AdminBreakGlassResult {
  return {status, body: {error, message}};
}
