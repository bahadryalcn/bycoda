import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { z } from "zod";
export const AssistantPresenceChoiceSchema = z.enum(["present", "away", "dnd"]);
export type AssistantPresenceChoice = z.infer<typeof AssistantPresenceChoiceSchema>;
export const AssistantPresenceViewSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  sourceToken: z.string().nullable(),
  status: z
    .strictObject({
      state: z.enum(["present", "idle", "away", "dnd", "unknown"]),
      setupComplete: z.boolean(),
      assistantName: z.string().max(80).optional(),
    })
    .nullable(),
  pending: z.boolean(),
  statusError: z.boolean(),
  writeError: z.boolean(),
  retry: AssistantPresenceChoiceSchema.nullable(),
});
export type AssistantPresenceView = z.infer<typeof AssistantPresenceViewSchema>;
export type AssistantPresencePort = {
  read(): Promise<AssistantPresenceView>;
  refresh(): Promise<AssistantPresenceView>;
  set(sourceToken: string, state: AssistantPresenceChoice): Promise<AssistantPresenceView>;
  subscribe(receive: (view: AssistantPresenceView) => void): Promise<() => void>;
};
export const nativeAssistantPresencePort: AssistantPresencePort = {
  read: async () => AssistantPresenceViewSchema.parse(await invoke("assistant_presence_state")),
  refresh: async () =>
    AssistantPresenceViewSchema.parse(await invoke("assistant_presence_refresh")),
  set: async (sourceToken, state) =>
    AssistantPresenceViewSchema.parse(
      await invoke("assistant_presence_set", {
        sourceToken,
        state: AssistantPresenceChoiceSchema.parse(state),
      }),
    ),
  subscribe: async (receive) =>
    getCurrentWebviewWindow().listen<unknown>("assistant_presence_state", (event) => {
      const parsed = AssistantPresenceViewSchema.safeParse(event.payload);
      if (parsed.success) receive(parsed.data);
    }),
};
export const emptyAssistantPresence: AssistantPresenceView = {
  revision: 0,
  sourceToken: null,
  status: null,
  pending: false,
  statusError: false,
  writeError: false,
  retry: null,
};
/** A displayed menu always keeps the source it opened against. */
export function canSetAssistantPresence(
  view: AssistantPresenceView,
  token: string | null,
): boolean {
  return (
    !!token &&
    view.sourceToken === token &&
    !!view.status?.setupComplete &&
    !view.pending &&
    !view.statusError &&
    !view.writeError
  );
}
