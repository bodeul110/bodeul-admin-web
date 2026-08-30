type ManagerDocumentKey = "license" | "nursingLicense";
type ReviewStatus = "APPROVED" | "REJECTED";
type DocumentPreview = {
  status: string;
  fileName: string;
  contentType: string;
  downloadUrl: string;
  fullPath: string;
  uploadedAtLabel: string;
  message: string;
  evidenceToken: string;
};

type ManagerReviewModalProps = {
  selectedManager: {
    id: string;
    name: string;
    email: string;
    phone: string;
    date: string;
    status: string;
    documentSummary: string;
    reviewNote: string;
  };
  activeDoc: ManagerDocumentKey;
  setActiveDoc: (key: ManagerDocumentKey) => void;
  docStatus: Record<ManagerDocumentKey, string>;
  rejectReason: string;
  setRejectReason: (value: string) => void;
  isSubmitting: boolean;
  allDocsChecked: boolean;
  hasDocumentSummary: boolean;
  checkedCount: number;
  totalDocumentCount: number;
  selectedManagerUploadedCount: number;
  selectedManagerMissingCount: number;
  documentPreviews: Record<ManagerDocumentKey, DocumentPreview>;
  documents: Array<{ key: ManagerDocumentKey; label: string; helper: string }>;
  statusBadgeClass: Record<string, string>;
  previewBadgeClass: Record<string, string>;
  previewBadgeLabel: Record<string, string>;
  documentLabelMap: Record<ManagerDocumentKey, string>;
  onClose: () => void;
  onToggleDocStatus: (key: ManagerDocumentKey) => void;
  onSaveReview: (status: ReviewStatus) => Promise<void>;
  isImageDocument: (preview: DocumentPreview) => boolean;
  watermarkLabel: string;
};

export function ManagerReviewModal({
  selectedManager,
  activeDoc,
  setActiveDoc,
  docStatus,
  rejectReason,
  setRejectReason,
  isSubmitting,
  allDocsChecked,
  hasDocumentSummary,
  checkedCount,
  totalDocumentCount,
  selectedManagerUploadedCount,
  selectedManagerMissingCount,
  documentPreviews,
  documents,
  statusBadgeClass,
  previewBadgeClass,
  previewBadgeLabel,
  documentLabelMap,
  onClose,
  onToggleDocStatus,
  onSaveReview,
  isImageDocument,
  watermarkLabel,
}: ManagerReviewModalProps) {
  const activePreview = documentPreviews[activeDoc];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-[1280px] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{selectedManager.name} 서류 심사</h2>
            <p className="mt-1 text-xs text-gray-500">
              제출 요약과 서버가 만든 보호 미리보기를 확인하고 현재 상태를 저장하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
          >
            닫기
          </button>
        </div>

        <div className="grid gap-3 border-b border-gray-100 bg-gray-50 px-6 py-4 md:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">현재 상태</p>
            <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusBadgeClass[selectedManager.status]}`}>
              {selectedManager.status}
            </span>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">제출 파일</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{selectedManagerUploadedCount}/{totalDocumentCount}</p>
            <p className="mt-1 text-xs text-gray-500">
              {selectedManagerMissingCount === 0 ? "필수 파일 업로드 완료" : `${selectedManagerMissingCount}개 파일이 더 필요합니다.`}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">체크리스트 진행</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{checkedCount}/{totalDocumentCount}</p>
            <p className="mt-1 text-xs text-gray-500">보호 미리보기를 확인한 항목 수</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">제출 상태</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{hasDocumentSummary ? "요약 제출됨" : "요약 미제출"}</p>
            <p className="mt-1 text-xs text-gray-500">가입일 {selectedManager.date || "-"}</p>
          </div>
        </div>

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <section className="space-y-4 self-start rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900">제출 정보</h3>
            <div className="space-y-2 text-xs text-gray-600">
              <p><span className="font-medium text-gray-800">이메일</span> {selectedManager.email || "-"}</p>
              <p><span className="font-medium text-gray-800">전화번호</span> {selectedManager.phone || "-"}</p>
              <p><span className="font-medium text-gray-800">가입일</span> {selectedManager.date || "-"}</p>
              <p><span className="font-medium text-gray-800">현재 상태</span> {selectedManager.status}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-700 shadow-sm">
              <p className="mb-1 font-medium text-gray-900">제출 요약</p>
              <p className="whitespace-pre-wrap leading-5">
                {selectedManager.documentSummary || "제출된 서류 요약이 없습니다."}
              </p>
            </div>
            {selectedManager.reviewNote && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                <p className="mb-1 font-medium">최근 검토 메모</p>
                <p className="whitespace-pre-wrap leading-5">{selectedManager.reviewNote}</p>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {documents.map((documentInfo) => {
                const preview = documentPreviews[documentInfo.key];
                const isActive = activeDoc === documentInfo.key;
                return (
                  <button
                    key={documentInfo.key}
                    type="button"
                    onClick={() => setActiveDoc(documentInfo.key)}
                    className={`rounded-xl border px-4 py-3 text-left text-xs transition ${
                      isActive
                        ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <p className="font-semibold">{documentInfo.label}</p>
                    <p className="mt-1 text-[11px] leading-4 text-gray-500">{documentInfo.helper}</p>
                    <p className="mt-2 truncate text-[11px] text-gray-500">
                      {preview.fileName || "원본 파일 없음"}
                    </p>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${previewBadgeClass[preview.status]}`}>
                      {previewBadgeLabel[preview.status]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 border-b border-gray-100 pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{documentLabelMap[activeDoc]} 보호 미리보기</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    확인 사유를 기록한 뒤 서버가 만든 워터마크 파생본만 이 화면에서 미리봅니다.
                  </p>
                </div>
                <div className="flex items-center">
                  <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${previewBadgeClass[activePreview.status]}`}>
                    {previewBadgeLabel[activePreview.status]}
                  </span>
                </div>
              </div>

              {activePreview.status === "loading" && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-10 text-center text-sm text-blue-700">
                  서버에서 보호 미리보기를 만드는 중입니다.
                </div>
              )}

              {activePreview.status === "missing" && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <p>{activePreview.message}</p>
                </div>
              )}

              {activePreview.status === "error" && (
                <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <p>{activePreview.message}</p>
                  {activePreview.fullPath && (
                    <p className="text-xs text-red-600">
                      저장 경로: <span className="font-mono">{activePreview.fullPath}</span>
                    </p>
                  )}
                </div>
              )}

              {activePreview.status === "ready" && (
                <div className="space-y-4">
                  <div className="grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600 md:grid-cols-2">
                    <p><span className="font-medium text-gray-800">파일명</span> {activePreview.fileName || "-"}</p>
                    <p><span className="font-medium text-gray-800">형식</span> {activePreview.contentType || "-"}</p>
                    <p><span className="font-medium text-gray-800">업로드 시각</span> {activePreview.uploadedAtLabel || "-"}</p>
                    <p className="truncate">
                      <span className="font-medium text-gray-800">전달 경로</span> {activePreview.fullPath}
                    </p>
                  </div>

                  {isImageDocument(activePreview) && (
                    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                      <img
                        src={activePreview.downloadUrl}
                        alt={`${documentLabelMap[activeDoc]} 미리보기`}
                        className="h-[420px] w-full object-contain"
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                        <span className="rotate-[-18deg] border border-white/50 bg-slate-900/45 px-5 py-2 text-sm font-semibold text-white/80 shadow-sm">
                          {watermarkLabel}
                        </span>
                      </div>
                    </div>
                  )}

                  {!isImageDocument(activePreview) && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                      PDF는 안전한 격리 렌더러가 준비될 때까지 미리보기를 지원하지 않습니다. 이미지로 다시 제출해 주세요.
                    </div>
                  )}

                  <p className="text-xs text-gray-500">
                    원본은 브라우저에 전달하지 않으며 서버가 만든 워터마크 파생본만 표시합니다.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4 self-start rounded-2xl border border-gray-200 bg-gray-50 p-4 lg:sticky lg:top-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">검토 체크리스트</h3>
              <p className="mt-1 text-xs text-gray-500">
                보호 미리보기를 확인한 항목만 체크하세요.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">검토 진행</p>
              <p className="mt-2 text-lg font-semibold text-gray-900">{checkedCount}/{totalDocumentCount}</p>
              <p className="mt-1 text-xs text-gray-500">
                {allDocsChecked ? "현재 자격 증빙 확인 완료" : "확인한 보호 미리보기만 체크해 주세요."}
              </p>
            </div>

            <div className="space-y-2">
              {documents.map((documentInfo) => (
                <label
                  key={documentInfo.key}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm"
                >
                  <input
                    type="checkbox"
                    checked={docStatus[documentInfo.key] === "확인 완료"}
                    onChange={() => onToggleDocStatus(documentInfo.key)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{documentInfo.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{documentInfo.helper}</p>
                  </div>
                </label>
              ))}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                반려 사유
              </label>
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={4}
                placeholder="예: 자격 증빙 내용이 선명하지 않아 다시 제출해 주세요."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {!hasDocumentSummary && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                매니저가 제출한 서류 요약이 없어 현재 상태에서는 승인 또는 반려를 저장할 수 없습니다.
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void onSaveReview("REJECTED")}
                disabled={isSubmitting || !hasDocumentSummary}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                반려
              </button>
              <button
                type="button"
                onClick={() => void onSaveReview("APPROVED")}
                disabled={isSubmitting || !allDocsChecked || !hasDocumentSummary}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                최종 승인
              </button>
            </div>

            <p className="text-[11px] leading-5 text-gray-500">
              승인 전에는 현재 자격 증빙의 보호 미리보기와 제출 요약을 함께 확인하세요. 요약이 없으면 심사 결과를 저장하지 않습니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
