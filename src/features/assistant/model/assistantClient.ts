import { useEffect, useSyncExternalStore } from "react";
import { hostToolRequest } from "../../connections/model/hostFeatureClient";
import { t, useLocale } from "../../../shared/i18n";
import { AssistantResponseValidationSchema } from "../../../shared/model/host-contracts/assistant";
import type {
  AssistantRequest,
  AssistantResponse,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import { captureAssistantHostRead } from "./assistantHostRead";

type State = {
  snapshot: AssistantSnapshot | null;
  environmentId: string | null;
  loading: boolean;
  error: string;
};
let state: State = { snapshot: null, environmentId: null, loading: false, error: "" };
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
let consumers = 0;
let poller: ReturnType<typeof setInterval> | undefined;
const emit = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export async function refreshAssistant(): Promise<void> {
  if (pending) return pending;
  emit({ loading: true });
  pending = (async () => {
    try {
      const owner = await captureAssistantHostRead();
      const result = AssistantResponseValidationSchema.parse(
        await hostToolRequest<AssistantResponse>(
          "",
          "assistant.v1",
          "assistant.request",
          { op: "snapshot", limit: 100 },
          { kind: "local" },
          owner.environmentId,
        ),
      );
      if (!result.snapshot) throw new Error("The Host returned no assistant state.");
      emit({ snapshot: result.snapshot, environmentId: owner.environmentId, error: "" });
    } catch (cause) {
      emit({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      pending = null;
      emit({ loading: false });
    }
  })();
  return pending;
}

/** Mutation retries remain explicit. Callers retain their idempotency key and draft. */
export async function assistantRequest(
  request: AssistantRequest,
  expectedEnvironmentId?: string,
): Promise<AssistantResponse> {
  const result = AssistantResponseValidationSchema.parse(
    await hostToolRequest<AssistantResponse>(
      "",
      "assistant.v1",
      "assistant.request",
      request,
      { kind: "local" },
      expectedEnvironmentId,
    ),
  );
  if (
    ![
      "snapshot",
      "projects.list",
      "manual.list",
      "memory.search",
      "threads.messages",
      "conversations.search",
      "notes.get",
      "questions.get",
    ].includes(request.op)
  ) {
    await refreshAssistant();
    window.dispatchEvent(new Event("bycoda:assistant-changed"));
  }
  return result;
}

export function useAssistantSnapshot() {
  const value = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    consumers++;
    if (consumers === 1) {
      void refreshAssistant();
      poller = setInterval(() => {
        if (document.visibilityState !== "hidden") void refreshAssistant();
      }, 15000);
    }
    return () => {
      consumers--;
      if (consumers === 0) {
        clearInterval(poller);
        poller = undefined;
      }
    };
  }, []);
  return { ...value, refresh: refreshAssistant };
}

/** Turkish proper-name possessive; other locales use a suffix-free room title. */
export function possessiveName(name: string) {
  const clean = name.trim();
  const vowels = [...clean.toLocaleLowerCase("tr")].filter((letter) => "aeıioöuü".includes(letter));
  const last = vowels[vowels.length - 1];
  if (!last) return clean;
  const suffix = "aı".includes(last)
    ? "ın"
    : "ei".includes(last)
      ? "in"
      : "ou".includes(last)
        ? "un"
        : "ün";
  return `${clean}'${/[aeıioöuü]$/.test(clean.toLocaleLowerCase("tr")) ? "n" : ""}${suffix}`;
}

export function assistantIdentity(
  profile: AssistantSnapshot["profile"] | undefined,
  locale: string,
) {
  const name = profile?.name.trim() ?? "";
  return {
    name,
    title: name ? (profile?.showTitle ? t("Assistant {p0}", { p0: name }) : name) : t("Set up"),
    room: name
      ? locale.startsWith("tr") && /[aeıioöuü]/.test(name.toLocaleLowerCase("tr"))
        ? t("{p0} room", { p0: possessiveName(name) })
        : t("Room · {p0}", { p0: name })
      : t("Set up"),
    setupComplete: profile?.setupComplete === true,
    voiceSetupComplete: profile?.voiceSetupComplete === true,
  };
}

export function useAssistantIdentity() {
  const locale = useLocale();
  const { snapshot, loading, error } = useAssistantSnapshot();
  return { ...assistantIdentity(snapshot?.profile, locale), loading, error };
}

/** Rail label for the assistant room; before setup it names the tool instead of "Set up". */
export function useAssistantRoomLabel() {
  const identity = useAssistantIdentity();
  return identity.name ? identity.room : t("Assistant");
}

export type AssistantRoomTab = "today" | "memory" | "settings" | "history";

/** Opens the assistant room through the workspace tool panels. */
export function openAssistantRoom(tab: AssistantRoomTab = "today") {
  window.dispatchEvent(new CustomEvent("bycoda:open-assistant", { detail: { tab } }));
}

export function operationId() {
  return crypto.randomUUID();
}
