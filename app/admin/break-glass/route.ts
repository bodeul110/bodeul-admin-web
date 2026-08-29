import {NextResponse} from "next/server";

import {handleGrantAdminBreakGlass, handleRevokeAdminBreakGlass} from "../../../server/admin-break-glass";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../server/firebase-admin";
import {
  findAppUserByFirebaseUid,
  grantAdminBreakGlass,
  recordAdminAccessAudit,
  revokeAdminBreakGlass,
} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies = () => ({
  ...createAdminAppCheckDependencies(),
  verifyIdToken: verifyFirebaseIdToken,
  findAppUserByFirebaseUid,
  grantAdminBreakGlass,
  recordAdminAccessAudit,
  revokeAdminBreakGlass,
});

export async function POST(request: Request) {
  return respond(await handleGrantAdminBreakGlass(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    await readBody(request),
    dependencies(),
  ));
}

export async function DELETE(request: Request) {
  return respond(await handleRevokeAdminBreakGlass(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    await readBody(request),
    dependencies(),
  ));
}

async function readBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

function respond(result: {readonly status: number; readonly body: unknown}) {
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}
