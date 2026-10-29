export type AssignmentManager = {readonly id: string; readonly name: string; readonly email: string};
export type AssignmentManagerPage = {readonly items: readonly AssignmentManager[]; readonly hasMore: boolean};

export function appointmentVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("예약 버전이 올바르지 않습니다.");
  return Number(value);
}

export function canAssignManager(item: {status: string; managerUserId: string; version: number}): boolean {
  return item.status === "REQUESTED" && !item.managerUserId && Number.isSafeInteger(item.version) && item.version >= 0;
}

export function assignmentManagerLabel(manager: AssignmentManager): string {
  return manager.name ? `${manager.name}${manager.email ? ` (${manager.email})` : ` · ${manager.id}`}`
    : manager.email || `이름 미등록 · ${manager.id}`;
}

export function assignedManagerLabel(item: {managerUserId: string; managerName: string}): string {
  return item.managerUserId ? item.managerName || `이름 미등록 · ${item.managerUserId}` : "미배정";
}

export function parseAssignmentManagers(value: unknown): AssignmentManagerPage {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)
    || !("hasMore" in value) || typeof value.hasMore !== "boolean" || value.items.length > 50) {
    throw new Error("매니저 목록 형식이 올바르지 않습니다.");
  }
  const items = value.items.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(item.id)
      || !("name" in item) || typeof item.name !== "string"
      || !("email" in item) || typeof item.email !== "string") throw new Error("매니저 목록 형식이 올바르지 않습니다.");
    return {id: item.id, name: item.name, email: item.email};
  });
  return {items, hasMore: value.hasMore};
}
