import {
  action,
  createLibrary,
  defineAction,
  defineComponent,
  reactive,
  useStateField,
  type ComponentRenderProps,
} from "@openuidev/react-lang";
import { createElement, useContext } from "react";
import { z } from "zod";
import { Heading } from "../../../../../shared/ui/Heading";
import { Text } from "../../../../../shared/ui/Text";
import { presentedSpecs } from "../../../model/voicePresentedCatalog";
import { PRESENTED_ACTION } from "../../../model/voicePresentedProgram";
import type { PresentedSpec } from "../../../model/voicePresentedSpec";
import { presentedActionViews } from "./presentedActions";
import { PresentedHostContext, type PresentedView } from "./presentedContext";
import { presentedFieldViews } from "./presentedFields";
import { presentedObservedViews } from "./presentedObserved";
import { presentedRecordViews } from "./presentedRecords";
import { presentedViews } from "./presentedViews";

/** One map from component name to its view; the parity test proves it matches the catalog. */
export const presentedViewMap: Record<string, PresentedView> = {
  ...presentedViews,
  ...presentedFieldViews,
  ...presentedActionViews,
  ...presentedObservedViews,
  ...presentedRecordViews,
};

/** The library's props for a spec: the spec's own, with its bindings and action marked for OpenUI. */
function libraryProps(spec: PresentedSpec) {
  const shape: Record<string, z.ZodType> = { ...spec.props.shape };
  if (spec.bound) shape[spec.bound] = reactive(shape[spec.bound]!);
  if (spec.name === "Button") shape.action = action();
  if (shape.requires) shape.requires = z.array(z.any()).optional();
  if (spec.children) shape.children = z.array(z.any()).optional();
  return z.object(shape);
}

type Args = ComponentRenderProps<Record<string, unknown>>;

function viewProps(args: Args) {
  const { children, ...props } = args.props;
  const nodes = Array.isArray(children) ? children : [];
  return { ...props, nodes, children: nodes.length ? args.renderNode(nodes) : undefined };
}

function PlainInstance({ view: View, args }: { view: PresentedView; args: Args }) {
  return createElement(View, { ...viewProps(args), renderNode: args.renderNode });
}

function BoundInstance({
  view: View,
  bound,
  args,
}: {
  view: PresentedView;
  bound: string;
  args: Args;
}) {
  const field = useStateField(String(args.props.id), args.props[bound]);
  return createElement(View, {
    ...viewProps(args),
    [bound]: field.value,
    field: field as never,
    renderNode: args.renderNode,
  });
}

const components = presentedSpecs.map((spec) => {
  const view = presentedViewMap[spec.name];
  if (!view) throw new Error(`Presented component ${spec.name} has no view.`);
  return defineComponent({
    name: spec.name,
    description: spec.description,
    props: libraryProps(spec),
    component: (args) =>
      spec.bound ? (
        <BoundInstance view={view} bound={spec.bound} args={args} />
      ) : (
        <PlainInstance view={view} args={args} />
      ),
  });
});

const PresentedAnswer = defineComponent({
  name: "PresentedAnswer",
  description: "The visual answer for the current voice turn; holds the composed components.",
  props: z.object({
    title: z.string(),
    summary: z.string().nullable().optional(),
    children: z.array(z.any()).optional(),
  }),
  component: function PresentedAnswerView({ props, renderNode }) {
    const { version } = useContext(PresentedHostContext);
    return (
      <article
        className="grid min-w-0 gap-3 [overflow-wrap:anywhere]"
        data-voice-presented-version={version}
      >
        <div className="grid gap-1">
          <Heading as="h3" size="section">
            {props.title}
          </Heading>
          {props.summary && (
            <Text as="p" tone="secondary">
              {props.summary}
            </Text>
          )}
        </div>
        {props.children?.length ? renderNode(props.children) : null}
      </article>
    );
  },
});

const press = defineAction({
  name: PRESENTED_ACTION,
  description: "Run a registered application action with the fields as they are now.",
  params: z.object({ node: z.number(), button: z.any() }),
});

export const presentedLibrary = createLibrary({
  components: [PresentedAnswer, ...components],
  actions: [press],
  root: "PresentedAnswer",
});
