import { HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";

function knownProvider(provider: string): provider is keyof typeof HARNESS_TITLE {
  return Object.prototype.hasOwnProperty.call(HARNESS_TITLE, provider);
}

/** Keep provider identities canonical without changing model or project names. */
export function usageProviderLabel(provider: string): string {
  return knownProvider(provider) ? HARNESS_TITLE[provider] : provider;
}

export function UsageProviderIdentity({ provider, label }: { provider: string; label?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {knownProvider(provider) && <HarnessIcon harness={provider} size="sm" className="shrink-0" />}
      <span className={label === "" ? "sr-only" : "truncate"}>
        {label || usageProviderLabel(provider)}
      </span>
    </span>
  );
}
