export type FirebaseAdminAppCheckFailure = "invalid" | "unavailable" | "misconfigured";

const CLIENT_TOKEN_MESSAGE_PARTS = [
  "Decoding App Check token failed",
  "incorrect algorithm",
  'incorrect "aud"',
  'incorrect "iss"',
  'no "sub"',
  'empty string "sub"',
  "invalid signature",
  '"kid" claim',
];

export function classifyFirebaseAdminAppCheckError(error: unknown): FirebaseAdminAppCheckFailure {
  const code = readStringProperty(error, "code");
  const message = readStringProperty(error, "message");

  if (code === "app-check/app-check-token-expired") {
    return "invalid";
  }
  if (code === "app-check/invalid-argument") {
    return CLIENT_TOKEN_MESSAGE_PARTS.some((part) => message.includes(part))
      ? "invalid"
      : "unavailable";
  }
  if (
    code === "app-check/invalid-credential"
    || code === "app-check/permission-denied"
    || code === "app-check/unauthenticated"
    || code === "app-check/not-found"
  ) {
    return "misconfigured";
  }

  return "unavailable";
}

function readStringProperty(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return "";
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}
