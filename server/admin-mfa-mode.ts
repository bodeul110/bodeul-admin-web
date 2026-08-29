import type {AdminMfaMode} from "./admin-auth.ts";

export function resolveAdminMfaMode(
  value: string | undefined,
  enforceReady: string | undefined,
): AdminMfaMode {
  const normalized = value?.trim().toLowerCase() || "observe";
  if (normalized !== "off" && normalized !== "observe" && normalized !== "enforce") {
    throw new Error("ADMIN_MFA_MODE는 off, observe, enforce 중 하나여야 합니다.");
  }
  if (normalized === "enforce" && enforceReady?.trim().toLowerCase() !== "true") {
    throw new Error("MFA 강제 전환 전 ADMIN_MFA_ENFORCE_READY=true 확인이 필요합니다.");
  }
  return normalized;
}
