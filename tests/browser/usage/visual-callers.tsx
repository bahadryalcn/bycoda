import { AccountAvatar } from "../../../src/features/account/ui/AccountAvatar";
import { FeedbackDialog } from "../../../src/features/account/ui/FeedbackDialog";
import { openFeedbackDialog } from "../../../src/features/account/model/feedbackDialog";
import { announcementFeed } from "../../../src/features/account/model/announcementFeed";
import { Button } from "../../../src/shared/ui/Button";
import { AccountNews } from "../../../src/features/account/ui/AccountNews";
import { DecisionModelsSettings } from "../../../src/features/decision-models/ui/DecisionModelsSettings";
import { ApiProviderDialog } from "../../../src/features/decision-models/ui/ApiProviderDialog";
import { SourceOrderPicker } from "../../../src/features/decision-models/ui/SourceOrderPicker";
import { decisionModelsClient } from "../../../src/features/decision-models/model/decisionModelsClient";
import { Contribution } from "../../../src/features/usage/ui/UsageVisualizations";
import { GrokLimits } from "../../../src/features/usage/ui/GrokLimits";
const hold = () => new Promise<never>(() => {});
const client = decisionModelsClient("visual-fixture");
client.sources.list = hold;
client.routing.get = hold;
client.discovery.results = hold;
client.catalog.get = hold;
if (new URLSearchParams(location.search).get("visualCaller") === "account-controls")
  announcementFeed.setItems(
    [1, 2, 3].map((n) => ({
      id: `fixture-news-${n}`,
      title: `Fixture announcement ${n}`,
      body: "Local fixture announcement; no account service request.",
      severity: "info" as const,
      publishedAt: `2026-11-0${n}T10:00:00Z`,
    })),
  );
function AccountControlsFixture() {
  return (
    <main className="p-4">
      <div className="flex items-center gap-4">
        <AccountAvatar user={null} />
        <AccountAvatar user={{ displayName: "Fixture Reader" }} />
        <AccountAvatar
          size="lg"
          user={{
            displayName: "Fixture Photo",
            avatarUrl:
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='gray'/%3E%3C/svg%3E",
          }}
        />
      </div>
      <AccountNews />
      <Button onClick={openFeedbackDialog}>Open feedback fixture</Button>
      <FeedbackDialog />
    </main>
  );
}
export function VisualCaller({ view }: { view: string }) {
  if (view === "account-controls") return <AccountControlsFixture />;
  if (view === "account") return <AccountNews />;
  if (view === "decision") return <DecisionModelsSettings client={client} />;
  if (view === "api")
    return (
      <ApiProviderDialog
        catalog={null}
        catalogError={null}
        onAdd={hold}
        onTest={hold}
        onClose={() => {}}
      />
    );
  if (view === "source-order")
    return (
      <SourceOrderPicker
        label="Fixture source order"
        value={[]}
        sources={[]}
        disabled={false}
        onChange={() => {}}
      />
    );
  if (view === "grok") return <GrokLimits refresh={0} />;
  return (
    <Contribution
      rows={[]}
      metric="tokens"
      title="Fixture contribution"
      colors={new Map()}
      onSelect={() => {}}
    />
  );
}
