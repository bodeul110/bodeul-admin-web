import assert from "node:assert/strict";
import test from "node:test";
import {buildAssignmentManagerPage, type ManagerDirectoryRecord} from "./assignment-manager-directory.ts";

const record: ManagerDirectoryRecord = {id: "cb5ac06d-eb00-5a81-b1e0-8fccbb55454a", firebaseUid: "core-manager-uid", name: "", email: ""};

test("Core 후보 UID의 누락된 이름·이메일만 보완하고 이름으로 검색한다", async () => {
  const result = await buildAssignmentManagerPage([record], "시연", async (uids) => {
    assert.deepEqual(uids, [record.firebaseUid]);
    return new Map([[record.firebaseUid, {name: "시연 매니저", email: "manager@example.invalid"}],
      ["not-in-core", {name: "시연 다른 사용자", email: "other@example.invalid"}]]);
  });
  assert.deepEqual(result, {items: [{id: record.id, name: "시연 매니저", email: "manager@example.invalid"}], hasMore: false});
  assert.equal("firebaseUid" in result.items[0], false);
});

test("Core 표시 정보가 있으면 덮어쓰거나 Firestore를 호출하지 않는다", async () => {
  const result = await buildAssignmentManagerPage([{...record, name: "기존 이름", email: "core@example.invalid"}], "CORE", async () => { throw new Error("조회 금지"); });
  assert.equal(result.items[0].name, "기존 이름");
});

test("없는 프로필은 후보를 추가하지 않고 안전한 빈 표시 정보로 유지한다", async () => {
  const result = await buildAssignmentManagerPage([record], "", async () => new Map());
  assert.deepEqual(result.items, [{id: record.id, name: "", email: ""}]);
  assert.equal((await buildAssignmentManagerPage([record], "unknown", async () => new Map())).items.length, 0);
});

test("보완 조회 실패 시 일부 검색 결과를 전체 결과처럼 반환하지 않는다", async () => {
  await assert.rejects(buildAssignmentManagerPage([record], "", async () => { throw new Error("조회 실패"); }));
});

test("검색 후 최대 50명과 추가 결과 여부를 반환한다", async () => {
  const records = Array.from({length: 51}, (_, i) => ({...record, id: `id-${i}`, name: `매니저 ${i}`, email: "test@example.invalid"}));
  const result = await buildAssignmentManagerPage(records, "매니저", async () => new Map());
  assert.equal(result.items.length, 50);
  assert.equal(result.hasMore, true);
  await assert.rejects(buildAssignmentManagerPage(Array(1001).fill(record), "", async () => new Map()));
});
