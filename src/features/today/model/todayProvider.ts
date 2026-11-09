import { canRunHarnessTextPrompt, runHarnessTextPrompt } from "../../../integrations/harness";
import { mergeModelSettings, nativeModelId, resolveModel } from "../../sessions/public/models";
import { defaultTextActionChoice } from "../../sessions/public/translationPreferences";
import { createNote, getNote, loadNoteSummaries, upsertNote } from "../../notes";
import type { DailyNoteApi, SummaryRunner } from "./todaySummary";

export type SummaryProvider = { model: string; run: SummaryRunner };

/**
 * The user's own default text-action provider and model (the one Settings shows for
 * translation), run as an isolated, unsaved, tool-free request in `cwd`.
 */
export function summaryProvider(cwd: string): SummaryProvider | null {
  if (!cwd) return null;
  const choice = defaultTextActionChoice();
  if (!canRunHarnessTextPrompt(choice.harness)) return null;
  const model = resolveModel(choice.harness, choice.model);
  const native = nativeModelId(model);
  return {
    model: native,
    run: (prompt, signal) =>
      runHarnessTextPrompt({
        cwd,
        harness: choice.harness,
        model: native,
        modelSettings: mergeModelSettings(model, choice.modelSettings),
        providerAccountId: choice.providerAccountId,
        intent: "plan",
        ephemeral: true,
        timeoutMs: 90_000,
        signal,
        prompt,
      }),
  };
}

export const dailyNoteApi: DailyNoteApi = {
  find: async (title) =>
    (await loadNoteSummaries(true)).find((note) => note.title === title) ?? null,
  read: (id) => getNote(id),
  update: (note) => upsertNote(note),
  create: (note) => createNote(note),
};
