import {NextResponse} from "next/server";

import {handleAdminHospitalGuides} from "../../../server/admin-hospital-guides";
import {
  createAdminAppCheckDependencies,
  verifyFirebaseIdToken,
} from "../../../server/firebase-admin";
import {findAppUserByFirebaseUid, listHospitalGuides} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await handleAdminHospitalGuides(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    url.searchParams.get("limit"),
    {
      ...createAdminAppCheckDependencies(),
      verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid,
      listHospitalGuides,
    },
  );

  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
