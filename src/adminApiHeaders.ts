export function createAdminApiHeaders(idToken: string, appCheckToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };
  if (appCheckToken) {
    headers["X-Firebase-AppCheck"] = appCheckToken;
  }
  return headers;
}
