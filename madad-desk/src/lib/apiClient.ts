// Holds the authenticated Bearer token strictly in JS memory (never localStorage or sessionStorage).
let activeBearerToken: string | null = null;

export function setMemoryAuthToken(token: string | null): void {
  activeBearerToken = token;
}

export function getMemoryAuthToken(): string | null {
  return activeBearerToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (activeBearerToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${activeBearerToken}`);
  }
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormData && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path.startsWith('/') ? path : `/${path}`, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (contentType.includes('application/json')) {
      try {
        const body = await res.json();
        message = body.error || body.message || message;
      } catch {
        // ignore parse failure
      }
    }
    throw new ApiError(message, res.status);
  }

  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}
