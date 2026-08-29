import {createHash} from "node:crypto";

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
};

export function matchesManagerReviewOperation(
  data: unknown,
  expected: ManagerReviewOperationPayload,
): boolean {
  if (!isRecord(data)) return false;
  return readText(data.payloadHash) === managerReviewOperationHash(expected);
}

export function managerReviewOperationHash(payload: ManagerReviewOperationPayload): string {
  return createHash("sha256").update(JSON.stringify([
    payload.managerUserId,
    payload.status,
    payload.reviewNote,
    payload.actorAdminUserId,
    payload.actorAdminRole,
  ])).digest("hex");
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
