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

// Renderer startup owns polling; the defaults model is also imported by the headless Host.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void import("./delegation")
    .then(({ startDelegationProfileSync }) => startDelegationProfileSync())
    .catch(() => undefined);
}
