import {useCallback, useEffect, useMemo, useState} from "react";
import type {User as FirebaseUser} from "firebase/auth";

import {
  fetchAdminAudits,
  fetchAdminRoleAssignments,
  grantAdminBreakGlassAccess,
  revokeAdminBreakGlassAccess,
  revokeAdminRole,
  setAdminRole,
  type AdminAuditItem,
  type AdminDetailRole,
  type AdminRoleAssignmentItem,
  BodeulApiError,
} from "../bodeulApi";

type AdminSecurityPanelProps = {
  currentUser: FirebaseUser;
};

const ROLE_LABEL: Record<AdminDetailRole, string> = {
  SUPER_ADMIN: "최고 관리자",
  OPERATIONS: "운영 관리자",
  DEVELOPER: "개발 관리자",
};

export function AdminSecurityPanel({currentUser}: AdminSecurityPanelProps) {
  const [roles, setRoles] = useState<readonly AdminRoleAssignmentItem[]>([]);
  const [audits, setAudits] = useState<readonly AdminAuditItem[]>([]);
  const [targetAdminUserId, setTargetAdminUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<AdminDetailRole>("OPERATIONS");
  const [reason, setReason] = useState("");
  const [breakGlassTargetId, setBreakGlassTargetId] = useState("");
  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [breakGlassMinutes, setBreakGlassMinutes] = useState(30);
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const activeRoles = useMemo(() => roles.filter((item) => !item.revokedAt), [roles]);

  const refresh = useCallback(async () => {
    setErrorMessage("");
    try {
      const [roleItems, auditItems] = await Promise.all([
        fetchAdminRoleAssignments(currentUser),
        fetchAdminAudits(currentUser),
      ]);
      setRoles(roleItems);
      setAudits(auditItems);
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  }, [currentUser]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  async function saveRole() {
    if (isBusy) return;
    if (reason.trim().length < 10) {
      setErrorMessage("권한 변경 사유를 10자 이상 입력해 주세요.");
      return;
    }
    setIsBusy(true);
    setErrorMessage("");
    try {
      await setAdminRole(currentUser, targetAdminUserId.trim(), selectedRole, reason.trim());
      setTargetAdminUserId("");
      setReason("");
      await refresh();
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function revokeRole(item: AdminRoleAssignmentItem) {
    const revokeReason = window.prompt("권한 회수 사유를 10자 이상 입력해 주세요.")?.trim() || "";
    if (revokeReason.length < 10 || isBusy) return;
    setIsBusy(true);
    try {
      await revokeAdminRole(currentUser, item.adminUserId, revokeReason);
      await refresh();
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function grantBreakGlass() {
    if (isBusy || breakGlassReason.trim().length < 10) {
      setErrorMessage("긴급 접근 사유를 10자 이상 입력해 주세요.");
      return;
    }
    setIsBusy(true);
    setErrorMessage("");
    try {
      await grantAdminBreakGlassAccess(
        currentUser,
        breakGlassTargetId.trim(),
        breakGlassReason.trim(),
        breakGlassMinutes,
      );
      setBreakGlassTargetId("");
      setBreakGlassReason("");
      await refresh();
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function revokeBreakGlass(item: AdminRoleAssignmentItem) {
    if (!item.breakGlassGrantId || isBusy) return;
    const revokeReason = window.prompt("긴급 접근 회수 사유를 10자 이상 입력해 주세요.")?.trim() || "";
    if (revokeReason.length < 10) return;
    setIsBusy(true);
    try {
      await revokeAdminBreakGlassAccess(currentUser, item.breakGlassGrantId, revokeReason);
      await refresh();
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-base font-semibold text-gray-900">관리자 권한과 감사</h1>
        <p className="mt-1 text-xs text-gray-500">
          앱 사용자 UUID 기준으로 최소권한을 부여하고 모든 변경 사유를 남깁니다.
        </p>
      </header>

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMessage}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">역할 부여·변경</h2>
        <div className="grid gap-3 border-y border-gray-200 py-4 lg:grid-cols-[minmax(260px,1fr)_180px_minmax(300px,1.2fr)_auto]">
          <input
            value={targetAdminUserId}
            onChange={(event) => setTargetAdminUserId(event.target.value)}
            placeholder="대상 app_users UUID"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value as AdminDetailRole)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="변경 사유 10~500자"
            maxLength={500}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void saveRole()}
            disabled={isBusy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-blue-300"
          >
            역할 저장
          </button>
        </div>

        <div className="overflow-x-auto border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr><th className="px-3 py-2 text-left">관리자 UUID</th><th className="px-3 py-2 text-left">역할</th><th className="px-3 py-2 text-left">부여 시각</th><th className="px-3 py-2 text-left">긴급 접근</th><th className="px-3 py-2 text-left">작업</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activeRoles.map((item) => (
                <tr key={item.adminUserId}>
                  <td className="px-3 py-2 font-mono">{item.adminUserId}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[item.adminRole]}</td>
                  <td className="px-3 py-2">{formatDateTime(item.grantedAt)}</td>
                  <td className="px-3 py-2">{item.breakGlassExpiresAt ? formatDateTime(item.breakGlassExpiresAt) : "없음"}</td>
                  <td className="space-x-2 px-3 py-2">
                    {item.breakGlassGrantId && <button type="button" onClick={() => void revokeBreakGlass(item)} className="text-amber-700 underline">긴급 권한 회수</button>}
                    <button type="button" onClick={() => void revokeRole(item)} className="text-red-700 underline">역할 회수</button>
                  </td>
                </tr>
              ))}
              {!activeRoles.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">활성 역할이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">긴급 원본 접근 승인</h2>
        <p className="text-xs text-gray-500">다른 최고 관리자에게만 최대 60분 동안 부여할 수 있습니다.</p>
        <div className="grid gap-3 border-y border-gray-200 py-4 lg:grid-cols-[minmax(260px,1fr)_120px_minmax(300px,1.2fr)_auto]">
          <input value={breakGlassTargetId} onChange={(event) => setBreakGlassTargetId(event.target.value)} placeholder="대상 최고 관리자 UUID" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <input type="number" min={1} max={60} value={breakGlassMinutes} onChange={(event) => setBreakGlassMinutes(Number(event.target.value))} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <input value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} placeholder="긴급 접근 사유 10~500자" maxLength={500} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <button type="button" onClick={() => void grantBreakGlass()} disabled={isBusy} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-amber-300">승인</button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">최근 감사 기록</h2>
          <button type="button" onClick={() => void refresh()} className="text-xs font-medium text-blue-700 underline">새로고침</button>
        </div>
        <div className="max-h-[420px] overflow-auto border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600"><tr><th className="px-3 py-2 text-left">시각</th><th className="px-3 py-2 text-left">행위자</th><th className="px-3 py-2 text-left">작업</th><th className="px-3 py-2 text-left">대상</th><th className="px-3 py-2 text-left">사유</th><th className="px-3 py-2 text-left">결과</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {audits.map((item) => <tr key={item.id}><td className="whitespace-nowrap px-3 py-2">{formatDateTime(item.createdAt)}</td><td className="px-3 py-2 font-mono">{item.actorAdminUserId}</td><td className="px-3 py-2">{item.action}</td><td className="px-3 py-2">{item.resourceType}<br/><span className="font-mono text-gray-500">{item.resourceId}</span></td><td className="max-w-xs px-3 py-2">{item.reason || "-"}</td><td className="px-3 py-2">{item.outcome}</td></tr>)}
              {!audits.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">감사 기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ko-KR");
}

function toMessage(error: unknown): string {
  return error instanceof BodeulApiError ? error.message : "관리자 보안 정보를 처리하지 못했습니다.";
}
