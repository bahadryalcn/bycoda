import type { ProviderAccountIdentity } from "../model/providerAccountIdentity";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { optionalTextAttributes, type TextRoles } from "../../../shared/ui/Text";

/**
 * Plan and masked email of an account. `size`, `tone` and `truncate` are Text roles for the
 * whole line; `className` is for placement.
 */
export function ProviderAccountSubtitle({
  identity,
  fallback,
  className = "",
  size,
  tone,
  truncate,
  wrap = false,
}: {
  identity: ProviderAccountIdentity | null | undefined;
  fallback?: string;
  /** Show the complete plan and masked/revealed email in account management rows. */
  wrap?: boolean;
} & Pick<TextRoles, "size" | "tone" | "truncate"> & { className?: string }) {
  const roles = {
    size,
    tone,
    truncate: wrap ? undefined : truncate,
    wrap: wrap ? ("anywhere" as const) : undefined,
  };
  if (!identity?.plan && !identity?.email) {
    return fallback ? (
      <span {...optionalTextAttributes(roles, `min-w-0 ${className}`)}>{fallback}</span>
    ) : null;
  }

  return (
    <span
      {...optionalTextAttributes(
        roles,
        `inline-flex min-w-0 items-baseline gap-1 ${wrap ? "flex-wrap " : ""}${className}`,
      )}
    >
      {identity.plan ? (
        <span
          {...optionalTextAttributes(
            wrap ? { wrap: "anywhere" } : {},
            wrap ? "min-w-0" : "shrink-0",
          )}
        >
          {identity.plan}
        </span>
      ) : null}
      {!wrap && identity.plan && identity.email ? <span aria-hidden>·</span> : null}
      {identity.email ? (
        <PrivateEmail key={identity.email} email={identity.email} wrap={wrap} />
      ) : null}
    </span>
  );
}
