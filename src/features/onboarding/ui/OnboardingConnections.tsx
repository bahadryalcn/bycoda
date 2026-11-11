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
        <p>
          {t("Work here, connect another computer, or pair your phone. This step is optional.")}
        </p>
      </div>
      <div className="onboarding-scroll">
        <Surface variant="card" padding="md" className="onboarding-card">
          <AppWindow aria-hidden className="icon-lg" />
          <div>
            <strong>{t("This computer")}</strong>
            <small>{t("Your local projects and agents")}</small>
          </div>
          <span className="onboarding-status">{t("Local")}</span>
        </Surface>
        {remotes.map((machine) => (
          <Surface variant="card" padding="md" className="onboarding-card" key={machine.id}>
            <Globe aria-hidden className="icon-lg" />
            <div>
              <strong>{machine.name}</strong>
              <small>{t("Remote computer")}</small>
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
        <p className="onboarding-hint">
          {t("Remote agents stay on their own computer. Add connections later in Settings.")}
        </p>
      </div>
    </>
  );
}
