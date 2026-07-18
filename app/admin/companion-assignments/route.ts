import {NextResponse} from "next/server";

import {handleAdminCompanionAssignment} from "../../../server/admin-companion-assignments";
import {verifyFirebaseIdToken} from "../../../server/firebase-admin";
import {assignCompanionSession, findAppUserByFirebaseUid} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // 처리기가 동일한 400 응답으로 정규화한다.
  }

  const result = await handleAdminCompanionAssignment(
    request.headers.get("authorization"),
    body,
    {
      verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid,
      assignCompanionSession,
    },
  );

  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
