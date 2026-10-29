import "server-only";

import {cert, getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {assertFirebaseDeploymentBoundary} from "./deployment-boundary.ts";
import {requireManagerListReaderCredential} from "./manager-list-reader-policy.ts";

const APP_NAME = "bodeul-admin-manager-list-dev-reader";

export function getFirebaseManagerListFirestore() {
  // 캐시된 App이 있어도 현재 모드·배포·계정 설정을 먼저 검증한다.
  const credential = requireManagerListReaderCredential(process.env);
  assertFirebaseDeploymentBoundary(process.env);
  try {
    const app = getApps().find((candidate) => candidate.name === APP_NAME)
      || initializeApp({projectId: credential.projectId, credential: cert(credential)}, APP_NAME);
    // 별도 named App의 기본 DB만 사용하며 공용 App이나 ADC로 재시도하지 않는다.
    return getFirestore(app);
  } catch {
    // SDK 오류의 credential·private key·원래 cause를 응답이나 로그에 전달하지 않는다.
    throw new Error("심사 목록 전용 인증을 초기화하지 못했습니다.");
  }
}
