import { createRoot } from "react-dom/client";
import { FolderPicker } from "./FolderPicker";

export function openFolderPicker(options: { title: string; multiple: boolean }): Promise<string[]> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let finished = false;
    const finish = (paths: string[]) => {
      if (finished) return;
      finished = true;
      // Unmount outside the React event/render that completed the picker.
      queueMicrotask(() => {
        root.unmount();
        container.remove();
        resolve(paths);
      });
    };
    root.render(<FolderPicker {...options} onPick={finish} onClose={() => finish([])} />);
  });
}
