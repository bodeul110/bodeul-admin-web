import {resolveAdminEnvironment} from "../adminEnvironment";
import {clientEnv} from "../clientEnv";

const environment = resolveAdminEnvironment(clientEnv.deploymentEnvironment, clientEnv.isDevelopment);
const environmentStyles = {
  production: "border-amber-300 bg-amber-50 text-amber-950",
  preview: "border-blue-200 bg-blue-50 text-blue-900",
  local: "border-blue-200 bg-blue-50 text-blue-900",
  unknown: "border-red-200 bg-red-50 text-red-900",
};

export function AdminEnvironmentBanner() {
  return (
    <div
      role="note"
      aria-label="사이트 배포 환경"
      data-environment={environment.kind}
      className={`sticky top-0 z-20 shrink-0 border-b ${environmentStyles[environment.kind]}`}
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs sm:px-6">
        <strong className="text-sm font-semibold">{environment.label}</strong>
        <span>{environment.detail}</span>
      </div>
    </div>
  );
}
