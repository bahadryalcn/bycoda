import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { TerminalView } from "../../src/features/terminal/ui/TerminalView";
import "../../src/styles/index.css";
import "../../src/features/terminal/ui/terminal.css";
import { applyThemePreference } from "../../src/features/settings/model/appearance";

const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
// Observe public xterm selection events without adding test APIs to the product.
const open = Terminal.prototype.open;
Terminal.prototype.open = function (element) {
  open.call(this, element);
  this.onRender(() => {
    document.documentElement.dataset.terminalTypography = JSON.stringify({
      fontSize: this.options.fontSize,
      fontFamily: this.options.fontFamily,
      fontWeight: this.options.fontWeight,
      lineHeight: this.options.lineHeight,
    });
  });
  this.onWriteParsed(() => {
    const buffer = this.buffer.active;
    document.documentElement.dataset.terminalPrompt = buffer
      .getLine(buffer.baseY + buffer.cursorY)
      ?.translateToString(true);
  });
  this.onSelectionChange(() => {
    document.documentElement.dataset.terminalSelection = this.getSelection();
    document.documentElement.dataset.terminalPosition = JSON.stringify(this.getSelectionPosition());
  });
};
createRoot(document.getElementById("root")!).render(
  <div className="project-terminal-dock" style={{ height: "90dvh", width: "100%" }}>
    <TerminalView id="fixture" cwd="/fixture" active />
  </div>,
);
