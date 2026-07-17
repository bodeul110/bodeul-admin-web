export const clientEnv = Object.freeze({
  firebaseApiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || "",
  firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "",
  firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "",
  firebaseStorageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "",
  firebaseMessagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || "",
  firebaseAppId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || "",
  firebaseAppCheckSiteKey: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY?.trim() || "",
  firebaseAppCheckDebugToken: process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN?.trim() || "",
  bodeulDataBackend: process.env.NEXT_PUBLIC_BODEUL_DATA_BACKEND?.trim() || "api",
  bodeulApiBaseUrl: process.env.NEXT_PUBLIC_BODEUL_API_BASE_URL?.trim() || "",
  isDevelopment: process.env.NODE_ENV !== "production",
});
