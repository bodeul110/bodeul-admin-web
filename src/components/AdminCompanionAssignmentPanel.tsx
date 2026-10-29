import {useEffect, useRef, useState} from "react";
import type {User as FirebaseUser} from "firebase/auth";
import {assignAdminManager, BodeulApiError, fetchAssignmentManagers, type AppointmentPublicCodeSearchItem} from "../bodeulApi";
import {assignmentManagerLabel, canAssignManager, type AssignmentManagerPage} from "../adminAssignment";

type Props = {
  currentUser: FirebaseUser; item: AppointmentPublicCodeSearchItem; apiBaseUrl: string;
  onBusyChange: (busy: boolean) => void; onAssigned: () => Promise<void>;
};

export function AdminCompanionAssignmentPanel({currentUser, item, apiBaseUrl, onBusyChange, onAssigned}: Props) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({query: "", revision: 0});
  const [page, setPage] = useState<AssignmentManagerPage>({items: [], hasMore: false});
  const [managerId, setManagerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const submitting = useRef(false);
  const assignable = canAssignManager(item);

  useEffect(() => {
    if (!assignable) return;
    const controller = new AbortController();
    void fetchAssignmentManagers(currentUser, search.query, apiBaseUrl, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPage(result); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(error instanceof BodeulApiError ? error.message : "매니저 목록을 불러오지 못했습니다.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentUser, apiBaseUrl, search, assignable]);

  async function assign() {
    const manager = page.items.find((candidate) => candidate.id === managerId);
    if (!manager || !assignable || loading || locked || submitting.current) return;
    const confirmation = ["다음 예약에 매니저를 배정하시겠습니까?", item.publicCode,
      `환자: ${item.patientName || "이름 미등록"}`, `${item.hospitalName} · ${item.departmentName}`,
      new Date(item.appointmentAt).toLocaleString("ko-KR"), `매니저: ${assignmentManagerLabel(manager)}`].join("\n");
    if (!window.confirm(confirmation)) return;
    submitting.current = true;
    setPosting(true);
    onBusyChange(true);
    setMessage("");
    // 응답 유실 때도 재전송하지 않는다. 새 조회로 확정 상태를 확인한 뒤에만 다음 작업을 허용한다.
    setLocked(true);
    try {
      await assignAdminManager(currentUser, {appointmentRequestId: item.id, managerUserId: manager.id,
        expectedAppointmentVersion: item.version, reason: reason.trim()}, apiBaseUrl);
      setCompleted(true);
      setMessage("매니저 배정이 완료되었습니다.");
      try { await onAssigned(); } catch { setMessage("매니저 배정은 완료됐지만 최신 예약 조회에 실패했습니다. 예약을 다시 검색해 주세요."); }
    } catch (error) {
      setMessage(`${error instanceof BodeulApiError ? error.message : "배정 결과를 확인하지 못했습니다."} 예약을 다시 검색한 뒤 상태를 확인해 주세요.`);
    } finally {
      submitting.current = false;
      setPosting(false);
      onBusyChange(false);
    }
  }

  return <section className="max-w-3xl space-y-3 border-t border-gray-200 pt-4" aria-labelledby="assignment-title">
    <h2 id="assignment-title" className="text-sm font-semibold text-gray-900">매니저 배정</h2>
    {message && <p role="status" className={`text-sm ${completed ? "text-green-700" : "text-red-700"}`}>{message}</p>}
    {!assignable ? <p className="text-sm text-gray-600">현재 예약은 신규 배정 대상이 아닙니다.</p> : <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (posting || locked) return;
        setLoading(true); setManagerId(""); setPage({items: [], hasMore: false}); setMessage("");
        setSearch({query: query.trim(), revision: search.revision + 1});
      }}>
        <label className="min-w-0 flex-1 text-xs font-medium text-gray-700">이름 또는 이메일
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} disabled={posting || locked}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={posting || locked || loading} className="h-10 shrink-0 rounded-md border border-gray-300 px-3 text-sm disabled:opacity-50">매니저 검색</button>
      </form>
      {loading ? <p role="status" className="text-sm text-gray-600">매니저 조회 중</p> : <>
        {!page.items.length ? <p className="text-sm text-gray-600">일치하는 매니저가 없습니다.</p> : <label className="block text-xs font-medium text-gray-700">배정 매니저 선택
          <select value={managerId} onChange={(event) => setManagerId(event.target.value)} disabled={posting || locked}
            className="mt-1 block h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm">
            <option value="">선택 안 함</option>
            {page.items.map((manager) => <option key={manager.id} value={manager.id}>{assignmentManagerLabel(manager)}</option>)}
          </select>
        </label>}
        {page.hasMore && <p className="text-xs text-amber-700">검색 결과가 50명을 초과합니다. 검색어를 더 구체적으로 입력해 주세요.</p>}
      </>}
      <label className="block text-xs font-medium text-gray-700">배정 메모 (선택)
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} disabled={posting || locked}
          className="mt-1 block w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </label>
      <button type="button" onClick={() => { void assign(); }} disabled={!managerId || loading || posting || locked}
        className="h-10 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {posting ? "배정 중" : "매니저 배정"}
      </button>
    </>}
  </section>;
}
