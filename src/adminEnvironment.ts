export type AdminEnvironment = {
  kind: "production" | "preview" | "local" | "unknown";
  label: string;
  detail: string;
};

export function resolveAdminEnvironment(
  deploymentEnvironment: string | undefined,
  isDevelopment: boolean,
): AdminEnvironment {
  const environment = deploymentEnvironment?.trim() || "";

  if (environment === "production") {
    return {kind: "production", label: "운영 환경", detail: "운영 배포 · Production"};
  }
  if (environment === "preview") {
    return {kind: "preview", label: "개발 환경", detail: "미리보기 배포 · Preview"};
  }
  if (environment === "development" || (!environment && isDevelopment)) {
    return {kind: "local", label: "개발 환경", detail: "로컬 실행 · Local"};
  }

  // 최적화된 빌드만으로는 운영 배포인지 판단할 수 없다.
  return {kind: "unknown", label: "환경 확인 필요", detail: "배포 환경을 확인해 주세요"};
}
