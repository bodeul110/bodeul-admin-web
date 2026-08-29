import {NextResponse} from "next/server";

import {handleAdminAppointmentSearch} from "../../../../server/admin-appointment-search";
import {
  createAdminAppCheckDependencies,
  verifyFirebaseIdToken,
} from "../../../../server/firebase-admin";
import {
  findAppointmentByPublicCode,
  findAppUserByFirebaseUid,
} from "../../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const result = await handleAdminAppointmentSearch(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    typeof body?.publicCode === "string" ? body.publicCode : null,
    {
      ...createAdminAppCheckDependencies(),
      verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid,
      findAppointmentByPublicCode,
    },
  );

  return NextResponse.json(result.body, {
    status: result.status,
    headers: {"Cache-Control": "no-store"},
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json() as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
