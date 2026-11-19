import { setAutomaticSubagentCatalogReader } from "../../../integrations/harness/core/automaticSubagents";
import { subagentCatalogModels } from "../../../shared/model/automaticSubagents";
import { HARNESSES } from "../../../shared/model/harnessIdentity";
import { modelsFor, isModelEnabled } from "../../sessions/public/models";
import { defaultProviderAccountId } from "../../providers/public/providerAccounts";

setAutomaticSubagentCatalogReader(() => ({
  models: subagentCatalogModels(
    Object.fromEntries(
      HARNESSES.map((id) => [id, modelsFor(id).filter((model) => isModelEnabled(model.id))]),
    ),
  ),
  defaultAccounts: {
    claude: defaultProviderAccountId("claude"),
    codex: defaultProviderAccountId("codex"),
  },
}));

let started = false;

/** Defer Host reads until the renderer has mounted and had a chance to paint. */
export function startRendererModelRoutingAfterPaint(): () => void {
  if (started || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window))
    return () => {};

  let frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(() => {
      if (started) return;
      started = true;
      void import("./delegation")
        .then(({ startDelegationProfileSync }) => startDelegationProfileSync())
        .catch(() => undefined);
      void import("../model/liveCatalogFacts")
        .then(({ startLocalLiveCatalogFactsSync }) => startLocalLiveCatalogFactsSync(10_000))
        .catch(() => undefined);
    });
  });
  return () => window.cancelAnimationFrame(frame);
}
