import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {doc, getDoc} from "firebase/firestore";
import {
  getMultiFactorResolver,
  onAuthStateChanged,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type User as FirebaseUser,
} from "firebase/auth";
import {auth, db} from "../firebase";
import type { AdminSessionResult } from "./adminSession";
import {
  BodeulApiError,
  fetchAdminAccessContext,
  fetchAdminManagerDocument,
  fetchAdminManagerReviews,
  saveAdminManagerReview,
  resolveBodeulApiBaseUrl,
  resolveBodeulDataBackend,
  type AdminDetailRole,
  type AdminPermission,
  type AdminManagerReviewItem,
} from "./bodeulApi";
import { AdminAuthScreen } from "./components/AdminAuthScreen";
import { AdminShell } from "./components/AdminShell";
import { AppointmentPublicCodeSearchPanel } from "./components/AppointmentPublicCodeSearchPanel";
import { AdminSecurityPanel } from "./components/AdminSecurityPanel";
import { HospitalGuideApiPanel } from "./components/HospitalGuideApiPanel";
import { ManagerApprovalList } from "./components/ManagerApprovalList";
import { ManagerReviewModal } from "./components/ManagerReviewModal";
import { useAdminIdleSession } from "./hooks/useAdminIdleSession";
import { useManagerDocumentPreviews } from "./hooks/useManagerDocumentPreviews";

type ManagerDocumentKey = "idCard" | "license" | "criminalRecord";
type ChecklistStatus = "미확인" | "확인 완료";
type ManagerStatus = "대기" | "검토중" | "승인됨" | "반려";
type ReviewStatus = "APPROVED" | "REJECTED";
type MenuKey = "dashboard" | "approval" | "appointmentSearch" | "hospitalGuides" | "security";
type PreviewStatus = "idle" | "loading" | "ready" | "missing" | "error";

type MfaFactorOption = {
  readonly uid: string;
  readonly factorId: string;
  readonly label: string;
};

type StoredManagerDocumentFile = {
  fullPath: string;
  fileName: string;
  contentType: string;
  uploadedAtLabel: string;
};

type DocumentPreview = StoredManagerDocumentFile & {
  status: PreviewStatus;
  downloadUrl: string;
  message: string;
  evidenceToken: string;
};

type Manager = {
  id: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  status: ManagerStatus;
  documentSummary: string;
  reviewNote: string;
  documentFiles: Partial<Record<ManagerDocumentKey, StoredManagerDocumentFile>>;
};

const INITIAL_DOC_STATUS: Record<ManagerDocumentKey, ChecklistStatus> = {
  idCard: "미확인",
  license: "미확인",
  criminalRecord: "미확인",
};

const DOCUMENTS: { key: ManagerDocumentKey; label: string; helper: string }[] = [
  { key: "idCard", label: "신분증", helper: "신분증 원본과 이름, 생년월일을 대조합니다." },
  { key: "license", label: "자격증", helper: "요양보호사 또는 간호 관련 자격을 확인합니다." },
  { key: "criminalRecord", label: "범죄경력 조회", helper: "최신 발급본 기준으로 검토합니다." },
];

const DOCUMENT_LABEL_MAP: Record<ManagerDocumentKey, string> = {
  idCard: "신분증",
  license: "자격증",
  criminalRecord: "범죄경력 조회",
};

function createPreview(status: PreviewStatus, overrides: Partial<DocumentPreview> = {}): DocumentPreview {
  return {
    status,
    fileName: "",
    contentType: "",
    downloadUrl: "",
    fullPath: "",
    uploadedAtLabel: "",
    message: "",
    evidenceToken: "",
    ...overrides,
  };
}

function buildPreviewState(status: PreviewStatus): Record<ManagerDocumentKey, DocumentPreview> {
  return {
    idCard: createPreview(status),
    license: createPreview(status),
    criminalRecord: createPreview(status),
  };
}

async function resolveAdminSession(user: FirebaseUser): Promise<AdminSessionResult> {
  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists()) {
    return {
      isAdmin: false,
      adminName: "",
      adminRole: null,
      permissions: [],
      breakGlassExpiresAt: null,
      message: "사용자 정보를 찾을 수 없습니다.",
    };
  }

  const userData = userDoc.data();
  if (!userData || userData.role !== "ADMIN") {
    return {
      isAdmin: false,
      adminName: "",
      adminRole: null,
      permissions: [],
      breakGlassExpiresAt: null,
      message: "관리자 계정으로 로그인해주세요.",
    };
  }

  const adminName = typeof userData.name === "string" && userData.name.trim()
    ? userData.name.trim()
    : "관리자";

  const accessContext = await fetchAdminAccessContext(user);
  return {
    isAdmin: true,
    adminName,
    adminRole: accessContext.role,
    permissions: accessContext.permissions,
    breakGlassExpiresAt: accessContext.breakGlassExpiresAt,
    message: "",
  };
}

function formatDateTime(rawValue: string): string {
  const date = new Date(rawValue);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR");
}

function mapManagerStatus(rawStatus: AdminManagerReviewItem["status"]): ManagerStatus {
  if (rawStatus === "PENDING_REVIEW") {
    return "검토중";
  }
  if (rawStatus === "APPROVED") {
    return "승인됨";
  }
  if (rawStatus === "REJECTED") {
    return "반려";
  }
  return "대기";
}

function toManager(item: AdminManagerReviewItem): Manager {
  const files: Partial<Record<ManagerDocumentKey, StoredManagerDocumentFile>> = {};
  item.availableDocumentKeys.forEach((key) => {
    files[key] = {
      fullPath: `server-mediated:${key}`,
      fileName: DOCUMENT_LABEL_MAP[key],
      contentType: "",
      uploadedAtLabel: "",
    };
  });
  return {
    id: item.id,
    name: item.name,
    email: item.maskedEmail,
    phone: item.maskedPhone,
    date: item.createdAt ? new Date(item.createdAt).toLocaleDateString("ko-KR") : "",
    status: mapManagerStatus(item.status),
    documentSummary: item.documentSummary,
    reviewNote: item.reviewNote,
    documentFiles: files,
  };
}

function isImageDocument(preview: DocumentPreview): boolean {
  const normalizedType = preview.contentType.toLowerCase();
  if (normalizedType.startsWith("image/")) {
    return true;
  }

  const normalizedName = preview.fileName.toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].some((suffix) =>
    normalizedName.endsWith(suffix));
}

function isPdfDocument(preview: DocumentPreview): boolean {
  const normalizedType = preview.contentType.toLowerCase();
  if (normalizedType === "application/pdf") {
    return true;
  }
  return preview.fileName.toLowerCase().endsWith(".pdf");
}

function disposeDocumentPreview(preview: DocumentPreview): void {
  if (preview.downloadUrl.startsWith("blob:")) {
    URL.revokeObjectURL(preview.downloadUrl);
  }
}

function readFirebaseAuthErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function toMfaFactorOption(hint: MultiFactorInfo, index: number): MfaFactorOption | null {
  const displayName = hint.displayName?.trim();
  if (hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID) {
    const phoneNumber = "phoneNumber" in hint && typeof hint.phoneNumber === "string"
      ? hint.phoneNumber
      : "등록된 전화번호";
    return {uid: hint.uid, factorId: hint.factorId, label: displayName || `문자 인증 · ${phoneNumber}`};
  }
  if (hint.factorId === TotpMultiFactorGenerator.FACTOR_ID) {
    return {uid: hint.uid, factorId: hint.factorId, label: displayName || `인증 앱 ${index + 1}`};
  }
  return null;
}

async function resolveDocumentPreview(
  user: FirebaseUser,
  manager: Manager,
  documentKey: ManagerDocumentKey,
  reason: string,
): Promise<DocumentPreview> {
  try {
    const document = await fetchAdminManagerDocument(user, manager.id, documentKey, reason);
    return createPreview("ready", {
      downloadUrl: URL.createObjectURL(document.blob),
      fullPath: "관리자 서버 중계",
      fileName: document.fileName,
      contentType: document.contentType,
      uploadedAtLabel: formatDateTime(document.updatedAt),
      evidenceToken: document.evidenceToken,
    });
  } catch (error) {
    return createPreview("error", {
      message: error instanceof Error ? error.message : "원본 문서를 불러오지 못했습니다.",
    });
  }
}

function getUploadedDocumentCount(manager: Manager): number {
  return DOCUMENTS.filter((documentInfo) => Boolean(manager.documentFiles[documentInfo.key]?.fullPath)).length;
}

function getUploadedDocumentLabels(manager: Manager): string[] {
  return DOCUMENTS
    .filter((documentInfo) => Boolean(manager.documentFiles[documentInfo.key]?.fullPath))
    .map((documentInfo) => documentInfo.label);
}

function summarizeManagerText(value: string, maxLength = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function retainServerMask(value: string): string {
  return value || "-";
}

function Dashboard({ managers }: { managers: Manager[] }) {
  const pendingCount = useMemo(
    () => managers.filter((manager) => manager.status === "대기").length,
    [managers],
  );
  const reviewingCount = useMemo(
    () => managers.filter((manager) => manager.status === "검토중").length,
    [managers],
  );
  const approvedCount = useMemo(
    () => managers.filter((manager) => manager.status === "승인됨").length,
    [managers],
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-base font-semibold text-gray-900">대시보드 요약</h1>
        <p className="mt-1 text-xs text-gray-500">
          관리자 웹에서 확인 중인 매니저 승인 현황입니다.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">승인 대기</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">검토 중</p>
          <p className="mt-2 text-2xl font-semibold text-blue-600">{reviewingCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">승인 완료</p>
          <p className="mt-2 text-2xl font-semibold text-green-600">{approvedCount}</p>
        </div>
      </div>
    </div>
  );
}

function ManagerApproval({
  currentUser,
  managers,
  onRefresh,
}: {
  currentUser: FirebaseUser;
  managers: Manager[];
  onRefresh: () => Promise<void>;
}) {
  const CHECKED_STATUS: ChecklistStatus = "확인 완료";
  const UNCHECKED_STATUS: ChecklistStatus = "미확인";
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [activeDoc, setActiveDoc] = useState<ManagerDocumentKey>("idCard");
  const [docStatus, setDocStatus] = useState<Record<ManagerDocumentKey, ChecklistStatus>>(INITIAL_DOC_STATUS);
  const [rejectReason, setRejectReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [documentAccessReason, setDocumentAccessReason] = useState("");

  const selectedManager = useMemo(
    () => managers.find((manager) => manager.id === selectedManagerId) || null,
    [managers, selectedManagerId],
  );
  const documentKeys = useMemo<ManagerDocumentKey[]>(
    () => DOCUMENTS.map((documentInfo) => documentInfo.key),
    [],
  );
  const createIdlePreviewState = useCallback(
    () => buildPreviewState("idle"),
    [],
  );
  const createLoadingPreviewState = useCallback(
    () => buildPreviewState("loading"),
    [],
  );
  const createErrorPreview = useCallback(
    (key: ManagerDocumentKey) => createPreview("error", {
      message: `${DOCUMENT_LABEL_MAP[key]} 미리보기를 불러오지 못했습니다.`,
    }),
    [],
  );
  const loadDocumentPreview = useCallback(
    (manager: Manager, key: ManagerDocumentKey) =>
      resolveDocumentPreview(currentUser, manager, key, documentAccessReason),
    [currentUser, documentAccessReason],
  );
  const getManagerKey = useCallback((manager: Manager) => manager.id, []);
  const documentPreviews = useManagerDocumentPreviews({
    selectedManager,
    documentKeys,
    getManagerKey,
    createIdleState: createIdlePreviewState,
    createLoadingState: createLoadingPreviewState,
    createErrorPreview,
    resolvePreview: loadDocumentPreview,
    disposePreview: disposeDocumentPreview,
  });

  const statusBadgeClass: Record<ManagerStatus, string> = {
    대기: "bg-gray-100 text-gray-700",
    검토중: "bg-blue-100 text-blue-700",
    승인됨: "bg-green-100 text-green-700",
    반려: "bg-red-100 text-red-700",
  };
  const previewBadgeClass: Record<PreviewStatus, string> = {
    idle: "bg-gray-100 text-gray-500",
    loading: "bg-blue-100 text-blue-700",
    ready: "bg-green-100 text-green-700",
    missing: "bg-amber-100 text-amber-700",
    error: "bg-red-100 text-red-700",
  };
  const previewBadgeLabel: Record<PreviewStatus, string> = {
    idle: "대기",
    loading: "파생본 생성 중",
    ready: "보호 미리보기 준비",
    missing: "파일 없음",
    error: "확인 실패",
  };

  const allDocsChecked = Object.values(docStatus).every((status) => status === CHECKED_STATUS);
  const hasDocumentSummary = Boolean(selectedManager?.documentSummary.trim());
  const checkedCount = Object.values(docStatus).filter((status) => status === CHECKED_STATUS).length;
  const totalManagers = managers.length;
  const summaryReadyCount = useMemo(
    () => managers.filter((manager) => Boolean(manager.documentSummary.trim())).length,
    [managers],
  );
  const fullyUploadedCount = useMemo(
    () => managers.filter((manager) => getUploadedDocumentCount(manager) === DOCUMENTS.length).length,
    [managers],
  );
  const reviewNoteCount = useMemo(
    () => managers.filter((manager) => Boolean(manager.reviewNote.trim())).length,
    [managers],
  );
  const selectedManagerUploadedCount = selectedManager ? getUploadedDocumentCount(selectedManager) : 0;
  const selectedManagerMissingCount = DOCUMENTS.length - selectedManagerUploadedCount;

  function openManagerReview(manager: Manager) {
    const accessReason = window.prompt("민감 서류 원문 조회 사유를 10자 이상 입력해 주세요.")?.trim() || "";
    if (accessReason.length < 10) {
      window.alert("원문 조회 사유를 10자 이상 입력해야 심사를 열 수 있습니다.");
      return;
    }
    setDocumentAccessReason(accessReason);
    setSelectedManagerId(manager.id);
    setActiveDoc("idCard");
    setDocStatus(INITIAL_DOC_STATUS);
    setRejectReason(manager.reviewNote || "");
    setIsSubmitting(false);
  }

  function closeModal() {
    setSelectedManagerId("");
    setActiveDoc("idCard");
    setDocStatus(INITIAL_DOC_STATUS);
    setRejectReason("");
    setIsSubmitting(false);
    setDocumentAccessReason("");
  }

  function handleToggleDocStatus(key: ManagerDocumentKey) {
    setDocStatus((prev) => ({
      ...prev,
      [key]: prev[key] === UNCHECKED_STATUS ? CHECKED_STATUS : UNCHECKED_STATUS,
    }));
  }

  async function saveReview(nextStatus: ReviewStatus) {
    if (!selectedManager || isSubmitting) {
      return;
    }

    const reviewNote = nextStatus === "REJECTED" ? rejectReason.trim() : "";
    if (!selectedManager.documentSummary.trim()) {
      window.alert("매니저가 제출한 서류 요약이 없어 심사 결과를 저장할 수 없습니다.");
      return;
    }
    if (nextStatus === "APPROVED" && !allDocsChecked) {
      window.alert("확인할 체크리스트를 모두 완료해 주세요.");
      return;
    }
    const documentEvidenceTokens = DOCUMENTS.map(
      (documentInfo) => documentPreviews[documentInfo.key].evidenceToken,
    );
    if (nextStatus === "APPROVED" && documentEvidenceTokens.some((token) => !token)) {
      window.alert("승인 전에 세 문서의 보호 미리보기를 모두 다시 확인해 주세요.");
      return;
    }
    if (nextStatus === "REJECTED" && !reviewNote) {
      window.alert("반려 사유를 입력해 주세요.");
      return;
    }

    const actionLabel = nextStatus === "APPROVED" ? "승인" : "반려";
    const ok = window.confirm(`"${selectedManager.name}" 요청을 ${actionLabel}하시겠습니까?`);
    if (!ok) {
      return;
    }

    setIsSubmitting(true);
    try {
      const saveResult = await saveAdminManagerReview(
        currentUser,
        selectedManager.id,
        nextStatus,
        reviewNote,
        nextStatus === "APPROVED" ? documentEvidenceTokens : [],
      );
      await onRefresh();

      window.alert(
        saveResult.auditState === "PENDING"
          ? `심사 결과는 저장됐지만 감사 기록 재처리가 필요합니다. 작업 번호: ${saveResult.operationId}`
          : nextStatus === "APPROVED"
          ? "매니저 서류를 승인했습니다."
          : "매니저 서류를 반려했습니다.",
      );
      closeModal();
    } catch (error) {
      console.error("Manager review save failed:", error);
      window.alert("심사 결과를 저장하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-base font-semibold text-gray-900">매니저 서류 확인</h1>
        <p className="mt-1 text-xs text-gray-500">
          제출된 서류 요약과 서버가 만든 보호 미리보기를 확인하고 승인 또는 반려를 진행합니다.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">전체 대상</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{totalManagers}</p>
          <p className="mt-1 text-xs text-gray-500">현재 심사 목록에 있는 매니저 수</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">요약 제출</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{summaryReadyCount}</p>
          <p className="mt-1 text-xs text-gray-500">서류 요약까지 입력을 마친 계정</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">원본 3종 완료</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{fullyUploadedCount}</p>
          <p className="mt-1 text-xs text-gray-500">신분증, 자격증, 범죄경력 조회서 업로드 완료</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">검토 메모 있음</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{reviewNoteCount}</p>
          <p className="mt-1 text-xs text-gray-500">보완 이력이나 운영 메모가 남아 있는 계정</p>
        </div>
      </div>

      <ManagerApprovalList
        managers={managers}
        statusBadgeClass={statusBadgeClass}
        totalDocumentCount={DOCUMENTS.length}
        onOpenManagerReview={openManagerReview}
        getUploadedDocumentCount={getUploadedDocumentCount}
        getUploadedDocumentLabels={getUploadedDocumentLabels}
        summarizeManagerText={summarizeManagerText}
        maskEmail={retainServerMask}
        maskPhone={retainServerMask}
      />

      {selectedManager && (
        <ManagerReviewModal
          selectedManager={selectedManager}
          activeDoc={activeDoc}
          setActiveDoc={setActiveDoc}
          docStatus={docStatus}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          isSubmitting={isSubmitting}
          allDocsChecked={allDocsChecked}
          hasDocumentSummary={hasDocumentSummary}
          checkedCount={checkedCount}
          totalDocumentCount={DOCUMENTS.length}
          selectedManagerUploadedCount={selectedManagerUploadedCount}
          selectedManagerMissingCount={selectedManagerMissingCount}
          documentPreviews={documentPreviews}
          documents={DOCUMENTS}
          statusBadgeClass={statusBadgeClass}
          previewBadgeClass={previewBadgeClass}
          previewBadgeLabel={previewBadgeLabel}
          documentLabelMap={DOCUMENT_LABEL_MAP}
          onClose={closeModal}
          onToggleDocStatus={handleToggleDocStatus}
          onSaveReview={saveReview}
          isImageDocument={(preview) => isImageDocument(preview as DocumentPreview)}
          isPdfDocument={(preview) => isPdfDocument(preview as DocumentPreview)}
          watermarkLabel={`보들 관리자 원본 · ${currentUser.uid.slice(0, 8)} · ${selectedManager.id}`}
        />
      )}
    </div>
  );
}

function App() {
  const [currentMenu, setCurrentMenu] = useState<MenuKey>("dashboard");
  const [currentAdminUser, setCurrentAdminUser] = useState<FirebaseUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [authError, setAuthError] = useState("");
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaFactors, setMfaFactors] = useState<readonly MfaFactorOption[]>([]);
  const [selectedMfaFactorUid, setSelectedMfaFactorUid] = useState("");
  const [mfaVerificationCode, setMfaVerificationCode] = useState("");
  const [mfaVerificationId, setMfaVerificationId] = useState("");
  const [isMfaBusy, setIsMfaBusy] = useState(false);
  const [mfaMessage, setMfaMessage] = useState("");
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const [adminName, setAdminName] = useState("");
  const [adminRole, setAdminRole] = useState<AdminDetailRole | null>(null);
  const [adminPermissions, setAdminPermissions] = useState<readonly AdminPermission[]>([]);
  const [managerSnapshot, setManagerSnapshot] = useState<Manager[]>([]);
  const [managerLoadError, setManagerLoadError] = useState("");
  const dataBackend = useMemo(() => resolveBodeulDataBackend(), []);
  const apiBaseUrl = useMemo(() => resolveBodeulApiBaseUrl(), []);

  const resetAdminShellState = useCallback(() => {
    setManagerSnapshot([]);
    setManagerLoadError("");
    setCurrentMenu("dashboard");
  }, []);

  const resetMfaChallenge = useCallback(() => {
    recaptchaVerifierRef.current?.clear();
    recaptchaVerifierRef.current = null;
    setMfaResolver(null);
    setMfaFactors([]);
    setSelectedMfaFactorUid("");
    setMfaVerificationCode("");
    setMfaVerificationId("");
    setIsMfaBusy(false);
    setMfaMessage("");
  }, []);

  useEffect(() => () => {
    recaptchaVerifierRef.current?.clear();
    recaptchaVerifierRef.current = null;
  }, []);

  const clearAdminSession = useCallback((message = "") => {
    setIsLoggedIn(false);
    setCurrentAdminUser(null);
    setAdminName("");
    setAdminRole(null);
    setAdminPermissions([]);
    resetAdminShellState();
    setAuthError(message);
  }, [resetAdminShellState]);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) {
        return;
      }

      setIsCheckingSession(true);

      if (!user) {
        clearAdminSession(authError);
        setIsCheckingSession(false);
        return;
      }

      try {
        const session = await resolveAdminSession(user);
        if (!active) {
          return;
        }

        if (!session.isAdmin) {
          clearAdminSession(session.message);
          await signOut(auth);
          return;
        }

        setCurrentAdminUser(user);
        setIsLoggedIn(true);
        setAdminName(session.adminName);
        setAdminRole(session.adminRole);
        setAdminPermissions(session.permissions as readonly AdminPermission[]);
        setAuthError("");
        setManagerLoadError("");
      } catch (error) {
        console.error("Admin session validation failed:", error);
        const message = error instanceof BodeulApiError && error.code === "admin_mfa_required"
          ? "관리자 2차 인증이 필요한 세션입니다. 이메일과 비밀번호로 다시 로그인해 주세요."
          : "관리자 세션을 확인하지 못했습니다.";
        clearAdminSession(message);
        await signOut(auth).catch(() => undefined);
      } finally {
        if (active) {
          setIsCheckingSession(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authError, clearAdminSession]);

  const handleIdleLogout = useCallback(() => {
    void signOut(auth)
      .catch((error) => {
        console.error("Admin idle logout failed:", error);
      })
      .finally(() => {
        clearAdminSession("보안을 위해 15분 동안 활동이 없어 자동 로그아웃되었습니다.");
      });
  }, [clearAdminSession]);

  useAdminIdleSession(isLoggedIn, handleIdleLogout);

  const canReviewManagers = adminPermissions.includes("MANAGER_REVIEW");
  const canViewHospitalGuides = adminPermissions.includes("OPERATIONS_READ");
  const canManageRoles = adminPermissions.includes("ROLE_MANAGEMENT");

  const loadManagerReviews = useCallback(async () => {
    if (!currentAdminUser) return;
    try {
      const items = await fetchAdminManagerReviews(currentAdminUser);
      setManagerSnapshot(items.map(toManager));
      setManagerLoadError("");
    } catch (error) {
      console.error("Manager review list failed:", error);
      setManagerSnapshot([]);
      setManagerLoadError(error instanceof Error
        ? error.message
        : "매니저 심사 목록을 불러오지 못했습니다.");
    }
  }, [currentAdminUser]);

  useEffect(() => {
    if (!isLoggedIn || !canReviewManagers || !currentAdminUser) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadManagerReviews();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [canReviewManagers, currentAdminUser, isLoggedIn, loadManagerReviews]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setAuthError("");

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
    } catch (error) {
      if (readFirebaseAuthErrorCode(error) === "auth/multi-factor-auth-required") {
        const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
        const factors = resolver.hints
          .map(toMfaFactorOption)
          .filter((factor): factor is MfaFactorOption => factor !== null);
        setPassword("");
        if (!factors.length) {
          setAuthError("등록된 2차 인증 수단을 이 브라우저에서 처리할 수 없습니다. 운영 담당자에게 문의해 주세요.");
          return;
        }
        setMfaResolver(resolver);
        setMfaFactors(factors);
        setSelectedMfaFactorUid(factors[0].uid);
        setMfaVerificationCode("");
        setMfaVerificationId("");
        setMfaMessage("");
        return;
      }
      console.error("Admin login failed:", error);
      setAuthError("이메일 또는 비밀번호가 올바르지 않습니다.");
    }
  }

  function handleMfaFactorChange(uid: string) {
    recaptchaVerifierRef.current?.clear();
    recaptchaVerifierRef.current = null;
    setSelectedMfaFactorUid(uid);
    setMfaVerificationCode("");
    setMfaVerificationId("");
    setMfaMessage("");
  }

  async function handleSendMfaCode() {
    const hint = mfaResolver?.hints.find((candidate) => candidate.uid === selectedMfaFactorUid);
    if (!mfaResolver || !hint || hint.factorId !== PhoneMultiFactorGenerator.FACTOR_ID) {
      setMfaMessage("문자 인증 수단을 다시 선택해 주세요.");
      return;
    }
    setIsMfaBusy(true);
    setMfaMessage("");
    try {
      recaptchaVerifierRef.current?.clear();
      const verifier = new RecaptchaVerifier(auth, "admin-mfa-recaptcha", {size: "invisible"});
      recaptchaVerifierRef.current = verifier;
      const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({
        multiFactorHint: hint,
        session: mfaResolver.session,
      }, verifier);
      setMfaVerificationId(verificationId);
    } catch (error) {
      console.error("Admin MFA SMS send failed:", error);
      setMfaMessage("인증 코드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setMfaVerificationId("");
    } finally {
      setIsMfaBusy(false);
    }
  }

  async function handleVerifyMfa(event: React.FormEvent) {
    event.preventDefault();
    const hint = mfaResolver?.hints.find((candidate) => candidate.uid === selectedMfaFactorUid);
    if (!mfaResolver || !hint || mfaVerificationCode.length !== 6) {
      setMfaMessage("등록된 인증 수단과 6자리 인증 코드를 확인해 주세요.");
      return;
    }
    setIsMfaBusy(true);
    setMfaMessage("");
    try {
      const assertion = hint.factorId === TotpMultiFactorGenerator.FACTOR_ID
        ? TotpMultiFactorGenerator.assertionForSignIn(hint.uid, mfaVerificationCode)
        : hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID && mfaVerificationId
          ? PhoneMultiFactorGenerator.assertion(
            PhoneAuthProvider.credential(mfaVerificationId, mfaVerificationCode),
          )
          : null;
      if (!assertion) {
        setMfaMessage("선택한 인증 수단의 인증 코드를 먼저 받아 주세요.");
        return;
      }
      await mfaResolver.resolveSignIn(assertion);
      resetMfaChallenge();
      setAuthError("");
    } catch (error) {
      console.error("Admin MFA verification failed:", error);
      setMfaMessage("인증 코드가 올바르지 않거나 만료되었습니다. 다시 확인해 주세요.");
    } finally {
      setIsMfaBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Admin logout failed:", error);
    } finally {
      resetMfaChallenge();
      clearAdminSession("");
    }
  }

  if (isCheckingSession || !isLoggedIn || !adminRole) {
    return (
      <AdminAuthScreen
        isCheckingSession={isCheckingSession}
        email={email}
        password={password}
        authError={authError}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleLogin}
        mfaChallenge={{
          active: Boolean(mfaResolver),
          factors: mfaFactors,
          selectedFactorUid: selectedMfaFactorUid,
          verificationCode: mfaVerificationCode,
          smsCodeSent: Boolean(mfaVerificationId),
          isBusy: isMfaBusy,
          message: mfaMessage,
        }}
        onMfaFactorChange={handleMfaFactorChange}
        onMfaCodeChange={setMfaVerificationCode}
        onSendMfaCode={() => { void handleSendMfaCode(); }}
        onVerifyMfa={handleVerifyMfa}
        onCancelMfa={() => {
          resetMfaChallenge();
          void signOut(auth);
        }}
      />
    );
  }

  return (
    <AdminShell
      adminName={adminName}
      adminRole={adminRole}
      canReviewManagers={canReviewManagers}
      canViewHospitalGuides={canViewHospitalGuides}
      canManageRoles={canManageRoles}
      currentMenu={currentMenu}
      managerLoadError={managerLoadError}
      onMenuChange={setCurrentMenu}
      onLogout={() => {
        void handleLogout();
      }}
    >
      {currentMenu === "dashboard" && <Dashboard managers={managerSnapshot} />}
      {currentMenu === "approval" && canReviewManagers && (
        currentAdminUser && <ManagerApproval
          currentUser={currentAdminUser}
          managers={managerSnapshot}
          onRefresh={loadManagerReviews}
        />
      )}
      {currentMenu === "appointmentSearch" && canViewHospitalGuides && (
        <AppointmentPublicCodeSearchPanel
          currentUser={currentAdminUser}
          dataBackend={dataBackend}
          apiBaseUrl={apiBaseUrl}
        />
      )}
      {currentMenu === "hospitalGuides" && canViewHospitalGuides && (
        <HospitalGuideApiPanel
          currentUser={currentAdminUser}
          dataBackend={dataBackend}
          apiBaseUrl={apiBaseUrl}
        />
      )}
      {currentMenu === "security" && canManageRoles && currentAdminUser && (
        <AdminSecurityPanel currentUser={currentAdminUser} />
      )}
    </AdminShell>
  );
}

export default App;
