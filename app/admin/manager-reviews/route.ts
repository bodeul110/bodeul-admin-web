import {NextResponse} from "next/server";

import {handleListManagerReviews, handleSaveManagerReview} from "../../../server/admin-manager-reviews";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../server/firebase-admin";
import {
  listManagerReviews,
  loadManagerDocument,
  markManagerReviewAuditDelivered,
  reconcilePendingManagerReviewAudits,
  saveManagerReview,
} from "../../../server/firebase-manager-reviews";
import {findAppUserByFirebaseUid, recordAdminAccessAudit} from "../../../server/postgres";
import {requireManagerReviewOutboxHmacKey} from "../../../server/manager-review-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies = () => ({
  ...createAdminAppCheckDependencies(),
  verifyIdToken: verifyFirebaseIdToken,
  findAppUserByFirebaseUid,
  listManagerReviews,
  saveManagerReview,
  getManagerReviewOutboxHmacKey: () => requireManagerReviewOutboxHmacKey(
    process.env.MANAGER_REVIEW_OUTBOX_HMAC_KEY,
  ),
  markManagerReviewAuditDelivered,
  reconcilePendingManagerReviewAudits: () => reconcilePendingManagerReviewAudits(
    recordAdminAccessAudit,
    requireManagerReviewOutboxHmacKey(process.env.MANAGER_REVIEW_OUTBOX_HMAC_KEY),
  ),
  loadManagerDocument,
  recordAdminAccessAudit,
});

export async function GET(request: Request) {
  const result = await handleListManagerReviews(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    dependencies(),
  );
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}

export async function POST(request: Request) {
  let body: unknown = null;
  try { body = await request.json(); } catch { /* 처리기에서 400으로 정규화한다. */ }
  const result = await handleSaveManagerReview(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    body,
    dependencies(),
  );
  return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
}
