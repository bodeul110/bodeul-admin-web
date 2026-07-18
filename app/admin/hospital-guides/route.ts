import {NextResponse} from "next/server";

import {handleAdminHospitalGuides} from "../../../server/admin-hospital-guides";
import {verifyFirebaseIdToken} from "../../../server/firebase-admin";
import {findAppUserByFirebaseUid, listHospitalGuides} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await handleAdminHospitalGuides(
    request.headers.get("authorization"),
    url.searchParams.get("limit"),
    {
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
