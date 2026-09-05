import {useEffect, useRef, useState, type FormEvent} from "react";
import type {User as FirebaseUser} from "firebase/auth";
import {BodeulApiError, fetchAdminPayment, transitionAdminPayment} from "../bodeulApi";
import {availablePaymentTargets, PAYMENT_LABELS, type AdminPaymentPayload, type PaymentCommand, type PaymentTarget} from "../adminPayment";

type Props = {currentUser: FirebaseUser; appointmentRequestId: string; apiBaseUrl: string};

export function AdminPaymentPanel({currentUser, appointmentRequestId, apiBaseUrl}: Props) {
  const [data, setData] = useState<AdminPaymentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [target, setTarget] = useState<PaymentTarget | "">("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<PaymentCommand | null>(null);
  const submission = useRef(false);

  useEffect(() => {
    const abort = new AbortController();
    fetchAdminPayment(currentUser, appointmentRequestId, apiBaseUrl, abort.signal)
      .then(result => { if (!abort.signal.aborted) setData(result); })
      .catch(failure => { if (!abort.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [currentUser, appointmentRequestId, apiBaseUrl]);

  async function reload() {
    if (loading || submission.current || pending) return;
    setLoading(true);
    setError("");
    setMessage("");
    setData(null);
    try {
      setData(await fetchAdminPayment(currentUser, appointmentRequestId, apiBaseUrl));
      setStale(false);
      setTarget("");
      setAmount("");
      setReason("");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!data || !data.transitionsEnabled || submission.current || loading || stale) return;
    const payment = data.payment;
    if (!pending && (!target || !availablePaymentTargets(payment).includes(target))) return;
    const command: PaymentCommand = pending ?? {
      operationId: crypto.randomUUID(), paymentVersion: payment.paymentVersion,
      targetStatus: target as PaymentTarget,
      receivedAmount: target === "DEPOSIT_CONFIRMED" || target === "REVIEW_REQUIRED" ? Number(amount) : null,
      reason: reason.trim(),
    };
    if (!pending && !window.confirm(`${payment.publicCode} 예약을 '${PAYMENT_LABELS[command.targetStatus]}' 상태로 기록할까요?\n실제 송금이나 환불을 실행하지 않습니다.`)) return;
    submission.current = true;
    setSaving(true);
    setPending(command);
    setError("");
    setMessage("");
    try {
      setData(await transitionAdminPayment(currentUser, appointmentRequestId, command, apiBaseUrl));
      setPending(null);
      setTarget("");
      setAmount("");
      setReason("");
      setMessage("상태 변경을 기록했습니다.");
    } catch (failure) {
      const status = failure instanceof BodeulApiError ? failure.statusCode : null;
      // 전송 결과가 불명확할 때 작업 ID와 원문을 보존하여 중복 처리를 막는다.
      if (status !== null && status >= 400 && status < 500) {
        setPending(null);
        setStale(true);
        setError(`${errorMessage(failure)} 최신 정보를 다시 조회해 주세요.`);
      } else {
        setError("처리 결과를 확인하지 못했습니다. 입력 내용은 잠갔으며 같은 요청으로 재시도할 수 있습니다.");
      }
    } finally {
      submission.current = false;
      setSaving(false);
    }
  }

  const payment = data?.payment;
  const targets = payment ? availablePaymentTargets(payment) : [];
  const locked = loading || saving || stale || !data?.transitionsEnabled || Boolean(pending);
  const needsAmount = target === "DEPOSIT_CONFIRMED" || target === "REVIEW_REQUIRED";
  const validAmount = !needsAmount || (amount.trim() !== "" && Number.isSafeInteger(Number(amount))
    && Number(amount) >= 0 && Number(amount) <= 2147483647);

  return (
    <section aria-labelledby="admin-payment-heading" aria-busy={loading || saving} className="max-w-5xl space-y-4 border-t border-gray-200 pt-5">
      <header className="flex items-center justify-between gap-3">
        <h2 id="admin-payment-heading" className="text-base font-semibold text-gray-900">무통장입금 처리</h2>
        <button type="button" onClick={() => { void reload(); }} disabled={loading || saving || Boolean(pending)}
          title="결제 정보 다시 조회" aria-label="결제 정보 다시 조회"
          className="h-9 w-9 shrink-0 rounded-md border border-gray-300 text-xl text-gray-700 disabled:opacity-40">↻</button>
      </header>
      {loading && <p role="status" className="text-sm text-gray-500">결제 정보를 확인하고 있습니다.</p>}
      {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {payment && <>
        <div className="flex flex-wrap items-center gap-3">
          <strong className="text-sm text-gray-900">{PAYMENT_LABELS[payment.paymentStatusCode]}</strong>
          <span className="text-xs text-gray-500">버전 {payment.paymentVersion}</span>
          {payment.appointmentStatus === "CANCELED" && <span className="text-xs font-medium text-red-700">취소된 예약</span>}
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="입금자명" value={payment.depositorName || "미등록"} />
          <Field label="예상 금액" value={money(payment.expectedAmount)} />
          <Field label="기록된 입금액" value={money(payment.receivedAmount)} />
          <Field label="입금 기한" value={date(payment.paymentDueAt)} />
          <Field label="입금 확인 시각" value={date(payment.confirmedAt)} />
          <Field label="확인 담당자 ID" value={payment.confirmedByAdminUserId || "기록 없음"} />
          <Field label="환불 요청 시각" value={date(payment.refundRequestedAt)} />
          <Field label="환불 완료 시각" value={date(payment.refundedAt)} />
        </dl>
        {!data.transitionsEnabled && <p className="text-sm text-amber-800">이 환경에서는 결제 상태 변경이 잠겨 있습니다.</p>}
        {targets.length > 0 && <form onSubmit={event => { void submit(event); }} className="space-y-3 border-y border-gray-200 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">처리 상태
              <select value={target} onChange={event => { setTarget(event.target.value as PaymentTarget); setAmount(""); }} disabled={locked} required className={inputClass}>
                <option value="">선택</option>
                {targets.map(value => <option key={value} value={value}>{PAYMENT_LABELS[value]}</option>)}
              </select>
            </label>
            {needsAmount && <label className="block text-sm text-gray-700">확인한 입금액 (원)
              <input type="number" inputMode="numeric" min="0" max="2147483647" step="1" required value={amount}
                onChange={event => setAmount(event.target.value)} disabled={locked} className={inputClass} />
            </label>}
          </div>
          <label className="block text-sm text-gray-700">처리 사유
            <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500}
              required rows={3} disabled={locked} className={inputClass} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-gray-500">{reason.trim().length}/500자</span>
            <button type="submit" disabled={saving || loading || stale || !data.transitionsEnabled
                || (!pending && (!target || !validAmount || reason.trim().length < 10))}
              className="min-h-10 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? "기록 중" : pending ? "같은 요청 재시도" : "상태 변경 기록"}
            </button>
          </div>
        </form>}
        {targets.length === 0 && <p className="text-sm text-gray-500">종료된 결제 처리입니다.</p>}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">처리 이력</h3>
          {payment.hasMoreEvents && <p className="text-xs text-amber-800">최근 20건만 표시됩니다. 이전 기록은 별도 감사 조회가 필요합니다.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="border-y border-gray-200 bg-gray-50 text-gray-600"><tr>
                <th className="p-2">시각</th><th className="p-2">처리</th><th className="p-2">담당</th><th className="p-2">금액</th><th className="p-2">사유</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">{payment.events.map(event => <tr key={event.id}>
                <td className="p-2 align-top">{date(event.createdAt)}</td>
                <td className="p-2 align-top">{PAYMENT_LABELS[event.eventType] || event.eventType}</td>
                <td className="max-w-40 break-all p-2 align-top">{actor(event.actorRole)}{event.actorRole === "ADMIN" && event.actorUserId && <span className="mt-1 block text-gray-500">{event.actorUserId}</span>}</td>
                <td className="whitespace-nowrap p-2 align-top">{money(event.receivedAmount)}</td>
                <td className="max-w-80 break-words p-2 align-top">{event.reason || "-"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {payment.events.length === 0 && <p className="text-sm text-gray-500">처리 이력이 없습니다.</p>}
        </div>
      </>}
    </section>
  );
}

const inputClass = "mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500";
function Field({label, value}: {label: string; value: string}) {
  return <div className="min-w-0"><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 break-words text-gray-900">{value}</dd></div>;
}
function money(value: number | null) { return value === null ? "기록 없음" : `${value.toLocaleString("ko-KR")}원`; }
function date(value: string | null) { return value ? new Date(value).toLocaleString("ko-KR") : "기록 없음"; }
function actor(role: string) { return ({ADMIN: "관리자", PATIENT: "환자", SYSTEM: "시스템"} as Record<string, string>)[role] || role; }
function errorMessage(error: unknown) {
  return error instanceof BodeulApiError ? error.message : "결제 정보를 확인하지 못했습니다. 다시 시도해 주세요.";
}
