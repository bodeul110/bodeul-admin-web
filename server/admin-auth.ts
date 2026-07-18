export type AppUserRole = "PATIENT" | "GUARDIAN" | "MANAGER" | "ADMIN";

export type VerifiedFirebaseIdentity = {
  readonly uid: string;
};

export type AppUserIdentity = {
  readonly id: string;
  readonly role: AppUserRole;
};

export type AdminErrorBody = {
  readonly error: string;
  readonly message: string;
};

export type AdminFailure = {
  readonly status: number;
  readonly body: AdminErrorBody;
};

export type AdminAuthorizationDependencies = {
  readonly verifyIdToken: (token: string) => Promise<VerifiedFirebaseIdentity>;
  readonly findAppUserByFirebaseUid: (uid: string) => Promise<AppUserIdentity | null>;
};

export type AdminAuthorizationResult =
  | {
    readonly ok: true;
    readonly actor: AppUserIdentity & {readonly firebaseUid: string};
  }
  | {
    readonly ok: false;
    readonly failure: AdminFailure;
  };

export async function authorizeAdmin(
  authorizationHeader: string | null,
  dependencies: AdminAuthorizationDependencies,
): Promise<AdminAuthorizationResult> {
  const tokenResult = extractBearerToken(authorizationHeader);
  if (!tokenResult.ok) {
    return tokenResult;
  }

  let identity: VerifiedFirebaseIdentity;
  try {
    identity = await dependencies.verifyIdToken(tokenResult.token);
  } catch {
    return authorizationFailure(401, "invalid_firebase_token", "Firebase ID token 검증에 실패했습니다.");
  }

  const firebaseUid = identity.uid.trim();
  if (!firebaseUid) {
    return authorizationFailure(401, "invalid_firebase_token", "Firebase ID token에 uid가 없습니다.");
  }

  let appUser: AppUserIdentity | null;
  try {
    appUser = await dependencies.findAppUserByFirebaseUid(firebaseUid);
  } catch {
    return authorizationFailure(503, "role_lookup_failed", "관리자 권한 확인에 실패했습니다.");
  }

  if (appUser?.role !== "ADMIN") {
    return authorizationFailure(403, "admin_role_required", "관리자 권한이 필요합니다.");
  }

  return {
    ok: true,
    actor: {
      ...appUser,
      firebaseUid,
    },
  };
}

function extractBearerToken(authorizationHeader: string | null):
  | {readonly ok: true; readonly token: string}
  | {readonly ok: false; readonly failure: AdminFailure} {
  if (!authorizationHeader?.trim()) {
    return authorizationFailure(401, "missing_authorization", "Authorization 헤더가 필요합니다.");
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/iu);
  const token = match?.[1]?.trim() || "";
  if (!token) {
    return authorizationFailure(
      401,
      "invalid_authorization",
      "Authorization 헤더는 Bearer 토큰 형식이어야 합니다.",
    );
  }

  return {ok: true, token};
}

function authorizationFailure(status: number, error: string, message: string): {
  readonly ok: false;
  readonly failure: AdminFailure;
} {
  return {
    ok: false,
    failure: {
      status,
      body: {error, message},
    },
  };
}
