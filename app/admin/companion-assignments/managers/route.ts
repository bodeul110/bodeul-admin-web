import {NextResponse} from "next/server";
import {handleAssignmentManagers} from "../../../../server/admin-assignment-managers";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../../server/firebase-admin";
import {findAppUserByFirebaseUid, listAssignmentManagers} from "../../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await handleAssignmentManagers(request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"), new URL(request.url).searchParams.get("q") || "", {
      ...createAdminAppCheckDependencies(), verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid, listAssignmentManagers,
    });
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}
