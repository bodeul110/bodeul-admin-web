import type { User as FirebaseUser } from "firebase/auth";

import {createAdminApiHeaders} from "./adminApiHeaders";
import {getFirebaseAppCheckToken} from "./appCheck";
import {clientEnv} from "./clientEnv";

export type BodeulDataBackend = "firebase" | "api";

export type HospitalGuideItem = {
  readonly id: string;
  readonly hospitalName: string;
  readonly departmentName: string;
  readonly steps: readonly unknown[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type HospitalGuidesPayload = {
  readonly items: readonly HospitalGuideItem[];
  readonly limit: number;
};

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

type AdminWebApiEnv = {
  readonly dataBackend?: string;
  readonly apiBaseUrl?: string;
};

type FetchHospitalGuidesOptions = {
  readonly baseUrl?: string;
  readonly limit?: number;
};

export class BodeulApiError extends Error {
  readonly code: string;
  readonly statusCode: number | null;

  constructor(code: string, message: string, statusCode: number | null = null) {
    super(message);
    this.name = "BodeulApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function resolveBodeulDataBackend(env: AdminWebApiEnv = {
  dataBackend: clientEnv.bodeulDataBackend,
}): BodeulDataBackend {
  return env.dataBackend?.trim().toLowerCase() === "firebase" ? "firebase" : "api";
}

export function resolveBodeulApiBaseUrl(env: AdminWebApiEnv = {
  apiBaseUrl: clientEnv.bodeulApiBaseUrl,
}): string {
  return trimTrailingSlash(env.apiBaseUrl?.trim() || "");
}

export async function fetchAdminHospitalGuides(
    user: FirebaseUser,
    options: FetchHospitalGuidesOptions = {},
): Promise<HospitalGuidesPayload> {
  const baseUrl = trimTrailingSlash(options.baseUrl ?? resolveBodeulApiBaseUrl());

  const limit = options.limit ?? 50;
  const [token, appCheckToken] = await Promise.all([
    user.getIdToken(),
    getFirebaseAppCheckToken(),
  ]);
  const url = createBodeulApiUrl(baseUrl, "/admin/hospital-guides");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    method: "GET",
    headers: createAdminApiHeaders(token, appCheckToken),
  });
  const responseBody = await readJson(response);

  if (!response.ok) {
    const errorPayload = toErrorPayload(responseBody);
    throw new BodeulApiError(errorPayload.error, errorPayload.message, response.status);
  }

  return toHospitalGuidesPayload(responseBody);
}

export async function fetchAppointmentByPublicCode(
  user: FirebaseUser,
  publicCode: string,
  options: {readonly baseUrl?: string} = {},
): Promise<AppointmentPublicCodeSearchItem> {
  const baseUrl = trimTrailingSlash(options.baseUrl ?? resolveBodeulApiBaseUrl());
  const [token, appCheckToken] = await Promise.all([
    user.getIdToken(),
    getFirebaseAppCheckToken(),
  ]);
  const url = createBodeulApiUrl(baseUrl, "/admin/appointments/public-code");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...createAdminApiHeaders(token, appCheckToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({publicCode}),
  });
  const responseBody = await readJson(response);

  if (!response.ok) {
    const errorPayload = toErrorPayload(responseBody);
    throw new BodeulApiError(errorPayload.error, errorPayload.message, response.status);
  }
  if (!isRecord(responseBody) || !isRecord(responseBody.item)) {
    throw new BodeulApiError("invalid_appointment_payload", "예약 검색 API 응답 형식이 올바르지 않습니다.");
  }

  const item = responseBody.item;
  return {
    id: readRequiredAppointmentString(item.id, "id"),
    publicCode: readRequiredAppointmentString(item.publicCode, "publicCode"),
    status: readRequiredAppointmentString(item.status, "status"),
    appointmentAt: readRequiredAppointmentString(item.appointmentAt, "appointmentAt"),
    hospitalName: readRequiredAppointmentString(item.hospitalName, "hospitalName"),
    departmentName: readRequiredAppointmentString(item.departmentName, "departmentName"),
    patientName: readOptionalString(item.patientName),
    guardianName: readOptionalString(item.guardianName),
    managerUserId: readOptionalString(item.managerUserId),
    managerName: readOptionalString(item.managerName),
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function createBodeulApiUrl(baseUrl: string, path: string): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!baseUrl || baseUrl.startsWith("/")) {
    const rawUrl = `${baseUrl}${normalizedPath}`;
    return new URL(rawUrl, window.location.origin);
  }

  return new URL(`${baseUrl}${normalizedPath}`);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new BodeulApiError("invalid_json_response", "관리자 API 응답을 JSON으로 해석하지 못했습니다.", response.status);
  }
}

function toErrorPayload(value: unknown): {readonly error: string; readonly message: string} {
  if (!isRecord(value)) {
    return {
      error: "api_request_failed",
      message: "관리자 API 요청에 실패했습니다.",
    };
  }

  const error = typeof value.error === "string" && value.error.trim() ? value.error.trim() : "api_request_failed";
  const message = typeof value.message === "string" && value.message.trim()
    ? value.message.trim()
    : "관리자 API 요청에 실패했습니다.";

  return {error, message};
}

function toHospitalGuidesPayload(value: unknown): HospitalGuidesPayload {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.limit !== "number") {
    throw new BodeulApiError("invalid_hospital_guides_payload", "병원 가이드 API 응답 형식이 올바르지 않습니다.");
  }

  return {
    limit: value.limit,
    items: value.items.map(toHospitalGuideItem),
  };
}

function toHospitalGuideItem(value: unknown): HospitalGuideItem {
  if (!isRecord(value)) {
    throw new BodeulApiError("invalid_hospital_guide_item", "병원 가이드 항목 형식이 올바르지 않습니다.");
  }

  return {
    id: readRequiredString(value.id, "id"),
    hospitalName: readRequiredString(value.hospitalName, "hospitalName"),
    departmentName: readRequiredString(value.departmentName, "departmentName"),
    steps: Array.isArray(value.steps) ? value.steps : [],
    createdAt: readRequiredString(value.createdAt, "createdAt"),
    updatedAt: readRequiredString(value.updatedAt, "updatedAt"),
  };
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }

  throw new BodeulApiError("invalid_hospital_guides_payload", `병원 가이드 API 응답의 ${fieldName} 값이 올바르지 않습니다.`);
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRequiredAppointmentString(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new BodeulApiError(
    "invalid_appointment_payload",
    `예약 검색 API 응답의 ${fieldName} 값이 올바르지 않습니다.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
