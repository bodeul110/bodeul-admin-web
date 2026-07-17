export type AppUserRole = "PATIENT" | "GUARDIAN" | "MANAGER" | "ADMIN";

export type VerifiedFirebaseIdentity = {
  readonly uid: string;
};

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

export type AdminHospitalGuidesDependencies = {
  readonly verifyIdToken: (token: string) => Promise<VerifiedFirebaseIdentity>;
  readonly findRoleByFirebaseUid: (uid: string) => Promise<AppUserRole | null>;
  readonly listHospitalGuides: (limit: number) => Promise<readonly HospitalGuideItem[]>;
};

export type AdminHospitalGuidesResult = {
  readonly status: number;
  readonly body: HospitalGuidesPayload | {
    readonly error: string;
    readonly message: string;
  };
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function handleAdminHospitalGuides(
  authorizationHeader: string | null,
  rawLimit: string | null,
  dependencies: AdminHospitalGuidesDependencies,
): Promise<AdminHospitalGuidesResult> {
  const tokenResult = extractBearerToken(authorizationHeader);
  if (!tokenResult.ok) {
    return tokenResult.failure;
  }

  let identity: VerifiedFirebaseIdentity;
  try {
    identity = await dependencies.verifyIdToken(tokenResult.token);
  } catch {
    return failure(401, "invalid_firebase_token", "Firebase ID token 검증에 실패했습니다.");
  }

  if (!identity.uid.trim()) {
    return failure(401, "invalid_firebase_token", "Firebase ID token에 uid가 없습니다.");
  }

  let role: AppUserRole | null;
  try {
    role = await dependencies.findRoleByFirebaseUid(identity.uid);
  } catch {
    return failure(503, "role_lookup_failed", "관리자 권한 확인에 실패했습니다.");
  }

  if (role !== "ADMIN") {
    return failure(403, "admin_role_required", "관리자 권한이 필요합니다.");
  }

  const limitResult = parseHospitalGuideLimit(rawLimit);
  if (!limitResult.ok) {
    return limitResult.failure;
  }

  try {
    const items = await dependencies.listHospitalGuides(limitResult.limit);
    return {
      status: 200,
      body: {
        items,
        limit: limitResult.limit,
      },
    };
  } catch {
    return failure(503, "hospital_guides_lookup_failed", "병원 가이드 조회에 실패했습니다.");
  }
}

export function parseHospitalGuideLimit(rawLimit: string | null):
  | {readonly ok: true; readonly limit: number}
  | {readonly ok: false; readonly failure: AdminHospitalGuidesResult} {
  if (rawLimit === null || rawLimit === "") {
    return {ok: true, limit: DEFAULT_LIMIT};
  }

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return {
      ok: false,
      failure: failure(400, "invalid_limit", `limit은 1부터 ${MAX_LIMIT} 사이의 정수여야 합니다.`),
    };
  }

  return {ok: true, limit};
}

function extractBearerToken(authorizationHeader: string | null):
  | {readonly ok: true; readonly token: string}
  | {readonly ok: false; readonly failure: AdminHospitalGuidesResult} {
  if (!authorizationHeader?.trim()) {
    return {
      ok: false,
      failure: failure(401, "missing_authorization", "Authorization 헤더가 필요합니다."),
    };
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/iu);
  const token = match?.[1]?.trim() || "";
  if (!token) {
    return {
      ok: false,
      failure: failure(401, "invalid_authorization", "Authorization 헤더는 Bearer 토큰 형식이어야 합니다."),
    };
  }

  return {ok: true, token};
}

function failure(status: number, error: string, message: string): AdminHospitalGuidesResult {
  return {
    status,
    body: {error, message},
  };
}
