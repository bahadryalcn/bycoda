import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { AppWindow, Globe } from "../../../shared/ui/icons";

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
        <h3>{t("Connect your computers")}</h3>
        <p>
          {t("Work here, connect another computer, or pair your phone. This step is optional.")}
        </p>
      </div>
      <div className="onboarding-scroll">
        <div className="onboarding-card">
          <AppWindow aria-hidden className="icon-lg" />
          <div>
            <strong>{t("This computer")}</strong>
            <small>{t("Your local projects and agents")}</small>
          </div>
          <span className="onboarding-status">{t("Local")}</span>
        </div>
        {remotes.map((machine) => (
          <div className="onboarding-card" key={machine.id}>
            <Globe aria-hidden className="icon-lg" />
            <div>
              <strong>{machine.name}</strong>
              <small>{t("Remote computer")}</small>
            </div>
            <Button onClick={onManage} variant="secondary" type="button">
              {t("Manage")}
            </Button>
          </div>
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
