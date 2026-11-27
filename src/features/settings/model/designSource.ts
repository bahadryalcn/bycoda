const SOURCE_MARKER = "<!--bycoda:scene-source-->";

/** Bundled runtime is retained on disk; only authored source is sent back to the model. */
export function authoredSceneSource(html: string): string {
  const marker = html.indexOf(SOURCE_MARKER);
  return marker < 0 ? html : html.slice(marker + SOURCE_MARKER.length);
}

export function packOfflineScene(source: string, runtime: string): string {
  if (!source.trim() || source.length > 120_000)
    throw new Error("Scene source must contain 1 to 120000 characters");
  const html = `<!doctype html><meta charset="utf-8"><script>${runtime.split("</script").join("<\\/script")}</script>${SOURCE_MARKER}${source}`;
  if (new TextEncoder().encode(html).byteLength > 2_097_152) throw new Error("Scene is too large");
  return html;
}
