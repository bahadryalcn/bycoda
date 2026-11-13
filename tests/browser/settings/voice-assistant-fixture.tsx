import { useEffect, useState } from "react";
import { AssistantSettings } from "../../../src/features/assistant/ui/AssistantSettings";
import { useManualSupervision } from "../../../src/features/assistant/model/assistantManual";
import type { AssistantResponse } from "../../../src/shared/model/host-contracts/assistant";
import { hostToolRequest, snapshot } from "../assistant/assistant-room-mocks";

/** Fixture-only receiver for the workspace event; no owner Host is contacted. */
export function VoiceAssistantFixture() {
  const [open, setOpen] = useState(false);
  const manual = useManualSupervision(snapshot, [], open, "fixture-voice-local");
  // The real workspace owns this event. Settings fixtures have no workspace shell.
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail?.tab === "settings") setOpen(true);
    };
    window.addEventListener("bycoda:open-assistant", listener);
    return () => window.removeEventListener("bycoda:open-assistant", listener);
  }, []);
  return open ? (
    <AssistantSettings
      snapshot={snapshot}
      environmentId="fixture-voice-local"
      manual={manual}
      projects={[]}
      request={async (input) =>
        (await hostToolRequest("", "assistant.v1", "assistant.request", input)) as AssistantResponse
      }
      onClose={() => setOpen(false)}
      onSetup={() => {}}
    />
  ) : null;
}
