import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check'
import { app } from '../firebase'
import { clientEnv } from './clientEnv'

type AppCheckWindow = Window & typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean
}

let appCheckInstance: AppCheck | null = null
const APP_CHECK_TOKEN_TIMEOUT_MS = 5_000

export function initializeFirebaseAppCheck(): AppCheck | null {
  if (typeof window === 'undefined') {
    return null
  }

  if (appCheckInstance) {
    return appCheckInstance
  }

  if (!clientEnv.firebaseAppCheckEnabled) {
    return null
  }

  const siteKey = clientEnv.firebaseAppCheckSiteKey
  if (!siteKey) {
    console.warn('[AppCheck] 사이트 키가 없어 관리자 웹 App Check 초기화를 건너뜁니다.')
    return null
  }

  const debugToken = resolveDebugToken()
  if (debugToken !== undefined) {
    (window as AppCheckWindow).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken
  }

  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
  return appCheckInstance
}

export async function getFirebaseAppCheckToken(): Promise<string | null> {
  const instance = initializeFirebaseAppCheck()
  if (!instance) {
    return null
  }

  try {
    const result = await withTimeout(
      getToken(instance, false),
      APP_CHECK_TOKEN_TIMEOUT_MS,
    )
    return result.token || null
  } catch {
    console.warn('[AppCheck] 관리자 API 요청용 App Check token을 발급하지 못했습니다.')
    return null
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("App Check token 발급 시간이 초과됐습니다.")),
      timeoutMs,
    )
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

function resolveDebugToken(): string | boolean | undefined {
  const configuredToken = clientEnv.firebaseAppCheckDebugToken
  if (configuredToken) {
    return configuredToken
  }

  if (clientEnv.isDevelopment && isLocalhost()) {
    return true
  }

  return undefined
}

function isLocalhost(): boolean {
  return window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
}
