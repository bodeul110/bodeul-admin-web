import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

import { clientEnv } from './src/clientEnv'

function readRequiredEnv(name: string, value: string): string {
  if (value) {
    return value
  }

  throw new Error(
    `관리자 웹 Firebase 설정값 ${name}이 비어 있습니다. .env.local 또는 GitHub Environment 변수를 확인해 주세요.`,
  )
}

export const firebaseConfig: FirebaseOptions = {
  apiKey: readRequiredEnv('NEXT_PUBLIC_FIREBASE_API_KEY', clientEnv.firebaseApiKey),
  authDomain: readRequiredEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', clientEnv.firebaseAuthDomain),
  projectId: readRequiredEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', clientEnv.firebaseProjectId),
  storageBucket: readRequiredEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', clientEnv.firebaseStorageBucket),
  messagingSenderId: readRequiredEnv(
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    clientEnv.firebaseMessagingSenderId,
  ),
  appId: readRequiredEnv('NEXT_PUBLIC_FIREBASE_APP_ID', clientEnv.firebaseAppId),
}

const app = initializeApp(firebaseConfig)

export { app }
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
