import "server-only";

import {cert, getApps, initializeApp, type AppOptions} from "firebase-admin/app";
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
import type {AdminMfaMode} from "./admin-auth";
import {resolveAdminMfaMode} from "./admin-mfa-mode";

const APP_NAME = "bodeul-admin-web-server";

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseIdentity> {
  const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(token);
  return {
    uid: decoded.uid,
    mfaVerified: Boolean(decoded.firebase?.sign_in_second_factor),
  };
}

export async function verifyFirebaseAppCheckToken(token: string): Promise<AdminAppCheckVerificationResult> {
  try {
    const result = await getAppCheck(getFirebaseAdminApp()).verifyToken(token);
    return {status: "valid", identity: {appId: result.appId}};
  } catch (error) {
    return {status: classifyFirebaseAdminAppCheckError(error)};
  }
}

export function createAdminAppCheckDependencies(): AdminAppCheckDependencies & {
  readonly mfaMode: AdminMfaMode;
  readonly recordMfaVerdict: (verified: boolean, mode: AdminMfaMode) => void;
} {
  return {
    mode: resolveAdminAppCheckMode(process.env.ADMIN_APP_CHECK_MODE),
    allowedAppIds: resolveAllowedAppIds(process.env.FIREBASE_APPCHECK_ALLOWED_APP_IDS),
    verifyAppCheckToken: verifyFirebaseAppCheckToken,
    recordVerdict: recordAdminAppCheckVerdict,
    mfaMode: resolveAdminMfaMode(
      process.env.ADMIN_MFA_MODE,
      process.env.ADMIN_MFA_ENFORCE_READY,
    ),
    recordMfaVerdict: recordAdminMfaVerdict,
  };
}

function recordAdminMfaVerdict(verified: boolean, mode: AdminMfaMode): void {
  const severity = verified || mode === "off" ? "info" : "warn";
  console[severity](`[AdminMFA] mode=${mode} verified=${verified}`);
}

function recordAdminAppCheckVerdict(verdict: AdminAppCheckVerdict, mode: AdminAppCheckMode): void {
  const severity = verdict === "valid" || verdict === "disabled" ? "info" : "warn";
  console[severity](`[AppCheck] mode=${mode} verdict=${verdict}`);
}

export function getFirebaseAdminApp() {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) {
    return existing;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID가 설정되지 않았습니다.");
  }

  const options: AppOptions = {
    projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim()
      || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  };
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.");
    }
    if (serviceAccount.project_id !== projectId) {
      throw new Error("Firebase 서버 자격 증명의 프로젝트가 현재 배포 환경과 다릅니다.");
    }
    options.credential = cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key.replace(/\\n/gu, "\n"),
    });
  }

  return initializeApp(options, APP_NAME);
}
