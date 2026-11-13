import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { MemberModelSection } from "./MemberModelSection";
import type { CrewAgent } from "../model/crew";
import type { HostModelCatalog } from "../../connections/public/protocol";
import type { ModelChoiceField } from "../../model-routing/public/choice";
type ModelChoiceFieldProps = ComponentProps<typeof ModelChoiceField>;
const fields = vi.hoisted(() => ({
  props: undefined as ModelChoiceFieldProps | undefined,
  manage: vi.fn(),
}));
vi.mock("../../model-routing/public/choice", () => ({
  ModelChoiceField: (props: ModelChoiceFieldProps) => {
    fields.props = props;
    return null;
  },
}));
vi.mock("../../settings/public/modelsSettingsLink", () => ({ openModelsSettings: fields.manage }));
const agent: CrewAgent = {
  id: "member",
  name: "Member",
  role: "specialist",
  instructions: "",
  selection: "automatic",
  modelChoice: { kind: "pool", poolId: "shared" },
  candidates: [{ id: "m", harness: "codex", model: "m", modelSettings: {}, capabilities: {} }],
};
it("uses shared crew role choice and opens Order and limits", () => {
  const change = vi.fn();
  renderToStaticMarkup(
    createElement(MemberModelSection, {
      cwd: "/p",
      catalog: { models: {}, errors: {} } as HostModelCatalog,
      agent,
      onChange: change,
      machineId: "host",
      modelPoolsSupported: true,
    }),
  );
  expect(fields.props).toMatchObject({
    routingRole: "crew.member",
    allowDefault: true,
    value: agent.modelChoice,
    machineId: "host",
    supported: true,
  });
  fields.props!.onChange({ kind: "fixed" });
  expect(change).toHaveBeenCalledWith({
    modelChoice: { kind: "fixed" },
    selection: "fixed",
  });
  fields.props!.onManage!();
  expect(fields.manage).toHaveBeenCalledWith("order");
});
