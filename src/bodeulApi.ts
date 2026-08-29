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

export type AdminDetailRole = "SUPER_ADMIN" | "OPERATIONS" | "DEVELOPER";
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

export type AdminRoleAssignmentItem = {
  readonly adminUserId: string;
  readonly adminRole: AdminDetailRole;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
  readonly breakGlassGrantId: string | null;
  readonly breakGlassExpiresAt: string | null;
};

export type AdminAuditItem = {
  readonly id: string;
  readonly actorAdminUserId: string;
  readonly actorAdminRole: AdminDetailRole;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason: string;
  readonly outcome: string;
  readonly createdAt: string;
};

export type AdminManagerReviewItem = {
  readonly id: string;
  readonly name: string;
  readonly maskedEmail: string;
  readonly maskedPhone: string;
  readonly createdAt: string;
  readonly status: "PENDING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  readonly documentSummary: string;
  readonly reviewNote: string;
  readonly availableDocumentKeys: readonly ("idCard" | "license" | "criminalRecord")[];
};

export type AdminManagerDocumentPayload = {
  readonly blob: Blob;
  readonly fileName: string;
  readonly contentType: string;
  readonly updatedAt: string;
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

export async function fetchAdminAccessContext(
  user: FirebaseUser,
  baseUrl = resolveBodeulApiBaseUrl(),
): Promise<AdminAccessContextPayload> {
  const [token, appCheckToken] = await Promise.all([
    user.getIdToken(),
    getFirebaseAppCheckToken(),
  ]);
  const url = createBodeulApiUrl(trimTrailingSlash(baseUrl), "/admin/access-context");
  const response = await fetch(url, {
    method: "GET",
    headers: createAdminApiHeaders(token, appCheckToken),
    cache: "no-store",
  });
  const responseBody = await readJson(response);
  if (!response.ok) {
    const errorPayload = toErrorPayload(responseBody);
    throw new BodeulApiError(errorPayload.error, errorPayload.message, response.status);
  }
  return toAdminAccessContextPayload(responseBody);
}

export async function fetchAdminRoleAssignments(user: FirebaseUser): Promise<readonly AdminRoleAssignmentItem[]> {
  const payload = await authenticatedAdminJson(user, "/admin/role-assignments", {method: "GET"});
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new BodeulApiError("invalid_admin_roles_payload", "관리자 역할 목록 형식이 올바르지 않습니다.");
  }
  return payload.items.map(toAdminRoleAssignmentItem);
}

export async function setAdminRole(
  user: FirebaseUser,
  targetAdminUserId: string,
  adminRole: AdminDetailRole,
  reason: string,
): Promise<void> {
  await authenticatedAdminJson(user, "/admin/role-assignments", {
    method: "PUT",
    body: JSON.stringify({targetAdminUserId, adminRole, reason}),
  });
}

export async function revokeAdminRole(
  user: FirebaseUser,
  targetAdminUserId: string,
  reason: string,
): Promise<void> {
  await authenticatedAdminJson(user, "/admin/role-assignments", {
    method: "DELETE",
    body: JSON.stringify({targetAdminUserId, reason}),
  });
}

export async function grantAdminBreakGlassAccess(
  user: FirebaseUser,
  targetAdminUserId: string,
  reason: string,
  durationMinutes: number,
): Promise<void> {
  await authenticatedAdminJson(user, "/admin/break-glass", {
    method: "POST",
    body: JSON.stringify({targetAdminUserId, reason, durationMinutes}),
  });
}

export async function revokeAdminBreakGlassAccess(
  user: FirebaseUser,
  grantId: string,
  reason: string,
): Promise<void> {
  await authenticatedAdminJson(user, "/admin/break-glass", {
    method: "DELETE",
    body: JSON.stringify({grantId, reason}),
  });
}

export async function fetchAdminAudits(user: FirebaseUser): Promise<readonly AdminAuditItem[]> {
  const payload = await authenticatedAdminJson(user, "/admin/audits?limit=100", {method: "GET"});
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new BodeulApiError("invalid_admin_audits_payload", "관리자 감사 목록 형식이 올바르지 않습니다.");
  }
  return payload.items.map(toAdminAuditItem);
}

export async function fetchAdminManagerReviews(user: FirebaseUser): Promise<readonly AdminManagerReviewItem[]> {
  const payload = await authenticatedAdminJson(user, "/admin/manager-reviews", {method: "GET"});
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new BodeulApiError("invalid_manager_reviews_payload", "매니저 심사 목록 형식이 올바르지 않습니다.");
  }
  return payload.items.map(toAdminManagerReviewItem);
}

export async function saveAdminManagerReview(
  user: FirebaseUser,
  managerUserId: string,
  status: "APPROVED" | "REJECTED",
  reviewNote: string,
): Promise<{readonly operationId: string; readonly auditState: "RECORDED" | "PENDING"}> {
  const operationId = crypto.randomUUID();
  let result: {readonly operationId: string; readonly auditState: "RECORDED" | "PENDING"} | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await authenticatedAdminJson(user, "/admin/manager-reviews", {
      method: "POST",
      body: JSON.stringify({managerUserId, status, reviewNote, operationId}),
    });
    if (!isRecord(payload)
        || payload.operationId !== operationId
        || (payload.auditState !== "RECORDED" && payload.auditState !== "PENDING")) {
      throw new BodeulApiError("invalid_manager_review_result", "심사 저장 결과 형식이 올바르지 않습니다.");
    }
    result = {operationId, auditState: payload.auditState};
    if (result.auditState === "RECORDED") return result;
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
  return result || {operationId, auditState: "PENDING"};
}

export async function fetchAdminManagerDocument(
  user: FirebaseUser,
  managerUserId: string,
  documentKey: "idCard" | "license" | "criminalRecord",
  reason: string,
): Promise<AdminManagerDocumentPayload> {
  const [token, appCheckToken] = await Promise.all([user.getIdToken(), getFirebaseAppCheckToken()]);
  const headers = createAdminApiHeaders(token, appCheckToken);
  headers["Content-Type"] = "application/json; charset=utf-8";
  const path = `/admin/manager-reviews/${encodeURIComponent(managerUserId)}/documents/${documentKey}`;
  const response = await fetch(createBodeulApiUrl(resolveBodeulApiBaseUrl(), path), {
    method: "POST",
    headers,
    body: JSON.stringify({reason}),
    cache: "no-store",
  });
  if (!response.ok) {
    const errorPayload = toErrorPayload(await readJson(response));
    throw new BodeulApiError(errorPayload.error, errorPayload.message, response.status);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const fileNameHeader = response.headers.get("x-admin-document-name") || "";
  return {
    blob: await response.blob(),
    fileName: fileNameHeader ? decodeURIComponent(fileNameHeader) : documentKey,
    contentType,
    updatedAt: response.headers.get("x-admin-document-updated-at") || "",
  };
}

async function authenticatedAdminJson(
  user: FirebaseUser,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const [token, appCheckToken] = await Promise.all([user.getIdToken(), getFirebaseAppCheckToken()]);
  const headers = createAdminApiHeaders(token, appCheckToken);
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(createBodeulApiUrl(resolveBodeulApiBaseUrl(), path), {
    ...init,
    headers,
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    const errorPayload = toErrorPayload(body);
    throw new BodeulApiError(errorPayload.error, errorPayload.message, response.status);
  }
  return body;
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

function toAdminAccessContextPayload(value: unknown): AdminAccessContextPayload {
  if (!isRecord(value) || !isAdminDetailRole(value.role) || !Array.isArray(value.permissions)) {
    throw new BodeulApiError("invalid_admin_access_context", "관리자 권한 API 응답 형식이 올바르지 않습니다.");
  }
  const permissions = value.permissions.filter(isAdminPermission);
  if (permissions.length !== value.permissions.length) {
    throw new BodeulApiError("invalid_admin_access_context", "관리자 권한 목록 형식이 올바르지 않습니다.");
  }
  return {
    adminUserId: readRequiredString(value.adminUserId, "adminUserId"),
    role: value.role,
    permissions,
    breakGlassExpiresAt: typeof value.breakGlassExpiresAt === "string"
      ? value.breakGlassExpiresAt
      : null,
  };
}

function toAdminRoleAssignmentItem(value: unknown): AdminRoleAssignmentItem {
  if (!isRecord(value) || !isAdminDetailRole(value.adminRole)) {
    throw new BodeulApiError("invalid_admin_roles_payload", "관리자 역할 항목 형식이 올바르지 않습니다.");
  }
  return {
    adminUserId: readRequiredString(value.adminUserId, "adminUserId"),
    adminRole: value.adminRole,
    grantedAt: readRequiredString(value.grantedAt, "grantedAt"),
    revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : null,
    breakGlassGrantId: typeof value.breakGlassGrantId === "string" ? value.breakGlassGrantId : null,
    breakGlassExpiresAt: typeof value.breakGlassExpiresAt === "string" ? value.breakGlassExpiresAt : null,
  };
}

function toAdminAuditItem(value: unknown): AdminAuditItem {
  if (!isRecord(value) || !isAdminDetailRole(value.actorAdminRole)) {
    throw new BodeulApiError("invalid_admin_audits_payload", "관리자 감사 항목 형식이 올바르지 않습니다.");
  }
  return {
    id: readRequiredString(value.id, "id"),
    actorAdminUserId: readRequiredString(value.actorAdminUserId, "actorAdminUserId"),
    actorAdminRole: value.actorAdminRole,
    action: readRequiredString(value.action, "action"),
    resourceType: readRequiredString(value.resourceType, "resourceType"),
    resourceId: readRequiredString(value.resourceId, "resourceId"),
    reason: typeof value.reason === "string" ? value.reason : "",
    outcome: readRequiredString(value.outcome, "outcome"),
    createdAt: readRequiredString(value.createdAt, "createdAt"),
  };
}

function toAdminManagerReviewItem(value: unknown): AdminManagerReviewItem {
  if (!isRecord(value) || !Array.isArray(value.availableDocumentKeys)) {
    throw new BodeulApiError("invalid_manager_reviews_payload", "매니저 심사 항목 형식이 올바르지 않습니다.");
  }
  const status = value.status;
  if (status !== "PENDING" && status !== "PENDING_REVIEW" && status !== "APPROVED" && status !== "REJECTED") {
    throw new BodeulApiError("invalid_manager_reviews_payload", "매니저 심사 상태가 올바르지 않습니다.");
  }
  const availableDocumentKeys = value.availableDocumentKeys.filter(
    (key): key is "idCard" | "license" | "criminalRecord" =>
      key === "idCard" || key === "license" || key === "criminalRecord",
  );
  if (availableDocumentKeys.length !== value.availableDocumentKeys.length) {
    throw new BodeulApiError("invalid_manager_reviews_payload", "매니저 문서 목록이 올바르지 않습니다.");
  }
  return {
    id: readRequiredString(value.id, "id"),
    name: readRequiredString(value.name, "name"),
    maskedEmail: readRequiredString(value.maskedEmail, "maskedEmail"),
    maskedPhone: readRequiredString(value.maskedPhone, "maskedPhone"),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    status,
    documentSummary: typeof value.documentSummary === "string" ? value.documentSummary : "",
    reviewNote: typeof value.reviewNote === "string" ? value.reviewNote : "",
    availableDocumentKeys,
  };
}

function isAdminDetailRole(value: unknown): value is AdminDetailRole {
  return value === "SUPER_ADMIN" || value === "OPERATIONS" || value === "DEVELOPER";
}

function isAdminPermission(value: unknown): value is AdminPermission {
  return value === "OPERATIONS_READ"
    || value === "MANAGER_REVIEW"
    || value === "RAW_PREVIEW"
    || value === "RAW_DOWNLOAD"
    || value === "ROLE_MANAGEMENT"
    || value === "DEVELOPER_DIAGNOSTICS";
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
