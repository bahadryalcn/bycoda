import { GoalCard } from "../../../src/features/tasks/ui/GoalCard";
import type { BoardGoal } from "../../../src/features/tasks/model/goalClient";
import { SettingFrame, SettingRow } from "../../../src/features/tasks/ui/TaskLimitsRow";
import { MachineRow } from "../../../src/features/connections/ui/MachineRow";
import { Button } from "../../../src/shared/ui/Button";
import { SegmentedControl } from "../../../src/shared/ui/SegmentedControl";
import { Text } from "../../../src/shared/ui/Text";
import "./uiCoherenceFixture.css";

const ignore = () => {};

/** Isolated browser fixture only. The real components receive realistic data through props. */
export function UiCoherenceFixture() {
  const query = new URLSearchParams(location.search);
  const worst = query.get("data") === "worst";
  const machine = {
    id: "coherence-machine",
    environmentId: "coherence-environment",
    name: worst
      ? "Aleksandra Wiśniewska-Kowalczyk İstanbul araştırma bilgisayarı مختبر التطوير 🧪"
      : "Development MacBook",
    endpoint: worst
      ? "https://research-development-workstation.northwind-industries-holdings.example.com:3774"
      : "https://development.example.com:3774",
  };
  const goal: BoardGoal = {
    id: "coherence-goal",
    title: worst
      ? "İstanbul araştırma ortamının erişilebilirlik denetimi مختبر 🧪"
      : "Check workspace accessibility",
    prompt: "Check keyboard navigation and preserve all pending drafts.",
    projectIds: ["fixture-project"],
    leadProjectId: "fixture-project",
    projects: [{ id: "fixture-project", cwd: "/fixture/project", name: "Research workspace" }],
    machineId: machine.id,
    machineName: machine.name,
    stale: worst,
    harness: "claude",
    model: "claude:fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    verifyDefaults: { review: false },
    approvePlan: false,
    status: "done",
    taskIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return (
    <div className="coherence-fixture">
      <div className="coherence-fixture-content" dir={query.has("rtl") ? "rtl" : "ltr"}>
        <Text as="p">Isolated fixture. No live account or task operations.</Text>
        <SettingFrame>
          <SettingRow
            title={
              worst
                ? "Araştırma ortamındaki ajanların günlük çalışma süresi üst sınırı"
                : "Daily agent time"
            }
          >
            <Button variant="secondary">Configure</Button>
          </SettingRow>
        </SettingFrame>
        <GoalCard
          goal={goal}
          tasks={[]}
          busy={false}
          pending={false}
          onApprove={ignore}
          onEdit={ignore}
          onReplan={async () => {}}
          onError={ignore}
          onCancel={ignore}
          onDelete={ignore}
          onSessions={ignore}
        />
        <MachineRow
          machine={machine}
          machines={[machine]}
          probed="offline"
          needsUpdate={false}
          showDetails
          editing={false}
          busy={false}
          revoking={false}
          menuOpen={false}
          onUpdateHost={ignore}
          onReconnect={ignore}
          onToggleMenu={ignore}
          onSyncNow={ignore}
        />
      </div>
      <div className="coherence-fixture-switch">
        <SegmentedControl
          label="Fixture data"
          value={worst ? "worst" : "demo"}
          options={[
            { value: "demo", label: "Demo data" },
            { value: "worst", label: "Worst case" },
          ]}
          onValueChange={(value) => {
            query.set("data", value);
            location.search = query.toString();
          }}
        />
      </div>
    </div>
  );
}
