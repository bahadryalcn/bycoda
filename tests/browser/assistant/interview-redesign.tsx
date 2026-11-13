import { createRoot } from "react-dom/client";
import { AssistantBuilderDialog } from "../../../src/features/assistant/ui/builder/AssistantBuilderDialog";
import { registerBuiltinHarnesses } from "../../../src/integrations/harness/core/register";
import { setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";
import "./interview-redesign-mocks";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
await setLanguagePreference("en");
registerBuiltinHarnesses();
createRoot(document.getElementById("root")!).render(
  <AssistantBuilderDialog
    current={{
      name: "Arif",
      language: "Turkish",
      tone: "friendly",
      persona: "Keep spoken replies brief.",
    }}
    onApply={(patch) => {
      (window as any).interviewApplied = patch;
    }}
    onClose={() => {
      (window as any).interviewClosed = true;
    }}
  />,
);
