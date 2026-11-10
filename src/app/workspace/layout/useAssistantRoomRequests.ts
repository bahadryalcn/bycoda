import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AuxiliaryToolId } from "../../model/toolWindows";

type SetBoolean = Dispatch<SetStateAction<boolean>>;
type AssistantTab = "today" | "memory" | "settings" | "history";

/** Opens the assistant Room on a requested tab when anything dispatches `bycoda:open-assistant`. */
export function useAssistantRoomRequests(setters: {
  setInboxViewOpen: SetBoolean;
  setNotesViewOpen: SetBoolean;
  setServersViewOpen: SetBoolean;
  setAutomationsViewOpen: SetBoolean;
  setSocialBoardShown: SetBoolean;
  setTaskBoardShown: SetBoolean;
  setAuxiliaryTool?: (tool: AuxiliaryToolId | null) => void;
}) {
  const [navigation, setNavigation] = useState<{ tab: AssistantTab; token: number }>({
    tab: "today",
    token: 0,
  });
  const {
    setInboxViewOpen,
    setNotesViewOpen,
    setServersViewOpen,
    setAutomationsViewOpen,
    setSocialBoardShown,
    setTaskBoardShown,
    setAuxiliaryTool,
  } = setters;
  useEffect(() => {
    const openAssistant = (event: Event) => {
      const requested = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      const tab =
        requested === "memory" || requested === "settings" || requested === "history"
          ? requested
          : "today";
      setNavigation((previous) => ({ tab, token: previous.token + 1 }));
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setServersViewOpen(false);
      setAutomationsViewOpen(true);
      setSocialBoardShown(false);
      setTaskBoardShown(false);
      setAuxiliaryTool?.("assistant");
    };
    window.addEventListener("bycoda:open-assistant", openAssistant);
    return () => window.removeEventListener("bycoda:open-assistant", openAssistant);
  }, [
    setInboxViewOpen,
    setNotesViewOpen,
    setServersViewOpen,
    setAutomationsViewOpen,
    setSocialBoardShown,
    setTaskBoardShown,
    setAuxiliaryTool,
  ]);
  return navigation;
}
