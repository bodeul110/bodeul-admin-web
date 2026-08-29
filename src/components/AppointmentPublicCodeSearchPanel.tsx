import {useState} from "react";
import type {FormEvent} from "react";
import type {User as FirebaseUser} from "firebase/auth";

import {
  BodeulApiError,
  fetchAppointmentByPublicCode,
  type AppointmentPublicCodeSearchItem,
  type BodeulDataBackend,
} from "../bodeulApi";

type AppointmentPublicCodeSearchPanelProps = {
  readonly currentUser: FirebaseUser | null;
  readonly dataBackend: BodeulDataBackend;
  readonly apiBaseUrl: string;
};

export function AppointmentPublicCodeSearchPanel({
  currentUser,
  dataBackend,
  apiBaseUrl,
}: AppointmentPublicCodeSearchPanelProps) {
  const [publicCode, setPublicCode] = useState("");
  const [item, setItem] = useState<AppointmentPublicCodeSearchItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const isApiMode = dataBackend === "api";

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!currentUser || !isApiMode || isLoading) {
      return;
    }

    const normalizedCode = publicCode.trim().toUpperCase();
    if (!/^BD-[A-Z0-9]{6}$/u.test(normalizedCode)) {
      setItem(null);
      setMessage("BD- 뒤에 영문 대문자 또는 숫자 6자리를 입력해 주세요.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    try {
      const result = await fetchAppointmentByPublicCode(currentUser, normalizedCode, {baseUrl: apiBaseUrl});
      setPublicCode(normalizedCode);
      setItem(result);
    } catch (error) {
      setItem(null);
      setMessage(resolveErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-base font-semibold text-gray-900">예약 코드 검색</h1>
      </header>

      <form onSubmit={(event) => { void search(event); }} className="flex max-w-xl gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-gray-700">예약 코드</span>
          <input
            value={publicCode}
            onChange={(event) => setPublicCode(event.target.value.toUpperCase())}
            placeholder="BD-ABC123"
            autoComplete="off"
            maxLength={9}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium uppercase text-gray-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <button
          type="submit"
          disabled={!currentUser || !isApiMode || isLoading}
          className="mt-6 h-10 rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "검색 중" : "검색"}
        </button>
      </form>

      {!isApiMode && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          PostgreSQL API 모드에서만 예약 코드를 검색할 수 있습니다.
        </p>
      )}
      {message && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {message}
        </p>
      )}

      {item && (
        <section className="max-w-3xl overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
            <div>
              <p className="text-xs font-medium text-gray-500">예약 코드</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{item.publicCode}</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {statusLabel(item.status)}
            </span>
          </div>
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <ResultField label="병원" value={`${item.hospitalName} · ${item.departmentName}`} />
            <ResultField label="예약 일시" value={formatDateTime(item.appointmentAt)} />
            <ResultField label="환자" value={item.patientName || "-"} />
            <ResultField label="보호자" value={item.guardianName || "-"} />
            <ResultField label="배정 매니저" value={item.managerName || "미배정"} />
            <ResultField label="내부 예약 ID" value={item.id} breakAll />
          </dl>
        </section>
      )}
    </div>
  );
}

function ResultField({label, value, breakAll = false}: {label: string; value: string; breakAll?: boolean}) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className={`mt-1 text-sm text-gray-900 ${breakAll ? "break-all" : ""}`}>{value}</dd>
    </div>
  );
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof BodeulApiError) {
    return error.message;
  }
  return "예약 코드 검색 중 알 수 없는 오류가 발생했습니다.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    REQUESTED: "매칭 대기",
    MATCHED: "매칭 완료",
    IN_PROGRESS: "동행 중",
    COMPLETED: "완료",
    CANCELED: "취소",
  };
  return labels[status] || status;
}
