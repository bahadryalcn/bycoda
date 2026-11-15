import type { ReactNode } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { InfoPopover } from "../../../shared/ui/InfoPopover";

/** A step heading that names the task; any supporting sentence lives behind one info icon. */
export function OnboardingHeading({ title, info }: { title: string; info?: ReactNode }) {
  return (
    <div className="onboarding-heading">
      <Heading size="page" level={3}>
        {title}
      </Heading>
      {info ? <InfoPopover>{info}</InfoPopover> : null}
    </div>
  );
}
