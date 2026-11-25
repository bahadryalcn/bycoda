import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { useState } from "react";
import { errorText } from "../../../../shared/lib/errors";
import type { VoiceLiveResult } from "../../model/voiceLiveWork";
import {
  VoicePresentedActionButtonSchema,
  type VoicePresentedActionButton,
  type VoicePresentedActionResponse,
} from "../../model/voicePresentedActions";
import { compilePresentedProgram, PRESENTED_ACTION } from "../../model/voicePresentedProgram";
import type { VoicePresentedResult } from "../../model/voicePresentedResult";
import { observedWorkRecords } from "../../model/voiceWorkResultBlocks";
import { PresentedHostContext, type PresentedPress } from "./presented/presentedContext";
import { presentedLibrary } from "./presented/presentedLibrary";
import { WorkRecordsProvider } from "./presented/workResultEntries";

type PresentedView = {
  result: VoicePresentedResult;
  /** Counts each presentation, so the caller can tell which one is actually on screen. */
  version: number;
  /** The voice turn's observed results, for components that draw what the turn measured. */
  observed?: readonly VoiceLiveResult[];
  /** Runs one button. It resolves with what the app reported, or rejects with the reason. */
  onAction: (button: VoicePresentedActionButton) => Promise<VoicePresentedActionResponse | void>;
};

/** A field the owner left empty is not sent as null; the action's own schema decides if it is needed. */
const withoutNull = (value: unknown): unknown =>
  Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== null && item !== undefined)
            .map(([key, item]) => [key, withoutNull(item)]),
        )
      : value;

/**
 * Draws a validated view. Model text never becomes code: the view is compiled to an OpenUI program
 * of literals, field variables and node references, and rendered with the shared components only.
 */
export default function VoicePresentedAnswer({
  result,
  version,
  observed = [],
  onAction,
}: PresentedView) {
  const { program } = compilePresentedProgram(result);
  const [presses, setPresses] = useState<{
    version: number;
    byNode: ReadonlyMap<number, PresentedPress>;
  }>({
    version,
    byNode: new Map(),
  });
  const [selected, setSelected] = useState<string>();
  const feedback = presses.version === version ? presses.byNode : new Map<number, PresentedPress>();

  const record = (node: number, press: PresentedPress) =>
    setPresses((previous) => {
      const byNode = new Map(previous.version === version ? previous.byNode : []);
      byNode.set(node, press);
      return { version, byNode };
    });

  const run = async (event: ActionEvent) => {
    if (event.type !== PRESENTED_ACTION) return;
    const node = event.params.node;
    if (typeof node !== "number") return;
    const signature = JSON.stringify(event.params.button);
    const parsed = VoicePresentedActionButtonSchema.safeParse(withoutNull(event.params.button));
    if (!parsed.success) {
      record(node, { signature, state: "failed", message: "This action is incomplete." });
      return;
    }
    record(node, { signature, state: "pending" });
    try {
      const response = (await onAction(parsed.data)) ?? undefined;
      record(node, { signature, state: "sent", ...(response ? { response } : {}) });
    } catch (error) {
      record(node, { signature, state: "failed", message: errorText(error) });
    }
  };

  return (
    <PresentedHostContext.Provider value={{ version, observed, feedback, canPress: true }}>
      <WorkRecordsProvider
        value={{
          records: observedWorkRecords(observed),
          selectedId: selected,
          onSelect: setSelected,
        }}
      >
        <Renderer
          library={presentedLibrary}
          response={program}
          onAction={(event) => void run(event)}
        />
      </WorkRecordsProvider>
    </PresentedHostContext.Provider>
  );
}
