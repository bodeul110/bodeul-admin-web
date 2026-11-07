import "server-only";

import {getVercelOidcToken} from "@vercel/oidc";
import {Firestore} from "firebase-admin/firestore";
import {ExternalAccountClient, GoogleAuth} from "google-auth-library";
import {assertFirebaseDeploymentBoundary} from "./deployment-boundary.ts";
import {createManagerListOidcOptions, requireManagerListOidcConfiguration} from "./manager-list-reader-policy.ts";

export async function withFirebaseManagerListFirestore<T>(read: (firestore: Firestore) => Promise<T>): Promise<T> {
  const config = requireManagerListOidcConfiguration(process.env);
  assertFirebaseDeploymentBoundary(process.env);
  const client = ExternalAccountClient.fromJSON(createManagerListOidcOptions(process.env, getVercelOidcToken));
  if (!client) throw new Error("심사 목록 전용 인증을 초기화하지 못했습니다.");
  let firestore: Firestore | undefined;
  try {
    // 스트리밍 조회를 시작하기 전에 인증 실패를 처리하고, 공용 App·ADC로 우회하지 않는다.
    await client.getAccessToken();
    firestore = new Firestore({
      projectId: config.projectId,
      databaseId: "(default)",
      preferRest: true,
      auth: new GoogleAuth({projectId: config.projectId, authClient: client}),
    });
    return await read(firestore);
  } catch {
    // SDK 오류에는 assertion·access token이 포함될 수 있어 원문/cause를 남기지 않는다.
    console.error("심사 목록 전용 OIDC 인증 또는 Firestore 조회에 실패했습니다.");
    throw new Error("심사 목록 전용 인증 또는 조회를 완료하지 못했습니다.");
  } finally {
    await firestore?.terminate().catch(() => undefined);
  }
}
