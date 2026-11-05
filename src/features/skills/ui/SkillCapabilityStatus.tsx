import { CapabilityStatus } from "../../../shared/ui/CapabilityStatus";

/** Discovery is inventory evidence; provider readiness and invocation activity are not observed here. */
export function SkillCapabilityStatus({
  disabled,
  policyKnown,
}: {
  disabled: boolean;
  policyKnown: boolean;
}) {
  return (
    <CapabilityStatus
      permission={policyKnown ? (disabled ? "disabled" : "enabled") : "unknown"}
      readiness="unknown"
      activity="unknown"
    />
  );
}
