import {
  authorizeAdmin,
  type AdminAuthorizationDependencies,
  type AdminDetailRole,
  type AdminErrorBody,
} from "./admin-auth.ts";

export type AdminPermission =
  | "OPERATIONS_READ"
  | "MANAGER_REVIEW"
  | "RAW_PREVIEW"
  | "RAW_DOWNLOAD"
  | "ROLE_MANAGEMENT"
  | "DEVELOPER_DIAGNOSTICS";

export type AdminAccessContextPayload = {
  readonly adminUserId: string;
  readonly role: AdminDetailRole;
  readonly permissions: readonly AdminPermission[];
  readonly breakGlassExpiresAt: string | null;
};

export type AdminAccessContextResult = {
  readonly status: number;
  readonly body: AdminAccessContextPayload | AdminErrorBody;
};

export async function handleAdminAccessContext(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  dependencies: AdminAuthorizationDependencies,
): Promise<AdminAccessContextResult> {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
  }

  const role = authorization.actor.adminRole;
  if (!role) {
    return {
      status: 403,
      body: {
        error: "admin_detail_role_required",
        message: "활성 관리자 업무 역할이 필요합니다.",
      },
    };
  }

  return {
    status: 200,
    body: {
      adminUserId: authorization.actor.id,
      role,
      permissions: permissionsFor(role, authorization.actor.breakGlassExpiresAt),
      breakGlassExpiresAt: authorization.actor.breakGlassExpiresAt,
    },
  };
}

function permissionsFor(
  role: AdminDetailRole,
  breakGlassExpiresAt: string | null,
): readonly AdminPermission[] {
  if (role === "SUPER_ADMIN") {
    const permissions: AdminPermission[] = [
      "OPERATIONS_READ",
      "MANAGER_REVIEW",
      "RAW_PREVIEW",
      "ROLE_MANAGEMENT",
    ];
    if (isActiveBreakGlass(breakGlassExpiresAt)) {
      permissions.push("RAW_DOWNLOAD");
    }
    return permissions;
  }
  if (role === "OPERATIONS") {
    return ["OPERATIONS_READ", "MANAGER_REVIEW", "RAW_PREVIEW"];
  }
  return ["DEVELOPER_DIAGNOSTICS"];
}

function isActiveBreakGlass(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed > Date.now();
}
