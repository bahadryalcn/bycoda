import { useEffect, useEffectEvent } from "react";
import {
  subscribeEditRequests,
  subscribeReconnectRequests,
  takeEditRequest,
  takeReconnectRequest,
} from "../model/connections";
import { subscribeMachineAddRequests, takeMachineAddRequest } from "../model/machineAdd";
import type { RemoteMachine } from "../model/protocol";

/** Takes the add, edit and reconnect requests other views post for this page.
 * Each request is consumed once; the handlers only run the page's own actions. */
export function useConnectionRequestInbox({
  machines,
  busy,
  onAdd,
  onEdit,
  onReconnect,
}: {
  machines: RemoteMachine[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (machine: RemoteMachine) => void;
  onReconnect: (machine: RemoteMachine) => void;
}) {
  const add = useEffectEvent(onAdd);
  const edit = useEffectEvent(onEdit);
  const reconnect = useEffectEvent(onReconnect);
  useEffect(() => {
    const start = () => {
      if (!busy && takeMachineAddRequest()) add();
    };
    start();
    return subscribeMachineAddRequests(start);
  }, [busy]);
  // A view that cannot reach a machine asks for its address to be edited here.
  useEffect(() => {
    const start = () => {
      const machine = takeEditRequest(machines);
      if (machine?.ssh) edit(machine);
    };
    start();
    return subscribeEditRequests(start);
  }, [machines]);
  // A view that cannot reach a machine asks for it to be reconnected here, where
  // the SSH prompts are answered.
  useEffect(() => {
    const start = () => {
      const machine = takeReconnectRequest(machines);
      if (machine?.ssh) reconnect(machine);
    };
    start();
    return subscribeReconnectRequests(start);
  }, [machines]);
}
