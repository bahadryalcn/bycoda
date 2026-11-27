import { createRoot } from "react-dom/client";
import { presentedSpecs } from "../../../src/features/voice/model/voicePresentedCatalog";
import { VoicePresentedResultSchema } from "../../../src/features/voice/model/voicePresentedResult";
import VoicePresentedAnswer from "../../../src/features/voice/ui/companion/VoicePresentedAnswer";
import { setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
// The app shell fixes these roots; this standalone fixture uses ordinary document scrolling.
for (const element of [document.documentElement, document.body, document.getElementById("root")!]) {
  element.style.position = "static";
  element.style.height = "auto";
  element.style.overflow = "visible";
}
document.documentElement.dataset.canvasBackground = "pure";
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");

const presses: unknown[] = [];
Object.assign(window, { presentedPresses: presses });

/** One owner flow over the typed fields this catalog adds, ending in a button that reads them all. */
const form = {
  title: "Plan a report",
  blocks: [
    {
      type: "FieldGroup",
      legend: "Report",
      description: "Choose when and for whom.",
      layout: "stack",
      children: [
        { type: "DateTimePicker", id: "at", label: "Start at", value: "2026-11-24T09:30" },
        { type: "DateRangePicker", id: "days", label: "Days" },
        {
          type: "DateTimeRangePicker",
          id: "window",
          label: "Window",
          value: { start: "2026-11-24T00:00", end: "2026-11-25T00:00" },
        },
        {
          type: "Combobox",
          id: "branch",
          label: "Branch",
          suggestions: [
            { value: "main", label: "main" },
            { value: "release", label: "release" },
          ],
        },
      ],
    },
    {
      type: "RowList",
      id: "session",
      label: "Session",
      rows: [
        { value: "a", label: "Fix login", meta: "2h ago" },
        { value: "b", label: "Review notes", description: "Waiting for you" },
      ],
    },
    {
      type: "Button",
      label: "Create report",
      variant: "primary",
      requires: ["session", "days"],
      action: {
        action: "workspace.usage.open",
        input: {
          at: { $bind: "at" },
          days: { $bind: "days" },
          window: { $bind: "window" },
          branch: { $bind: "branch" },
          session: { $bind: "session" },
        },
      },
    },
  ],
};

const entries = [
  ["form", form],
  ...presentedSpecs.map(
    (spec) => [spec.name, { title: spec.name, blocks: [spec.example] }] as const,
  ),
] as const;

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto grid max-w-[40rem] gap-6 p-4">
    {entries
      .filter(([name]) => !params.has("only") || params.get("only") === name)
      .map(([name, view]) => (
        <section key={name} data-spec={name} className="min-w-0">
          <VoicePresentedAnswer
            result={VoicePresentedResultSchema.parse(view)}
            version={1}
            onAction={async (button) => {
              presses.push(button);
            }}
          />
        </section>
      ))}
  </main>,
);
