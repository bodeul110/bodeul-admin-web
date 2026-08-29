import {NextResponse} from "next/server";

import {
  handleLoadManagerDocument,
  parseManagerDocumentReasonBody,
} from "../../../../../../server/admin-manager-reviews";
import {createAdminAppCheckDependencies, verifyFirebaseIdToken} from "../../../../../../server/firebase-admin";
import {
  listManagerReviews,
  loadManagerDocument,
  markManagerReviewAuditDelivered,
  reconcilePendingManagerReviewAudits,
  saveManagerReview,
} from "../../../../../../server/firebase-manager-reviews";
import {findAppUserByFirebaseUid, recordAdminAccessAudit} from "../../../../../../server/postgres";
import {managerDocumentResponseHeaders} from "../../../../../../server/manager-document-response";
import {requireManagerReviewOutboxHmacKey} from "../../../../../../server/manager-review-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  readonly params: Promise<{readonly managerUserId: string; readonly documentKey: string}>;
};

export async function POST(request: Request, context: RouteContext) {
  const params = await context.params;
  let body: unknown = null;
  try { body = await request.json(); } catch { /* 처리기에서 400으로 정규화한다. */ }
  const reason = parseManagerDocumentReasonBody(body);
  const result = await handleLoadManagerDocument(
    request.headers.get("authorization"),
    request.headers.get("x-firebase-appcheck"),
    params.managerUserId,
    params.documentKey,
    reason,
    {
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
    },
  );

  if ("error" in result.body) {
    return NextResponse.json(result.body, {status: result.status, headers: {"Cache-Control": "no-store"}});
  }

  const document = result.body;
  return new Response(Uint8Array.from(document.bytes).buffer, {
    status: 200,
    headers: managerDocumentResponseHeaders(
      document.contentType,
      document.fileName,
      document.updatedAt,
    ),
  });
}
