import type { AssistantSnapshot } from "../../../src/shared/model/host-contracts/assistant";
import { Button } from "../../../src/shared/ui/Button";

/** Dev fixture only. Values enter through the same snapshot boundary as demo data. */
export function applyRecordsDataset(snapshot: AssistantSnapshot) {
  const mode = new URLSearchParams(location.search).get("data");
  if (!mode || mode === "demo") return;
  if (mode === "empty") {
    snapshot.jobs = [];
    snapshot.notes = [];
    snapshot.activity = [];
    snapshot.memory = [];
    snapshot.briefing = null;
    return;
  }
  if (mode === "one") {
    snapshot.jobs = snapshot.jobs.slice(0, 1);
    snapshot.notes = snapshot.notes.slice(0, 1);
    snapshot.activity = snapshot.activity.slice(0, 1);
    snapshot.memory = snapshot.memory.slice(0, 1);
    return;
  }
  snapshot.profile.name = "Aleksandra Wiśniewska-Kowalczyk";
  snapshot.profile.avatar = "👩🏽‍💻";
  const title = "Review authentication recovery for Northwind international customer workspaces";
  snapshot.jobs = snapshot.jobs.map((job, index) => ({
    ...job,
    title: index ? "J" : title,
    summary:
      "Review pending: İstanbul, 東京, نور الهدى. Preserve the original owner request and saved drafts.",
  }));
  snapshot.notes = snapshot.notes.map((note) => ({
    ...note,
    title,
    body:
      "## Recovery notes\n\n" +
      "bartholomew.fitzgerald@northwind-industries-holdings.example.com\n\n" +
      "İstanbul, 東京, نور الهدى. 👩🏽‍💻 Work remains scoped to the original workspace.\n\n".repeat(10),
  }));
  snapshot.memory = snapshot.memory.map((entry) => ({
    ...entry,
    text:
      "Always preserve the original workspace and explain any failed operation before trying again. İstanbul, 東京, نور الهدى. " +
      title,
  }));
  snapshot.activity = snapshot.activity.map((entry) => ({
    ...entry,
    summary: title + ": bartholomew.fitzgerald@northwind-industries-holdings.example.com",
  }));
  if (mode === "large")
    snapshot.activity = Array.from({ length: 100 }, (_, index) => ({
      ...snapshot.activity[0]!,
      id: `stress-${index}`,
      createdAt: Date.now() - index * 60000,
    }));
}

export function RecordsDatasetToggle() {
  const params = new URLSearchParams(location.search);
  if (!params.has("data")) return null;
  return (
    <div
      aria-label="Fixture dataset"
      style={{
        position: "fixed",
        bottom: 8,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 4,
        zIndex: 9999,
      }}
    >
      {(["demo", "worst", "empty", "one", "large"] as const).map((mode) => (
        <Button
          key={mode}
          size="sm"
          selected={params.get("data") === mode}
          onClick={() => {
            params.set("data", mode);
            location.search = params.toString();
          }}
        >
          {
            {
              demo: "Demo data",
              worst: "Worst case",
              empty: "Empty",
              one: "One",
              large: "100 rows",
            }[mode]
          }
        </Button>
      ))}
    </div>
  );
}
