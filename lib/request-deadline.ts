/** Bounds authentication waits as well as the HTTP request, preserving caller cancellation. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal | null,
  timeoutMs = 12_000
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason ?? new Error("Request cancelled."));
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(
    "Request timed out. Check your connection and reload history before retrying a save or deletion."
  )), timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      })
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

/** Keep the deadline active until a JSON response body has finished downloading. */
export async function completeJsonResponse(response: Response): Promise<Response> {
  if ([204, 205, 304].includes(response.status)) return response;
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}
