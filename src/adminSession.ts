import type { User as FirebaseUser } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { db } from "../firebase";

export type AdminSessionResult = {
  isAdmin: boolean;
  adminName: string;
  adminRole: "SUPER_ADMIN" | "OPERATIONS" | "DEVELOPER" | null;
  permissions: readonly string[];
  breakGlassExpiresAt: string | null;
  message: string;
};

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveAdminSession(user: FirebaseUser): Promise<AdminSessionResult> {
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

  const adminName = readText(userData.name) || "관리자";
  return {
    isAdmin: true,
    adminName,
    adminRole: null,
    permissions: [],
    breakGlassExpiresAt: null,
    message: "",
  };
}
