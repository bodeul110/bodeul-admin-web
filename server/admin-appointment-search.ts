import {
  authorizeAdmin,
  type AdminAuthorizationDependencies,
} from "./admin-auth.ts";

export type AppointmentPublicCodeSearchItem = {
  readonly id: string;
  readonly publicCode: string;
  readonly status: string;
  readonly appointmentAt: string;
  readonly hospitalName: string;
  readonly departmentName: string;
  readonly patientName: string;
  readonly guardianName: string;
  readonly managerUserId: string;
  readonly managerName: string;
};

export type AppointmentPublicCodeLookup =
  | {readonly status: "FOUND"; readonly item: AppointmentPublicCodeSearchItem}
  | {readonly status: "NOT_FOUND" | "RATE_LIMITED"; readonly item: null};

export type AdminAppointmentSearchDependencies = AdminAuthorizationDependencies & {
  readonly findAppointmentByPublicCode: (
    actorAdminUserId: string,
    publicCode: string,
  ) => Promise<AppointmentPublicCodeLookup>;
};

export type AdminAppointmentSearchResult = {
  readonly status: number;
  readonly body: {readonly item: AppointmentPublicCodeSearchItem} | {
    readonly error: string;
    readonly message: string;
  };
};

const PUBLIC_CODE_PATTERN = /^BD-[A-Z0-9]{6}$/u;

export async function handleAdminAppointmentSearch(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  rawPublicCode: string | null,
  dependencies: AdminAppointmentSearchDependencies,
): Promise<AdminAppointmentSearchResult> {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
  }

  const publicCode = normalizePublicCode(rawPublicCode);
  if (!publicCode) {
    return failure(400, "invalid_public_code", "예약 코드는 BD- 뒤에 영문 대문자 또는 숫자 6자리여야 합니다.");
  }

  let lookup: AppointmentPublicCodeLookup;
  try {
    lookup = await dependencies.findAppointmentByPublicCode(authorization.actor.id, publicCode);
  } catch {
    return failure(503, "appointment_lookup_failed", "예약 코드 검색에 실패했습니다.");
  }

  if (lookup.status !== "FOUND") {
    return lookup.status === "RATE_LIMITED"
      ? failure(429, "public_code_rate_limited", "예약 코드 검색이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
      : failure(404, "appointment_not_found", "일치하는 예약을 찾지 못했습니다.");
  }
  return {status: 200, body: {item: lookup.item}};
}

export function normalizePublicCode(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() || "";
  return PUBLIC_CODE_PATTERN.test(normalized) ? normalized : null;
}

function failure(status: number, error: string, message: string): AdminAppointmentSearchResult {
  return {status, body: {error, message}};
}
