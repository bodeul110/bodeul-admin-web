import {NextResponse} from "next/server";

import {handleAdminAccessContext} from "../../../server/admin-access-context";
import {
  createAdminAppCheckDependencies,
  verifyFirebaseIdToken,
} from "../../../server/firebase-admin";
import {findAppUserByFirebaseUid} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await handleAdminAccessContext(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    {
      ...createAdminAppCheckDependencies(),
      verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid,
    },
  );

  return NextResponse.json(result.body, {
    status: result.status,
    headers: {"Cache-Control": "no-store"},
  });
}
