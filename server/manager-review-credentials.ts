type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export class ManagerReviewCredentialsError extends Error {
  constructor() {
    super("매니저 심사 목록의 서버 인증 설정이 준비되지 않았습니다.");
    this.name = "ManagerReviewCredentialsError";
  }
}

export function assertManagerReviewCredentials(env: ServerEnvironment): void {
  // ID token 공개 서명 검증에는 불필요한 자격 증명을 Firestore 조회에만 요구한다.
  if (env.VERCEL === "1" && !env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    throw new ManagerReviewCredentialsError();
  }
}
