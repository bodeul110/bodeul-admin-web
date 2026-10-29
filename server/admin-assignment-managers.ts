import {authorizeAdmin, requireAdminRole, type AdminAuthorizationDependencies} from "./admin-auth.ts";
import type {AssignmentManagerPage} from "../src/adminAssignment.ts";

export type AssignmentManagerDependencies = AdminAuthorizationDependencies & {
  readonly listAssignmentManagers: (query: string) => Promise<AssignmentManagerPage>;
};

export async function handleAssignmentManagers(
  authorizationHeader: string | null, appCheckHeader: string | null, query: string,
  dependencies: AssignmentManagerDependencies,
) {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) return authorization.failure;
  const forbidden = requireAdminRole(authorization.actor, ["SUPER_ADMIN", "OPERATIONS"]);
  if (forbidden) return forbidden;
  const normalized = query.trim();
  if (normalized.length > 100) {
    return {status: 400, body: {error: "invalid_manager_query", message: "검색어는 100자 이하여야 합니다."}};
  }
  try {
    return {status: 200, body: await dependencies.listAssignmentManagers(normalized)};
  } catch {
    return {status: 503, body: {error: "manager_lookup_failed", message: "매니저 목록을 불러오지 못했습니다."}};
  }
}
