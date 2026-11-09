self.onmessage = (event: MessageEvent<{ pieces: string[]; length: number }>) => {
  try {
    const { pieces, length } = event.data;
    if (
      !Array.isArray(pieces) ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 32 * 1024 * 1024 ||
      pieces.some((piece) => typeof piece !== "string") ||
      pieces.reduce((sum, piece) => sum + piece.length, 0) !== length
    )
      throw new Error("Invalid session transfer");
    self.postMessage({ value: JSON.parse(pieces.join("")) });
  } catch {
    self.postMessage({ error: "Session transfer contains invalid JSON" });
  }
};
