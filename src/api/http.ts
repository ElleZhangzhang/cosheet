import { clearToken, getToken } from "@/utils/tokenStorage";

const BASE_URL = "/api";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getErrorMessage(payload: unknown, status: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  return `请求失败（${status}）`;
}

function redirectToLogin(): void {
  const { pathname, search } = window.location;
  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/s/")
  ) {
    return;
  }

  const redirect = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?redirect=${redirect}`);
}

async function request<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, auth = true, signal } = options;
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && auth) {
      clearToken();
      redirectToLogin();
    }

    throw new ApiError(
      response.status,
      getErrorMessage(payload, response.status)
    );
  }

  return payload as T;
}

export { ApiError, request };
