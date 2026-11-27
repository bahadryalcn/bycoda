import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { OnboardingHeading } from "./OnboardingHeading";
import { OnboardingIllustratedStep } from "./OnboardingIllustratedStep";
import { Globe } from "../../../shared/ui/icons";
import { Surface } from "../../../shared/ui/Surface";

/** The optional Connections step: the remote computers already known, and the one manager button. */
export function OnboardingConnections({
  remotes,
  onManage,
}: {
  remotes: readonly { id: string; name: string }[];
  onManage: () => void;
}) {
  return (
    <>
      <OnboardingHeading
        title={t("Connections")}
        info={t("Remote agents stay on their own computer. Add machines later in Settings.")}
      />
      <OnboardingIllustratedStep scene="connections">
        {/* This computer is always there, so only remote machines are listed. */}
        {remotes.map((machine) => (
          <Surface
            variant="card"
            padding="md"
            className="mb-2 flex min-w-0 items-center gap-3"
            key={machine.id}
          >
            <Globe aria-hidden className="icon-lg shrink-0" />
            <Text
              as="strong"
              size="inherit"
              tone="inherit"
              weight="medium"
              leading="inherit"
              truncate
            >
              {machine.name}
            </Text>
          </Surface>
        ))}
        <div className="onboarding-actions">
          <Button onClick={onManage} variant="secondary" type="button">
            <Globe aria-hidden className="icon-sm" />
            {t("Manage connections…")}
          </Button>
        </div>
      </OnboardingIllustratedStep>
    </>
  );
}
