import type { ServerResponse } from "node:http";

/**
 * Ends the response and settles once the body is handed to the socket. Callers hold source
 * leases (native admission, disclosure permits) until then, so this must always settle: Node never
 * calls the `end` callback, nor emits `close` again, for a client that already disconnected.
 */
export function endResponseAndAwaitWrite(
  response: ServerResponse,
  body: string,
  sent?: () => void,
): Promise<void> {
  if (response.destroyed || response.writableEnded)
    return Promise.reject(new Error("Response closed before write completed."));
  return new Promise<void>((resolve, reject) => {
    const closed = () => {
      cleanup();
      reject(new Error("Response closed before write completed."));
    };
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      response.off("close", closed);
      response.off("error", failed);
    };
    response.once("close", closed);
    response.once("error", failed);
    response.end(body, () => {
      try {
        sent?.();
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  });
}
