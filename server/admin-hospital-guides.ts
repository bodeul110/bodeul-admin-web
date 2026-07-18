import {
  authorizeAdmin,
  type AdminAuthorizationDependencies,
} from "./admin-auth.ts";

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

export type AdminHospitalGuidesDependencies = AdminAuthorizationDependencies & {
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
  const authorization = await authorizeAdmin(authorizationHeader, dependencies);
  if (!authorization.ok) {
    return authorization.failure;
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

function failure(status: number, error: string, message: string): AdminHospitalGuidesResult {
  return {
    status,
    body: {error, message},
  };
}
