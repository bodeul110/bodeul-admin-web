import {NextResponse} from "next/server";
import {handleAdminPayment, paymentWritesEnabled} from "../../../../../server/admin-payments";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../../../server/firebase-admin";
import {findAppUserByFirebaseUid, readAdminPayment, transitionAdminPayment} from "../../../../../server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{appointmentRequestId: string}>};

export async function GET(request: Request, context: Context) { return handle(request, context, "GET"); }
export async function PATCH(request: Request, context: Context) { return handle(request, context, "PATCH"); }

async function handle(request: Request, context: Context, method: "GET" | "PATCH") {
  const {appointmentRequestId} = await context.params;
  let body: unknown = null;
  if (method === "PATCH") {
    try { body = await request.json(); } catch { /* 처리기가 400 응답으로 정규화한다. */ }
  }
  const result = await handleAdminPayment(method, request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"), appointmentRequestId, body, {
      ...createAdminAppCheckDependencies(), verifyIdToken: verifyFirebaseIdToken,
      findAppUserByFirebaseUid, readPayment: readAdminPayment, transitionPayment: transitionAdminPayment,
      transitionsEnabled: paymentWritesEnabled({enabled: process.env.ADMIN_BANK_TRANSFER_WRITES_ENABLED,
        vercelEnv: process.env.VERCEL_ENV, nodeEnv: process.env.NODE_ENV}),
    });
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}
