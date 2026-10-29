import type {AdminManagerReviewDependencies} from "./admin-manager-reviews.ts";
import {resolveManagerListAuthMode, type ManagerListEnvironment} from "./manager-list-reader-policy.ts";

export function createManagerListDependencies(
  dependencies: AdminManagerReviewDependencies,
  env: ManagerListEnvironment,
  readWithDedicatedCredential: AdminManagerReviewDependencies["listManagerReviews"],
): AdminManagerReviewDependencies {
  return {
    ...dependencies,
    // 인증·역할 검사 뒤에만 모드 선택과 credential 초기화를 실행한다.
    listManagerReviews: () => resolveManagerListAuthMode(env) === "json-reader"
      ? readWithDedicatedCredential() : dependencies.listManagerReviews(),
    reconcilePendingManagerReviewAudits: () => resolveManagerListAuthMode(env) === "json-reader"
      // 읽기 전용 GET에서 보정·삭제를 보류하며 기존 큐 항목을 변경하지 않는다.
      ? Promise.resolve(0) : dependencies.reconcilePendingManagerReviewAudits(),
  };
}
