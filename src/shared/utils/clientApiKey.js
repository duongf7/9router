export function extractClientApiKey(request) {
  const headers = request?.headers;
  if (!headers?.get) return null;
  const auth = headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const xApiKey = headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  const googKey = headers.get("x-goog-api-key");
  if (googKey) return googKey;
  try {
    return new URL(request.url).searchParams.get("key") || null;
  } catch {
    return null;
  }
}
