/** Probe the scoped endpoint off the UI thread. No tool dispatch or credential logging. */
export async function mcpReady(url: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(1000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "bycoda-readiness", version: "1" },
        },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const message = await response.json();
    return (
      message?.id === 1 && !message.error && typeof message.result?.protocolVersion === "string"
    );
  } catch {
    return false;
  }
}
