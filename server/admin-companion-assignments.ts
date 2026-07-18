import {
  authorizeAdmin,
  type AdminAuthorizationDependencies,
  type AdminErrorBody,
} from "./admin-auth.ts";

export type CompanionAssignmentCommand = {
  readonly appointmentRequestId: string;
  readonly managerUserId: string;
  readonly actorAdminUserId: string;
  readonly expectedAppointmentVersion: number;
  readonly reason: string;
};

export type AdminCompanionAssignmentDependencies = AdminAuthorizationDependencies & {
  readonly assignCompanionSession: (command: CompanionAssignmentCommand) => Promise<string>;
};

export type AdminCompanionAssignmentResult = {
  readonly status: number;
  readonly body: {
    readonly sessionId: string;
  } | AdminErrorBody;
};

type AssignmentInput = Omit<CompanionAssignmentCommand, "actorAdminUserId">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_REASON_LENGTH = 500;

export async function handleAdminCompanionAssignment(
  authorizationHeader: string | null,
  requestBody: unknown,
  dependencies: AdminCompanionAssignmentDependencies,
): Promise<AdminCompanionAssignmentResult> {
  const authorization = await authorizeAdmin(authorizationHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
  }

  const inputResult = parseAssignmentInput(requestBody);
  if (!inputResult.ok) {
    return inputResult.failure;
  }

  try {
    const sessionId = await dependencies.assignCompanionSession({
      ...inputResult.input,
      actorAdminUserId: authorization.actor.id,
    });
    return {
      status: 201,
      body: {sessionId},
    };
  } catch (error) {
    return mapAssignmentFailure(error);
  }
}

function parseAssignmentInput(requestBody: unknown):
  | {readonly ok: true; readonly input: AssignmentInput}
  | {readonly ok: false; readonly failure: AdminCompanionAssignmentResult} {
  if (!isRecord(requestBody)) {
    return invalidInput("요청 본문은 JSON 객체여야 합니다.");
  }

  const appointmentRequestId = readString(requestBody.appointmentRequestId);
  if (!UUID_PATTERN.test(appointmentRequestId)) {
    return invalidInput("appointmentRequestId는 유효한 UUID여야 합니다.");
  }

  const managerUserId = readString(requestBody.managerUserId);
  if (!UUID_PATTERN.test(managerUserId)) {
    return invalidInput("managerUserId는 유효한 UUID여야 합니다.");
  }

  const expectedAppointmentVersion = requestBody.expectedAppointmentVersion;
  if (!Number.isSafeInteger(expectedAppointmentVersion) || Number(expectedAppointmentVersion) < 0) {
    return invalidInput("expectedAppointmentVersion은 0 이상의 정수여야 합니다.");
  }

  if (requestBody.reason !== undefined && typeof requestBody.reason !== "string") {
    return invalidInput("reason은 문자열이어야 합니다.");
  }
  const reason = readString(requestBody.reason);
  if (reason.length > MAX_REASON_LENGTH) {
    return invalidInput(`reason은 ${MAX_REASON_LENGTH}자 이하여야 합니다.`);
  }

  return {
    ok: true,
    input: {
      appointmentRequestId,
      managerUserId,
      expectedAppointmentVersion: Number(expectedAppointmentVersion),
      reason,
    },
  };
}

function mapAssignmentFailure(error: unknown): AdminCompanionAssignmentResult {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  switch (code) {
    case "22023":
      return failure(400, "invalid_appointment_version", "예약 버전을 확인해 주세요.");
    case "23503":
      return failure(400, "invalid_manager", "배정 대상 매니저를 확인해 주세요.");
    case "42501":
      return failure(403, "admin_role_required", "관리자 권한이 필요합니다.");
    case "P0002":
      return failure(404, "appointment_not_found", "예약을 찾지 못했습니다.");
    case "23505":
      return failure(409, "assignment_already_exists", "이미 동행 세션이 생성된 예약입니다.");
    case "40001":
      return failure(409, "appointment_version_conflict", "예약이 변경되었습니다. 다시 조회해 주세요.");
    case "P0001":
      return failure(409, "appointment_state_conflict", "요청 상태의 예약만 매칭할 수 있습니다.");
    default:
      return failure(503, "companion_assignment_failed", "매니저 배정에 실패했습니다.");
  }
}

function invalidInput(message: string): {
  readonly ok: false;
  readonly failure: AdminCompanionAssignmentResult;
} {
  return {
    ok: false,
    failure: failure(400, "invalid_assignment_request", message),
  };
}

function failure(status: number, error: string, message: string): AdminCompanionAssignmentResult {
  return {
    status,
    body: {error, message},
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
