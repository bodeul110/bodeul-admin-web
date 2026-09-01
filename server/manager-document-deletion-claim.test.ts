import assert from "node:assert/strict";
import test from "node:test";

import {managerDocumentDeletionClaimBlocksAdminWrite} from "./manager-document-deletion-claim.ts";

test("삭제 claim이 없을 때만 관리자 심사 변경을 허용한다", () => {
  assert.equal(managerDocumentDeletionClaimBlocksAdminWrite({managerDocumentStatus: "PENDING_REVIEW"}), false);
  assert.equal(managerDocumentDeletionClaimBlocksAdminWrite(null), false);
});

test("형식이 불완전한 삭제 claim도 관리자 쓰기를 차단한다", () => {
  for (const claim of [null, false, "", {}, {claimId: "forged"}]) {
    assert.equal(
      managerDocumentDeletionClaimBlocksAdminWrite({managerDocumentDeletionClaim: claim}),
      true,
    );
  }
});
