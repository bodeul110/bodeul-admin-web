import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {access} from "node:fs/promises";
import {createConnection, createServer} from "node:net";
import {resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const deadline = new AbortController();
const timer = setTimeout(() => deadline.abort(new Error("런타임 검증 제한시간 90초를 초과했습니다.")), 90_000);
const onInterrupt = () => deadline.abort(new Error("런타임 검증이 중단되었습니다."));
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onInterrupt);

let child;
let childClosed;
let closed = false;
let startupError;
let output = "";

try {
  await access(resolve(root, ".next/BUILD_ID"));
  const port = await availablePort();
  // 배포 환경의 require(ESM) 제한을 재현하고 개인 자격 증명은 상속하지 않는다.
  child = spawn(process.execPath, [
    "--no-experimental-require-module", resolve(root, "node_modules/next/dist/bin/next"),
    "start", "--hostname", "127.0.0.1", "--port", String(port),
  ], {cwd: root, env: isolatedEnvironment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
  childClosed = new Promise(resolveClosed => {
    child.once("error", error => { startupError = error; });
    child.once("close", () => { closed = true; resolveClosed(); });
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", chunk => { output = (output + chunk).slice(-16_384); });
  }

  await waitUntilListening(port);
  const paymentPath = "/admin/appointments/20000000-0000-4000-8000-000000000001/payment";
  const routes = [
    {method: "GET", path: "/admin/hospital-guides"},
    {method: "GET", path: paymentPath},
    {method: "PATCH", path: paymentPath},
  ];
  const identities = [
    {label: "무인증", header: null, error: "missing_authorization", message: "Authorization 헤더가 필요합니다."},
    {label: "잘못된 인증 형식", header: "Basic runtime-smoke", error: "invalid_authorization",
      message: "Authorization 헤더는 Bearer 토큰 형식이어야 합니다."},
    {label: "가짜 Firebase token", header: "Bearer runtime-smoke-not-a-firebase-token", error: "invalid_firebase_token",
      message: "Firebase ID token 검증에 실패했습니다."},
  ];

  for (const route of routes) {
    for (const identity of identities) {
      assertRunning();
      const label = `${route.method} ${route.path} (${identity.label})`;
      const headers = identity.header ? {authorization: identity.header} : {};
      if (route.method === "PATCH") headers["content-type"] = "application/json";
      const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
        method: route.method, headers, redirect: "error",
        body: route.method === "PATCH" ? "{}" : undefined,
        signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(10_000)]),
      });
      const body = await response.text();
      assert.equal(response.status, 401, `${label}: 401 대신 ${response.status} 응답`);
      assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store\s*(?:,|$)/iu,
        `${label}: no-store 누락`);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/iu,
        `${label}: JSON 응답이 아님`);
      assert.ok(body.length <= 16_384, `${label}: 오류 응답이 너무 큼`);
      const payload = JSON.parse(body);
      assert.ok(payload !== null && typeof payload === "object" && !Array.isArray(payload), `${label}: 오류 객체가 아님`);
      // 오류 키만 허용하여 결제 상세나 개인정보가 실패 응답에 섞이지 않도록 한다.
      assert.deepEqual(Object.keys(payload).sort(), ["error", "message"], `${label}: 허용하지 않은 응답 필드`);
      assert.ok(payload.error === identity.error, `${label}: 인증 오류 코드 불일치`);
      assert.ok(payload.message === identity.message, `${label}: 인증 안내 외의 내용이 응답됨`);
      assert.ok(!body.includes("runtime-smoke"), `${label}: 입력 token이 오류 응답에 노출됨`);
      process.stdout.write(`통과: ${label}\n`);
    }
  }
  process.stdout.write("빌드된 관리자 서버의 인증 경계 9건 통과. 계정·DB 연결 및 정상 App Check token 검증은 수행하지 않았습니다.\n");
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`관리자 런타임 검증 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}\n`);
  // 서버 로그 원문 대신 모듈 로딩 실패 코드만 출력한다.
  if (/ERR_REQUIRE_ESM|Failed to load external module/u.test(output)) {
    process.stderr.write("서버에서 외부 모듈 로딩 실패 또는 ERR_REQUIRE_ESM을 확인했습니다.\n");
  }
} finally {
  clearTimeout(timer);
  if (child && !closed) {
    child.kill("SIGTERM");
    await Promise.race([childClosed, delay(3_000)]);
    if (!closed) {
      child.kill("SIGKILL");
      await Promise.race([childClosed, delay(3_000)]);
    }
    if (!closed) {
      process.exitCode = 1;
      process.stderr.write("검증용 Node 프로세스 종료를 확인하지 못했습니다.\n");
    }
  }
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
}

function isolatedEnvironment() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(path|systemroot|windir|comspec|pathext|temp|tmp|lang|lc_all)$/iu.test(name) && value !== undefined) {
      environment[name] = value;
    }
  }
  return {
    ...environment, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", FORCE_COLOR: "0",
    FIREBASE_PROJECT_ID: "bodeul-ci", GOOGLE_CLOUD_PROJECT: "bodeul-ci", GCLOUD_PROJECT: "bodeul-ci",
    FIREBASE_STORAGE_BUCKET: "bodeul-ci.appspot.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "bodeul-ci",
    // 빈 값도 명시하여 로컬 .env 파일이 자격 증명을 다시 주입하지 못하게 한다.
    FIREBASE_SERVICE_ACCOUNT_JSON: "", ADMIN_DATABASE_URL: "", DATABASE_URL: "",
    GOOGLE_APPLICATION_CREDENTIALS: resolve(root, ".next/runtime-smoke-no-credentials.json"),
    FIREBASE_CONFIG: "", FIREBASE_AUTH_EMULATOR_HOST: "", FIRESTORE_EMULATOR_HOST: "",
    ADMIN_BANK_TRANSFER_WRITES_ENABLED: "false", ADMIN_APP_CHECK_MODE: "enforce",
    FIREBASE_APPCHECK_ALLOWED_APP_IDS: "1:000000000000:web:0000000000000000000000",
    ADMIN_MFA_MODE: "enforce", ADMIN_MFA_ENFORCE_READY: "true",
    VERCEL_ENV: "preview",
  };
}

function assertRunning() {
  deadline.signal.throwIfAborted();
  if (startupError) throw new Error(`검증용 Node 시작 실패: ${startupError.code ?? "unknown"}`);
  if (closed) throw new Error("검증용 Node가 요청 완료 전에 종료되었습니다.");
}

async function availablePort() {
  const server = createServer();
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function waitUntilListening(port) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    assertRunning();
    const ready = await new Promise(resolveReady => {
      const socket = createConnection({host: "127.0.0.1", port});
      const finish = connected => { socket.destroy(); resolveReady(connected); };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(300, () => finish(false));
    });
    if (ready) return;
    await delay(100, undefined, {signal: deadline.signal});
  }
  throw new Error("검증용 관리자 서버가 30초 안에 시작하지 못했습니다.");
}
