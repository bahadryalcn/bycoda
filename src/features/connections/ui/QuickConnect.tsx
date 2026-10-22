import { SshServerEditor } from "./SshServerEditor";
import { useOpenQuickServerTerminal, useOpenServerTerminal } from "./ServersTerminalWorkspace";

/** Nothing connects until the reviewed form's explicit Connect submission. */
export function QuickConnect({ onClose }: { onClose: () => void }) {
  const openQuick = useOpenQuickServerTerminal();
  const openSaved = useOpenServerTerminal();
  if (!openQuick || !openSaved) return null;
  return (
    <SshServerEditor
      onClose={onClose}
      onConnect={(endpoint, name, saved) => {
        onClose();
        if (saved) openSaved(saved);
        else openQuick(endpoint, name);
      }}
    />
  );
}
