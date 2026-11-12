import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text, textAttributes } from "../../../shared/ui/Text";
import cursorIcon from "../../../assets/providers/cursor.svg";
import { CodeBlock } from "../../../shared/ui/icons";

export function ExternalEditorIcon({ id }: { id: string }) {
  if (id === "cursor") return <img src={cursorIcon} alt="" className="size-4" />;
  if (id === "vscode" || id === "vscode-insiders")
    return (
      <svg
        viewBox="0 0 24 24"
        {...textAttributes({ tone: id === "vscode" ? "info" : "success" }, "size-4")}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="m17 2 5 2v16l-5 2-11-9-4 3-2-1V9l2-1 4 3L17 2Zm0 5-7 5 7 5V7ZM2 10v4l2-2-2-2Z" />
      </svg>
    );
  const jetbrains = { intellij: "IJ", webstorm: "WS", pycharm: "PC" };
  if (id in jetbrains)
    return (
      <Text
        aria-hidden="true"
        size="micro"
        tone="primary"
        weight="medium"
        {...surfaceAttributes(
          { radius: "sm", frame: "pane", edge: "all" },
          "grid size-4 place-items-center border-(--ui-pane-border) bg-(--ui-fill-subtle)",
        )}
      >
        {jetbrains[id as keyof typeof jetbrains]}
      </Text>
    );
  return <CodeBlock tone="accent" className="icon-md" />;
}
