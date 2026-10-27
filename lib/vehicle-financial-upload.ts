export class BoundedRequestError extends Error {
  constructor(readonly code: "request_too_large" | "invalid_content_length" | "request_stream_failed") {
    super(code);
    this.name = "BoundedRequestError";
  }
}

/** Reads a request body with a hard ceiling before JSON or multipart parsing. */
export async function boundedRequestBody(request: Request, maxBytes: number) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new BoundedRequestError("invalid_content_length");
    if (Number(declared) > maxBytes) throw new BoundedRequestError("request_too_large");
  }
  if (!request.body) throw new BoundedRequestError("request_stream_failed");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BoundedRequestError("request_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedRequestError) throw error;
    throw new BoundedRequestError("request_stream_failed");
  }
  if (declared !== null && Number(declared) !== total) throw new BoundedRequestError("invalid_content_length");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: new Blob([bytes]),
    signal: request.signal
  });
}
