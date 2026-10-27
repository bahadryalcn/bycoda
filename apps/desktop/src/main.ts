/** Keep native initialization out of a plain-browser bundle boot. No IPC shim. */
async function renderFailure(error: unknown, nativeUnavailable = false) {
  const [{ createElement }, { createRoot }, { BootFailure }, { languageReady }] = await Promise.all(
    [
      import("react"),
      import("react-dom/client"),
      import("../../../src/app/shell/BootFailure"),
      import("../../../src/shared/i18n"),
      import("../../../src/styles/index.css"),
    ],
  );
  await languageReady;
  const root = document.getElementById("root");
  if (!root) throw new Error("Desktop root is missing");
  const surface = document.createElement("div");
  if (nativeUnavailable) surface.dataset.nativeUnavailable = "true";
  else surface.dataset.bootstrapFailure = "true";
  root.replaceChildren(surface);
  document.getElementById("boot-splash")?.remove();
  createRoot(surface).render(
    createElement(BootFailure, { error, onRetry: () => window.location.reload() }),
  );
}

if ("__TAURI_INTERNALS__" in window) {
  // Native storage migration still executes first inside the existing entry.
  void import("../../../src/main.tsx").catch((error: unknown) => renderFailure(error));
} else {
  void renderFailure(new Error("This build requires the bycoda desktop app."), true);
}
