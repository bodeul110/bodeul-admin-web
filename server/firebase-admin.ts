import "server-only";

import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";

import type {VerifiedFirebaseIdentity} from "./admin-auth";

const APP_NAME = "bodeul-admin-web-server";

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseIdentity> {
  const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(token);
  return {uid: decoded.uid};
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
