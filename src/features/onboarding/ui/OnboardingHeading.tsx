import { Heading } from "../../../shared/ui/Heading";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";

/** A step heading that names the task; any supporting sentence lives behind one info icon. */
export function OnboardingHeading({ title, info }: { title: string; info?: string }) {
  return (
    <div className="onboarding-heading">
      <Heading size="page" level={3}>
        {title}
      </Heading>
      {info ? <InfoTooltip label={title}>{info}</InfoTooltip> : null}
    </div>
  );
}
