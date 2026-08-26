import "server-only";

import {getApps, initializeApp} from "firebase-admin/app";
import {getAppCheck} from "firebase-admin/app-check";
import {getAuth} from "firebase-admin/auth";

import {
  resolveAdminAppCheckMode,
  resolveAllowedAppIds,
  type AdminAppCheckDependencies,
  type AdminAppCheckVerificationResult,
  type AdminAppCheckVerdict,
  type AdminAppCheckMode,
} from "./admin-app-check";
import {classifyFirebaseAdminAppCheckError} from "./firebase-app-check-error";
import type {VerifiedFirebaseIdentity} from "./admin-auth";

const APP_NAME = "bodeul-admin-web-server";

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseIdentity> {
  const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(token);
  return {uid: decoded.uid};
}

export async function verifyFirebaseAppCheckToken(token: string): Promise<AdminAppCheckVerificationResult> {
  try {
    const result = await getAppCheck(getFirebaseAdminApp()).verifyToken(token);
    return {status: "valid", identity: {appId: result.appId}};
  } catch (error) {
    return {status: classifyFirebaseAdminAppCheckError(error)};
  }
}

export function createAdminAppCheckDependencies(): AdminAppCheckDependencies {
  return {
    mode: resolveAdminAppCheckMode(process.env.ADMIN_APP_CHECK_MODE),
    allowedAppIds: resolveAllowedAppIds(process.env.FIREBASE_APPCHECK_ALLOWED_APP_IDS),
    verifyAppCheckToken: verifyFirebaseAppCheckToken,
    recordVerdict: recordAdminAppCheckVerdict,
  };
}

function recordAdminAppCheckVerdict(verdict: AdminAppCheckVerdict, mode: AdminAppCheckMode): void {
  const severity = verdict === "valid" || verdict === "disabled" ? "info" : "warn";
  console[severity](`[AppCheck] mode=${mode} verdict=${verdict}`);
}

function getFirebaseAdminApp() {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) {
    return existing;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID가 설정되지 않았습니다.");
  }

  // ID token 서명, 발급자, audience, 만료 검증에는 프로젝트 ID만 사용한다.
  return initializeApp({projectId}, APP_NAME);
}
