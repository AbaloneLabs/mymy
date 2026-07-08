/**
 * API client for the mymy Rust backend.
 *
 * Base URL is configurable via VITE_API_URL (defaults to same-origin /api in
 * production via nginx proxy, or http://localhost:33697/api in dev).
 */

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: requestHeaders(options),
  });

  if (!res.ok) {
    throw await apiErrorFromResponse(res, path);
  }

  if (res.status === 204) return undefined as T;

  const data = await responseData(res);
  return data as T;
}

function requestHeaders(options: RequestInit) {
  const headers = new Headers(options.headers);
  if (!isFormDataBody(options.body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function isFormDataBody(body: RequestInit["body"]) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

async function responseData(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const body = data as { error?: unknown; message?: unknown };
    const message = body.error ?? body.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export async function apiErrorFromResponse(res: Response, path: string) {
  const data = await responseData(res);
  if (res.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new Event("mymy:unauthorized"));
  }
  return new ApiError(res.status, responseErrorMessage(data, res.statusText), data);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  form: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
};
