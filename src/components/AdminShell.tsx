import type { ReactNode } from "react";

type MenuKey = "dashboard" | "approval" | "appointmentSearch" | "hospitalGuides" | "security";

type AdminShellProps = {
  adminName: string;
  adminRole: "SUPER_ADMIN" | "OPERATIONS" | "DEVELOPER";
  canReviewManagers: boolean;
  canViewHospitalGuides: boolean;
  canManageRoles: boolean;
  currentMenu: MenuKey;
  managerLoadError: string;
  onMenuChange: (menu: MenuKey) => void;
  onLogout: () => void;
  children: ReactNode;
};

export function AdminShell({
  adminName,
  adminRole,
  canReviewManagers,
  canViewHospitalGuides,
  canManageRoles,
  currentMenu,
  managerLoadError,
  onMenuChange,
  onLogout,
  children,
}: AdminShellProps) {
  const currentMenuLabel: Record<MenuKey, string> = {
    dashboard: "대시보드",
    approval: "매니저 승인",
    appointmentSearch: "예약 검색",
    hospitalGuides: "병원 가이드",
    security: "권한과 감사",
  };
  const adminRoleLabel = {
    SUPER_ADMIN: "최고 관리자",
    OPERATIONS: "운영 관리자",
    DEVELOPER: "개발 관리자",
  }[adminRole];

  return (
    <div className="flex min-h-screen bg-gray-50 font-sans text-sm antialiased">
      <aside className="w-56 bg-slate-900 p-4 text-white shadow-lg">
        <h2 className="mb-4 text-sm font-semibold tracking-tight text-blue-400">
          bodeul Admin
        </h2>
        <p className="text-xs text-slate-300">{adminName}</p>
        <p className="mb-4 mt-1 text-[11px] text-blue-300">{adminRoleLabel}</p>
        <nav className="space-y-1 text-xs">
          <button
            type="button"
            onClick={() => onMenuChange("dashboard")}
            className={`w-full rounded-md px-3 py-2 text-left transition ${
              currentMenu === "dashboard" ? "bg-blue-600" : "hover:bg-slate-800"
            }`}
          >
            대시보드
          </button>
          {canReviewManagers && (
            <button
              type="button"
              onClick={() => onMenuChange("approval")}
              className={`w-full rounded-md px-3 py-2 text-left transition ${
                currentMenu === "approval" ? "bg-blue-600" : "hover:bg-slate-800"
              }`}
            >
              매니저 승인
            </button>
          )}
          {canViewHospitalGuides && (
            <>
              <button
                type="button"
                onClick={() => onMenuChange("appointmentSearch")}
                className={`w-full rounded-md px-3 py-2 text-left transition ${
                  currentMenu === "appointmentSearch" ? "bg-blue-600" : "hover:bg-slate-800"
                }`}
              >
                예약 검색
              </button>
              <button
                type="button"
                onClick={() => onMenuChange("hospitalGuides")}
                className={`w-full rounded-md px-3 py-2 text-left transition ${
                  currentMenu === "hospitalGuides" ? "bg-blue-600" : "hover:bg-slate-800"
                }`}
              >
                병원 가이드
              </button>
            </>
          )}
          {canManageRoles && (
            <button
              type="button"
              onClick={() => onMenuChange("security")}
              className={`w-full rounded-md px-3 py-2 text-left transition ${
                currentMenu === "security" ? "bg-blue-600" : "hover:bg-slate-800"
              }`}
            >
              권한과 감사
            </button>
          )}
        </nav>
      </aside>

      <main className="flex-1 p-6">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {currentMenuLabel[currentMenu]}
            </h2>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs shadow-sm hover:bg-gray-50"
          >
            로그아웃
          </button>
        </header>

        {managerLoadError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {managerLoadError}
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
