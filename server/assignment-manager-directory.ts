import type {AssignmentManager, AssignmentManagerPage} from "../src/adminAssignment.ts";

export type ManagerDirectoryRecord = AssignmentManager & {readonly firebaseUid: string};
export type ManagerDisplayProfile = {readonly name: string; readonly email: string};

export async function buildAssignmentManagerPage(
  records: readonly ManagerDirectoryRecord[], query: string,
  readProfiles: (uids: readonly string[]) => Promise<ReadonlyMap<string, ManagerDisplayProfile>>,
): Promise<AssignmentManagerPage> {
  // 현재 MVP의 전체 후보 검색을 보장하되 무제한 프로필 조회는 허용하지 않는다.
  if (records.length > 1000) throw new Error("매니저 디렉터리 검색 인덱스 확장이 필요합니다.");
  const missing = records.filter((record) => !record.name.trim() || !record.email.trim());
  const profiles = missing.length ? await readProfiles(missing.map((record) => record.firebaseUid)) : new Map();
  const normalized = query.toLocaleLowerCase("ko-KR");
  const items = records.map((record) => {
    const profile = profiles.get(record.firebaseUid);
    return {id: record.id, name: record.name.trim() || profile?.name.trim() || "",
      email: record.email.trim() || profile?.email.trim() || ""};
  }).filter((item) => `${item.name} ${item.email}`.toLocaleLowerCase("ko-KR").includes(normalized))
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR") || left.email.localeCompare(right.email) || left.id.localeCompare(right.id));
  return {items: items.slice(0, 50), hasMore: items.length > 50};
}
