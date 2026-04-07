export type ApiEnvelope<T = unknown> = {
  success: boolean;
  data: T | null;
  error: string | null;
};

export function createApiSuccess<T>(data: T): ApiEnvelope<T> {
  return {
    success: true,
    data,
    error: null
  };
}

export function createApiError(message: string): ApiEnvelope<null> {
  return {
    success: false,
    data: null,
    error: message
  };
}

export async function parseJsonSafely<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<ApiEnvelope<T>> {
  const response = await fetch(input, init);
  const result = await parseJsonSafely<ApiEnvelope<T>>(response);

  if (!response.ok || !result.success) {
    throw new Error(result.error || "Request failed");
  }

  return result;
}
