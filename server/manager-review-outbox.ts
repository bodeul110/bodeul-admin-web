import {createHmac, timingSafeEqual} from "node:crypto";

const MANAGER_REVIEW_OUTBOX_HMAC_DOMAIN = "bodeul:manager-review-outbox:v1\0";
const MINIMUM_HMAC_KEY_BYTES = 32;

export type PendingAuditOutboxItem = {
  readonly id: string;
  readonly data: unknown;
};

export type ManagerReviewOperationPayload = {
  readonly managerUserId: string;
  readonly status: "APPROVED" | "REJECTED";
  readonly reviewNote: string;
  readonly actorAdminUserId: string;
  readonly actorAdminRole: "SUPER_ADMIN" | "OPERATIONS" | "DEVELOPER";
  readonly documentEvidenceDigest: string;
  readonly submissionRevision: string;
};

export function matchesManagerReviewOperation(
  data: unknown,
  expected: ManagerReviewOperationPayload,
  hmacKey: string,
): boolean {
  if (!isRecord(data)) return false;
  const actualHash = readText(data.payloadHash);
  if (!/^[0-9a-f]{64}$/u.test(actualHash)) return false;
  const expectedHash = managerReviewOperationHash(expected, hmacKey);
  return timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

export function requireManagerReviewOutboxHmacKey(value: string | undefined): string {
  const key = value || "";
  if (!key.trim() || Buffer.byteLength(key, "utf8") < MINIMUM_HMAC_KEY_BYTES) {
    throw new Error("매니저 심사 outbox HMAC 키는 32바이트 이상이어야 합니다.");
  }
  return key;
}

export function managerReviewOperationHash(
  payload: ManagerReviewOperationPayload,
  hmacKey: string,
): string {
  return createHmac("sha256", requireManagerReviewOutboxHmacKey(hmacKey))
    .update(MANAGER_REVIEW_OUTBOX_HMAC_DOMAIN)
    .update(JSON.stringify([
      payload.managerUserId,
      payload.status,
      payload.reviewNote,
      payload.actorAdminUserId,
      payload.actorAdminRole,
      payload.documentEvidenceDigest,
      payload.submissionRevision,
    ]))
    .digest("hex");
}

export function managerReviewAuditTombstoneExpiresAt(deliveredAtMillis: number): number {
  const deliveredAt = new Date(deliveredAtMillis);
  if (!Number.isFinite(deliveredAt.getTime())) {
    throw new Error("감사 전달 시각이 올바르지 않습니다.");
  }
  const targetYear = deliveredAt.getUTCFullYear() + 1;
  const targetMonth = deliveredAt.getUTCMonth();
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  deliveredAt.setUTCFullYear(targetYear, targetMonth, Math.min(deliveredAt.getUTCDate(), lastTargetDay));
  return deliveredAt.getTime();
}

export async function processPendingAuditOutbox<TCommand>(
  items: readonly PendingAuditOutboxItem[],
  createCommand: (item: PendingAuditOutboxItem) => TCommand,
  recordAudit: (command: TCommand) => Promise<string>,
  markDelivered: (operationId: string, auditId: string) => Promise<void>,
  recordFailure: (operationId: string) => void,
): Promise<number> {
  let delivered = 0;
  for (const item of items) {
    try {
      const command = createCommand(item);
      const auditId = await recordAudit(command);
      await markDelivered(item.id, auditId);
      delivered += 1;
    } catch {
      recordFailure(item.id);
    }
  }
  return delivered;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
