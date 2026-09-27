type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

const resources = {
  preview: {
    firebaseProject: "bodeul-dev",
    projectNumber: "533563500316",
    databaseRef: "parpdzttloacinyvhwmx",
  },
  production: {
    firebaseProject: "bodeul-prod-110",
    projectNumber: "649312328770",
    databaseRef: "aoijbzgozbopsxzrasbb",
  },
} as const;

function deploymentResources(env: DeploymentEnvironment) {
  // 로컬·CI placeholder는 실제 Vercel 배포와 구분한다.
  if (env.VERCEL !== "1") return null;
  if (env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "production") {
    throw new Error("지원하지 않는 Vercel 배포 환경입니다.");
  }
  return resources[env.VERCEL_ENV];
}

function publicValue(env: DeploymentEnvironment, name: string): string {
  return env[`NEXT_PUBLIC_${name}`]?.trim() || env[`VITE_${name}`]?.trim() || "";
}

export function assertFirebaseDeploymentBoundary(env: DeploymentEnvironment): void {
  const expected = deploymentResources(env);
  if (!expected) return;
  if (env.FIREBASE_PROJECT_ID?.trim() !== expected.firebaseProject
    || publicValue(env, "FIREBASE_PROJECT_ID") !== expected.firebaseProject
    || publicValue(env, "FIREBASE_MESSAGING_SENDER_ID") !== expected.projectNumber
    || !publicValue(env, "FIREBASE_APP_ID").startsWith(`1:${expected.projectNumber}:web:`)) {
    throw new Error("Firebase 서버·브라우저 설정이 배포 환경과 일치하지 않습니다.");
  }
  const allowedBuckets = [
    `${expected.firebaseProject}.firebasestorage.app`,
    `${expected.firebaseProject}.appspot.com`,
  ];
  const publicBucket = publicValue(env, "FIREBASE_STORAGE_BUCKET");
  const serverBucket = env.FIREBASE_STORAGE_BUCKET?.trim() || publicBucket;
  if (!allowedBuckets.includes(publicBucket) || !allowedBuckets.includes(serverBucket)) {
    throw new Error("Firebase Storage가 배포 환경과 일치하지 않습니다.");
  }
}

export function assertAdminDatabaseBoundary(connectionString: string, env: DeploymentEnvironment): void {
  const expected = deploymentResources(env);
  if (!expected) return;
  let url: URL;
  let username: string;
  try {
    url = new URL(connectionString);
    username = decodeURIComponent(url.username);
  } catch {
    // URL 파싱 오류에 연결 문자열이나 비밀번호가 포함되지 않도록 한다.
    throw new Error("관리자 DB 연결 설정 형식이 올바르지 않습니다.");
  }
  const direct = url.hostname === `db.${expected.databaseRef}.supabase.co`
    && username === "bodeul_admin_service" && (!url.port || url.port === "5432");
  const pooler = /^aws-\d+-ap-northeast-1\.pooler\.supabase\.com$/u.test(url.hostname)
    && username === `bodeul_admin_service.${expected.databaseRef}`
    && ["", "5432", "6543"].includes(url.port);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.pathname !== "/postgres" || !url.password || (!direct && !pooler)) {
    throw new Error("관리자 DB의 프로젝트·리전·전용 role이 배포 환경과 일치하지 않습니다.");
  }
}

export function assertDeploymentBoundary(env: DeploymentEnvironment): void {
  if (!deploymentResources(env)) return;
  assertFirebaseDeploymentBoundary(env);
  assertAdminDatabaseBoundary(env.ADMIN_DATABASE_URL?.trim() || "", env);
}
