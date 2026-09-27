import type { User as FirebaseUser } from "firebase/auth";
import type { AdminAccessContextPayload, AdminDetailRole, AdminPermission } from "./bodeulApi";

export type AdminSessionResult = {
  adminName: string;
  adminRole: AdminDetailRole;
  permissions: readonly AdminPermission[];
  breakGlassExpiresAt: string | null;
};

export async function resolveAdminSession(
  user: FirebaseUser,
  fetchAccessContext: (user: FirebaseUser) => Promise<AdminAccessContextPayload>,
): Promise<AdminSessionResult> {
  // 관리자 인가는 서버의 PostgreSQL 역할 확인으로만 판정한다.
  const accessContext = await fetchAccessContext(user);
  return {
    adminName: user.displayName?.trim() || "관리자",
    adminRole: accessContext.role,
    permissions: accessContext.permissions,
    breakGlassExpiresAt: accessContext.breakGlassExpiresAt,
  };
}

export function adminSessionErrorMessage(code?: string): string {
  switch (code) {
    case "admin_role_required":
      return "이 계정에 관리자 권한이 등록되어 있지 않습니다. 운영 담당자에게 권한 등록을 요청해 주세요.";
    case "admin_detail_role_required":
      return "활성 관리자 업무 역할이 없습니다. 운영 담당자에게 권한을 확인해 주세요.";
    case "admin_mfa_required":
      return "관리자 2차 인증이 필요한 세션입니다. 인증 앱 등록 여부를 확인한 뒤 다시 로그인해 주세요.";
    case "role_lookup_failed":
      return "관리자 권한을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return "관리자 세션을 확인하지 못했습니다.";
  }
}
