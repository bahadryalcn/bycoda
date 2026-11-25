import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { useState } from "react";
import { errorText } from "../../../../shared/lib/errors";
import type { VoiceLiveResult } from "../../model/voiceLiveWork";
import {
  parsePresentedPress,
  VoicePresentedViewChanged,
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
  onAction?: (button: VoicePresentedActionButton) => Promise<VoicePresentedActionResponse | void>;
};

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

  const record = (node: number, press: PresentedPress, pending?: PresentedPress) =>
    setPresses((previous) => {
      // A completion only owns the pending press it recorded for this view and node.
      if (
        previous.version > version ||
        (pending && (previous.version !== version || previous.byNode.get(node) !== pending))
      ) {
        return previous;
      }
      const byNode = new Map(previous.version === version ? previous.byNode : []);
      byNode.set(node, press);
      return { version, byNode };
    });

  const run = async (event: ActionEvent) => {
    if (!onAction || event.type !== PRESENTED_ACTION) return;
    const node = event.params.node;
    if (typeof node !== "number") return;
    const signature = JSON.stringify(event.params.button);
    const parsed = parsePresentedPress(event.params.button);
    if (!parsed.success) {
      record(node, { signature, state: "failed", reason: "incomplete" });
      return;
    }
    const pending = { signature, state: "pending" } as const;
    record(node, pending);
    try {
      const response = (await onAction(parsed.data)) ?? undefined;
      record(node, { signature, state: "sent", ...(response ? { response } : {}) }, pending);
    } catch (error) {
      record(
        node,
        error instanceof VoicePresentedViewChanged
          ? { signature, state: "failed", reason: "view-changed" }
          : { signature, state: "failed", detail: errorText(error) },
        pending,
      );
    }
  };

  return (
    <PresentedHostContext.Provider value={{ version, observed, feedback, canPress: !!onAction }}>
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
