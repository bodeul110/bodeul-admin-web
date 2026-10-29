import {NextResponse} from "next/server";
import {handleAssignmentManagers} from "../../../../server/admin-assignment-managers";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../../server/firebase-admin";
import {findAppUserByFirebaseUid, listAssignmentManagers, recordAdminAccessAudit} from "../../../../server/postgres";
import {readAssignmentManagerProfiles} from "../../../../server/firebase-assignment-manager-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await handleAssignmentManagers(request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"), new URL(request.url).searchParams.get("q") || "", {
      ...createAdminAppCheckDependencies(), verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid,
      listAssignmentManagers: async (query, actorAdminUserId) => {
        const page = await listAssignmentManagers(query, readAssignmentManagerProfiles);
        await recordAdminAccessAudit({actorAdminUserId, action: "VIEW", resourceType: "companion_assignment_managers",
          resourceId: "directory", reason: "배정 매니저 후보 조회", outcome: "ALLOWED", metadata: {resultCount: page.items.length}});
        return page;
      },
    });
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}
