import {
  authorizeAdmin,
  requireAdminRole,
  type AdminAuthorizationDependencies,
  type AdminDetailRole,
  type AdminErrorBody,
} from "./admin-auth.ts";
import type {AdminAuditCommand, AdminRoleAssignmentItem} from "./postgres.ts";

type RoleChangeInput = {
  readonly targetAdminUserId: string;
  readonly adminRole: AdminDetailRole;
  readonly reason: string;
};

type RoleRevokeInput = {
  readonly targetAdminUserId: string;
  readonly reason: string;
};

export type AdminRoleManagementDependencies = AdminAuthorizationDependencies & {
  readonly listAdminRoleAssignments: (actorAdminUserId: string) => Promise<readonly AdminRoleAssignmentItem[]>;
  readonly setAdminRoleAssignment: (
    targetAdminUserId: string,
    adminRole: AdminDetailRole,
    actorAdminUserId: string,
    reason: string,
  ) => Promise<void>;
  readonly revokeAdminRoleAssignment: (
    targetAdminUserId: string,
    actorAdminUserId: string,
    reason: string,
  ) => Promise<void>;
  readonly recordAdminAccessAudit: (command: AdminAuditCommand) => Promise<string>;
};

export type AdminRoleManagementResult = {
  readonly status: number;
  readonly body: {readonly items: readonly AdminRoleAssignmentItem[]} | {readonly updated: true} | AdminErrorBody;
};

export async function handleListAdminRoleAssignments(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  dependencies: AdminRoleManagementDependencies,
): Promise<AdminRoleManagementResult> {
  const authorization = await authorizeSuperAdmin(authorizationHeader, appCheckHeader, dependencies, {
    action: "VIEW",
    resourceType: "ADMIN_ROLE_ASSIGNMENT",
    resourceId: "all",
    reason: "관리자 역할 목록 접근 권한이 없습니다.",
  });
  if (!authorization.ok) {
    return authorization.failure;
  }
  try {
    const items = await dependencies.listAdminRoleAssignments(authorization.actor.id);
    await dependencies.recordAdminAccessAudit({
      actorAdminUserId: authorization.actor.id,
      action: "VIEW",
      resourceType: "ADMIN_ROLE_ASSIGNMENT",
      resourceId: "all",
      reason: "",
      outcome: "ALLOWED",
      metadata: {count: items.length},
    });
    return {
      status: 200,
      body: {items},
    };
  } catch {
    return auditedFailure(
      dependencies,
      authorization.actor.id,
      {
        action: "VIEW",
        resourceType: "ADMIN_ROLE_ASSIGNMENT",
        resourceId: "all",
        reason: "관리자 역할 목록 조회에 실패했습니다.",
      },
      "FAILED",
      failure(503, "admin_roles_lookup_failed", "관리자 역할 목록을 불러오지 못했습니다."),
    );
  }
}

export async function handleSetAdminRoleAssignment(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  requestBody: unknown,
  dependencies: AdminRoleManagementDependencies,
): Promise<AdminRoleManagementResult> {
  const requestedTargetId = requestTargetId(requestBody);
  const authorization = await authorizeSuperAdmin(authorizationHeader, appCheckHeader, dependencies, {
    action: "ROLE_CHANGE",
    resourceType: "ADMIN_ROLE_ASSIGNMENT",
    resourceId: requestedTargetId,
    reason: "관리자 역할 변경 권한이 없습니다.",
  });
  if (!authorization.ok) {
    return authorization.failure;
  }
  const input = parseRoleChangeInput(requestBody);
  if (!input.ok) {
    return auditedFailure(
      dependencies,
      authorization.actor.id,
      roleFailureCommand(requestedTargetId, "관리자 역할 변경 요청 형식이 거부되었습니다.", input.failure),
      "DENIED",
      input.failure,
    );
  }
  try {
    await dependencies.setAdminRoleAssignment(
      input.value.targetAdminUserId,
      input.value.adminRole,
      authorization.actor.id,
      input.value.reason,
    );
    return {status: 200, body: {updated: true}};
  } catch (error) {
    const mapped = mapRoleMutationFailure(error);
    return auditedFailure(
      dependencies,
      authorization.actor.id,
      roleFailureCommand(input.value.targetAdminUserId, "관리자 역할 변경 요청이 처리되지 않았습니다.", mapped),
      mapped.status === 503 ? "FAILED" : "DENIED",
      mapped,
    );
  }
}

export async function handleRevokeAdminRoleAssignment(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  requestBody: unknown,
  dependencies: AdminRoleManagementDependencies,
): Promise<AdminRoleManagementResult> {
  const requestedTargetId = requestTargetId(requestBody);
  const authorization = await authorizeSuperAdmin(authorizationHeader, appCheckHeader, dependencies, {
    action: "ROLE_CHANGE",
    resourceType: "ADMIN_ROLE_ASSIGNMENT",
    resourceId: requestedTargetId,
    reason: "관리자 역할 회수 권한이 없습니다.",
  });
  if (!authorization.ok) {
    return authorization.failure;
  }
  const input = parseRoleRevokeInput(requestBody);
  if (!input.ok) {
    return auditedFailure(
      dependencies,
      authorization.actor.id,
      roleFailureCommand(requestedTargetId, "관리자 역할 회수 요청 형식이 거부되었습니다.", input.failure),
      "DENIED",
      input.failure,
    );
  }
  try {
    await dependencies.revokeAdminRoleAssignment(
      input.value.targetAdminUserId,
      authorization.actor.id,
      input.value.reason,
    );
    return {status: 200, body: {updated: true}};
  } catch (error) {
    const mapped = mapRoleMutationFailure(error);
    return auditedFailure(
      dependencies,
      authorization.actor.id,
      roleFailureCommand(input.value.targetAdminUserId, "관리자 역할 회수 요청이 처리되지 않았습니다.", mapped),
      mapped.status === 503 ? "FAILED" : "DENIED",
      mapped,
    );
  }
}

async function authorizeSuperAdmin(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  dependencies: AdminRoleManagementDependencies,
  deniedCommand: Omit<AdminAuditCommand, "actorAdminUserId" | "outcome">,
) {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) {
    return authorization;
  }
  const roleFailure = requireAdminRole(authorization.actor, ["SUPER_ADMIN"]);
  if (!roleFailure) return authorization;
  try {
    await dependencies.recordAdminAccessAudit({
      ...deniedCommand,
      actorAdminUserId: authorization.actor.id,
      outcome: "DENIED",
    });
    return {ok: false as const, failure: roleFailure};
  } catch {
    return {ok: false as const, failure: failure(
      503, "admin_audit_failed", "권한 거부 감사 기록을 남기지 못해 요청을 중단했습니다.",
    )};
  }
}

async function auditedFailure(
  dependencies: AdminRoleManagementDependencies,
  actorAdminUserId: string,
  command: Omit<AdminAuditCommand, "actorAdminUserId" | "outcome">,
  outcome: "DENIED" | "FAILED",
  originalFailure: AdminRoleManagementResult,
): Promise<AdminRoleManagementResult> {
  try {
    await dependencies.recordAdminAccessAudit({...command, actorAdminUserId, outcome});
    return originalFailure;
  } catch {
    return failure(503, "admin_audit_failed", "관리자 감사 기록을 남기지 못해 요청을 중단했습니다.");
  }
}

function roleFailureCommand(
  resourceId: string,
  reason: string,
  result: AdminRoleManagementResult,
): Omit<AdminAuditCommand, "actorAdminUserId" | "outcome"> {
  return {
    action: "ROLE_CHANGE",
    resourceType: "ADMIN_ROLE_ASSIGNMENT",
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

function parseRoleChangeInput(value: unknown):
  | {readonly ok: true; readonly value: RoleChangeInput}
  | {readonly ok: false; readonly failure: AdminRoleManagementResult} {
  if (!isRecord(value)) {
    return invalidInput("요청 본문은 JSON 객체여야 합니다.");
  }
  const targetAdminUserId = readString(value.targetAdminUserId);
  const reason = readString(value.reason);
  if (!UUID_PATTERN.test(targetAdminUserId)) {
    return invalidInput("targetAdminUserId는 유효한 UUID여야 합니다.");
  }
  if (!isAdminDetailRole(value.adminRole)) {
    return invalidInput("adminRole은 SUPER_ADMIN, OPERATIONS, DEVELOPER 중 하나여야 합니다.");
  }
  if (!validReason(reason)) {
    return invalidInput("권한 변경 사유는 10자부터 500자까지 입력해야 합니다.");
  }
  return {ok: true, value: {targetAdminUserId, adminRole: value.adminRole, reason}};
}

function parseRoleRevokeInput(value: unknown):
  | {readonly ok: true; readonly value: RoleRevokeInput}
  | {readonly ok: false; readonly failure: AdminRoleManagementResult} {
  if (!isRecord(value)) {
    return invalidInput("요청 본문은 JSON 객체여야 합니다.");
  }
  const targetAdminUserId = readString(value.targetAdminUserId);
  const reason = readString(value.reason);
  if (!UUID_PATTERN.test(targetAdminUserId) || !validReason(reason)) {
    return invalidInput("대상 관리자 UUID와 10~500자 회수 사유를 확인해 주세요.");
  }
  return {ok: true, value: {targetAdminUserId, reason}};
}

function mapRoleMutationFailure(error: unknown): AdminRoleManagementResult {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "42501") {
    return failure(403, "super_admin_required", "최고 관리자 권한이 필요합니다.");
  }
  if (code === "22023" || code === "23503") {
    return failure(400, "invalid_admin_role_change", "대상 계정, 역할과 사유를 확인해 주세요.");
  }
  if (code === "P0002") {
    return failure(404, "admin_role_not_found", "활성 관리자 역할을 찾지 못했습니다.");
  }
  if (code === "P0001") {
    return failure(409, "last_super_admin_protected", "마지막 최고 관리자 권한은 변경하거나 회수할 수 없습니다.");
  }
  return failure(503, "admin_role_change_failed", "관리자 역할을 변경하지 못했습니다.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validReason(value: string): boolean {
  return value.length >= 10 && value.length <= 500;
}

function isAdminDetailRole(value: unknown): value is AdminDetailRole {
  return value === "SUPER_ADMIN" || value === "OPERATIONS" || value === "DEVELOPER";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message: string): {readonly ok: false; readonly failure: AdminRoleManagementResult} {
  return {ok: false, failure: failure(400, "invalid_admin_role_request", message)};
}

function failure(status: number, error: string, message: string): AdminRoleManagementResult {
  return {status, body: {error, message}};
}
