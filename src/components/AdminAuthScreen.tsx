import type { FormEvent } from "react";

type AdminAuthScreenProps = {
  isCheckingSession: boolean;
  email: string;
  password: string;
  authError: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  mfaChallenge: {
    active: boolean;
    factors: readonly {uid: string; label: string; factorId: string}[];
    selectedFactorUid: string;
    verificationCode: string;
    smsCodeSent: boolean;
    isBusy: boolean;
    message: string;
  };
  onMfaFactorChange: (uid: string) => void;
  onMfaCodeChange: (value: string) => void;
  onSendMfaCode: () => void;
  onVerifyMfa: (event: FormEvent) => void;
  onCancelMfa: () => void;
};

export function AdminAuthScreen({
  isCheckingSession,
  email,
  password,
  authError,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  mfaChallenge,
  onMfaFactorChange,
  onMfaCodeChange,
  onSendMfaCode,
  onVerifyMfa,
  onCancelMfa,
}: AdminAuthScreenProps) {
  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 font-sans text-sm antialiased">
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-5 text-center shadow-sm">
          <p className="text-sm font-semibold text-gray-900">관리자 세션 확인 중</p>
          <p className="mt-2 text-xs text-gray-500">Firebase 인증 상태를 확인하고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (mfaChallenge.active) {
    const selectedFactor = mfaChallenge.factors.find(
      (factor) => factor.uid === mfaChallenge.selectedFactorUid,
    );
    const isPhone = selectedFactor?.factorId === "phone";
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 font-sans text-sm antialiased">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-base font-semibold text-gray-900">관리자 2차 인증</h1>
          <p className="mb-4 text-xs leading-5 text-gray-500">
            등록된 인증 수단으로 로그인을 완료하세요. 인증이 끝나기 전에는 관리자 기능에 접근할 수 없습니다.
          </p>
          <form onSubmit={onVerifyMfa} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">인증 수단</label>
              <select
                value={mfaChallenge.selectedFactorUid}
                onChange={(event) => onMfaFactorChange(event.target.value)}
                disabled={mfaChallenge.isBusy}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {mfaChallenge.factors.map((factor) => (
                  <option key={factor.uid} value={factor.uid}>{factor.label}</option>
                ))}
              </select>
            </div>

            {isPhone && (
              <button
                type="button"
                onClick={onSendMfaCode}
                disabled={mfaChallenge.isBusy}
                className="w-full rounded-md border border-blue-600 bg-white py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mfaChallenge.smsCodeSent ? "인증 코드 다시 받기" : "인증 코드 받기"}
              </button>
            )}
            <div id="admin-mfa-recaptcha" />

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">6자리 인증 코드</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaChallenge.verificationCode}
                onChange={(event) => onMfaCodeChange(event.target.value.replace(/\D/gu, "").slice(0, 6))}
                required
                minLength={6}
                maxLength={6}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="000000"
              />
            </div>

            {(mfaChallenge.message || authError) && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {mfaChallenge.message || authError}
              </div>
            )}

            <button
              type="submit"
              disabled={mfaChallenge.isBusy || (isPhone && !mfaChallenge.smsCodeSent)}
              className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {mfaChallenge.isBusy ? "인증 확인 중" : "2차 인증 완료"}
            </button>
            <button
              type="button"
              onClick={onCancelMfa}
              disabled={mfaChallenge.isBusy}
              className="w-full rounded-md border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              로그인 취소
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 font-sans text-sm antialiased">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-base font-semibold text-gray-900">관리자 로그인</h1>
        <p className="mb-4 text-xs text-gray-500">
          관리자 계정으로 로그인한 뒤 승인 대시보드에 접근하세요.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="admin@bodeul.app"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="비밀번호 입력"
            />
          </div>

          {authError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {authError}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}
