import type { NextConfig } from "next";

function publicEnv(nextName: string, legacyName: string, fallback = ""): string {
  return process.env[nextName]?.trim()
    || process.env[legacyName]?.trim()
    || fallback;
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY: publicEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "VITE_FIREBASE_API_KEY"),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: publicEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_AUTH_DOMAIN"),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: publicEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID"),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: publicEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_STORAGE_BUCKET"),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: publicEnv(
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
    ),
    NEXT_PUBLIC_FIREBASE_APP_ID: publicEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "VITE_FIREBASE_APP_ID"),
    NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY: publicEnv(
      "NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY",
      "VITE_FIREBASE_APPCHECK_SITE_KEY",
    ),
    NEXT_PUBLIC_BODEUL_DATA_BACKEND: process.env.NEXT_PUBLIC_BODEUL_DATA_BACKEND?.trim() || "api",
    NEXT_PUBLIC_BODEUL_API_BASE_URL: process.env.NEXT_PUBLIC_BODEUL_API_BASE_URL?.trim() || "",
  },
  serverExternalPackages: ["firebase-admin", "pg"],
};

export default nextConfig;
