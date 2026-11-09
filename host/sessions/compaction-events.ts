import {
  compactionContextEvents,
  isReplayAcceptingEvent,
} from "../../src/integrations/harness/core/compactionContext";
import type { HarnessEvent } from "../../src/integrations/harness/core/types";

export function hostCompactionEvents(
  compacting: boolean,
  emit: (event: HarnessEvent, accepted: boolean) => void,
) {
  const forward = (event: HarnessEvent) => emit(event, isReplayAcceptingEvent(event));
  const compact = compactionContextEvents(forward);
  return { onEvent: compacting ? compact.onEvent : forward, complete: compact.complete };
}
