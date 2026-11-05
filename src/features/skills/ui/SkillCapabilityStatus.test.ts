import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SkillCapabilityStatus } from "./SkillCapabilityStatus";

it("does not infer provider readiness or running invocation from enable policy", () => {
  const markup = renderToStaticMarkup(
    createElement(SkillCapabilityStatus, { disabled: false, policyKnown: true }),
  );
  expect(markup).toContain('data-capability-axis="permission" data-state="enabled"');
  expect(markup).toContain('data-capability-axis="readiness" data-state="unknown"');
  expect(markup).toContain('data-capability-axis="activity" data-state="unknown"');
});

it("does not present stale policy as known after failed policy refresh", () => {
  const markup = renderToStaticMarkup(
    createElement(SkillCapabilityStatus, { disabled: false, policyKnown: false }),
  );
  expect(markup).toContain('data-capability-axis="permission" data-state="unknown"');
});
