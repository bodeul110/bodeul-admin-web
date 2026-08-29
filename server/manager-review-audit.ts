import type {AdminAuditCommand} from "./postgres.ts";
import type {AdminDetailRole} from "./admin-auth.ts";
import {managerReviewOperationHash} from "./manager-review-outbox.ts";

export type ManagerReviewAuditInput = {
  readonly actorAdminUserId: string;
  readonly managerUserId: string;
  readonly status: "APPROVED" | "REJECTED";
  readonly reviewNote: string;
  readonly actorAdminRole: AdminDetailRole;
  readonly operationId: string;
};

export function createManagerReviewAuditCommand(
  input: ManagerReviewAuditInput,
  hmacKey: string,
): AdminAuditCommand {
  const payloadHash = managerReviewOperationHash({
    managerUserId: input.managerUserId,
    status: input.status,
    reviewNote: input.reviewNote,
    actorAdminUserId: input.actorAdminUserId,
    actorAdminRole: input.actorAdminRole,
  }, hmacKey);
  return {
    actorAdminUserId: input.actorAdminUserId,
    action: "UPDATE",
    resourceType: "MANAGER_REVIEW",
    resourceId: input.managerUserId,
    reason: input.reviewNote,
    outcome: "ALLOWED",
    metadata: {
      status: input.status,
      operationId: input.operationId,
      actorAdminRole: input.actorAdminRole,
      payloadHash,
    },
    operationId: input.operationId,
  };
}
