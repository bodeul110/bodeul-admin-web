import {NextResponse} from "next/server";

import {
  handleListAdminRoleAssignments,
  handleRevokeAdminRoleAssignment,
  handleSetAdminRoleAssignment,
} from "../../../server/admin-role-management";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../server/firebase-admin";
import {
  findAppUserByFirebaseUid,
  listAdminRoleAssignments,
  recordAdminAccessAudit,
  revokeAdminRoleAssignment,
  setAdminRoleAssignment,
} from "../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies = () => ({
  ...createAdminAppCheckDependencies(),
  verifyIdToken: verifyFirebaseIdToken,
  findAppUserByFirebaseUid,
  listAdminRoleAssignments,
  recordAdminAccessAudit,
  setAdminRoleAssignment,
  revokeAdminRoleAssignment,
});

export async function GET(request: Request) {
  return respond(await handleListAdminRoleAssignments(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    dependencies(),
  ));
}

export async function PUT(request: Request) {
  return respond(await handleSetAdminRoleAssignment(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    await readBody(request),
    dependencies(),
  ));
}

export async function DELETE(request: Request) {
  return respond(await handleRevokeAdminRoleAssignment(
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
