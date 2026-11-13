import {
  resolveSubagents,
  type AutomaticSubagentInput,
} from "../../../shared/model/automaticSubagents";
import { AUTOMATIC_SUBAGENTS } from "../../../shared/model/host-contracts/delegation";
import { HARNESSES, type HarnessId } from "../../../shared/model/harnessIdentity";
import { isHarnessAvailable } from "./availabilityState";

type CatalogSnapshot = Pick<AutomaticSubagentInput, "models" | "defaultAccounts">;
let readCatalog: (() => CatalogSnapshot) | undefined;

/** Renderer composition supplies live catalog/account reads without a foundation-to-feature import. */
export function setAutomaticSubagentCatalogReader(
  reader: (() => CatalogSnapshot) | undefined,
): void {
  readCatalog = reader;
}

/** Runtime catalog preview. agents.options remains the live Host authority. */
export function runtimeAutomaticSubagents(thread?: {
  harness?: string;
  providerAccountId?: string;
}) {
  const catalog = readCatalog?.();
  return resolveSubagents(AUTOMATIC_SUBAGENTS, {
    harness: (thread?.harness ?? "claude") as HarnessId,
    providerAccountId: thread?.providerAccountId,
    providers: HARNESSES.filter(isHarnessAvailable),
    models: catalog?.models ?? [],
    defaultAccounts: catalog?.defaultAccounts,
  });
}
