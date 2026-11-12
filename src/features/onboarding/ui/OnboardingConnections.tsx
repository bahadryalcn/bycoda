import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { AppWindow, Globe } from "../../../shared/ui/icons";
import { Surface } from "../../../shared/ui/Surface";

/** The optional Connections step: this computer, remote computers and the manager. */
export function OnboardingConnections({
  remotes,
  onManage,
}: {
  remotes: readonly { id: string; name: string }[];
  onManage: () => void;
}) {
  return (
    <>
      <div className="onboarding-heading">
        <Heading size="page" level={3}>
          {t("Connect your computers")}
        </Heading>
        <Text as="p" size="inherit" tone="muted" leading="normal">
          {t("Work here, connect another computer, or pair your phone. This step is optional.")}
        </Text>
      </div>
      <div className="onboarding-scroll">
        <Surface variant="card" padding="md" className="onboarding-card">
          <AppWindow aria-hidden className="icon-lg" />
          <div>
            <Text as="strong" size="inherit" tone="inherit" weight="medium" leading="inherit">
              {t("This computer")}
            </Text>
            <Text as="small" size="caption" tone="muted" leading="normal" truncate>
              {t("Your local projects and agents")}
            </Text>
          </div>
          <Text size="micro" tone="muted" leading="inherit" className="onboarding-status">
            {t("Local")}
          </Text>
        </Surface>
        {remotes.map((machine) => (
          <Surface variant="card" padding="md" className="onboarding-card" key={machine.id}>
            <Globe aria-hidden className="icon-lg" />
            <div>
              <Text as="strong" size="inherit" tone="inherit" weight="medium" leading="inherit">
                {machine.name}
              </Text>
              <Text as="small" size="caption" tone="muted" leading="normal" truncate>
                {t("Remote computer")}
              </Text>
            </div>
            <Button onClick={onManage} variant="secondary" type="button">
              {t("Manage")}
            </Button>
          </Surface>
        ))}
        <div className="onboarding-actions">
          <Button onClick={onManage} variant="secondary" type="button">
            <Globe aria-hidden className="icon-sm" />
            {t("Manage connections…")}
          </Button>
        </div>
        <Text as="p" size="caption" tone="muted" leading="normal" className="onboarding-hint">
          {t("Remote agents stay on their own computer. Add connections later in Settings.")}
        </Text>
      </div>
    </>
  );
}
