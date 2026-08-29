import {NextResponse} from "next/server";

import {handleAdminAudits} from "../../../server/admin-audits";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../server/firebase-admin";
import {findAppUserByFirebaseUid, listAdminAccessAudits} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await handleAdminAudits(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    url.searchParams.get("limit"),
    {
      ...createAdminAppCheckDependencies(),
      verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid,
      listAdminAccessAudits,
    },
  );
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}
