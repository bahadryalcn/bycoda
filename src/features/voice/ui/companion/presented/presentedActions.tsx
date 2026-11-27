import { useTriggerAction, type ActionPlan } from "@openuidev/react-lang";
import { useContext } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { OutputBlock } from "../../../../../shared/ui/OutputBlock";
import { StatusText } from "../../../../../shared/ui/StatusText";
import {
  parsePresentedPress,
  type VoicePresentedActionResponse,
} from "../../../model/voicePresentedActions";
import {
  PresentedHostContext,
  presentedView,
  type PresentedPress,
  type PresentedView,
} from "./presentedContext";

const statusTone = {
  accepted: "running",
  queued: "running",
  running: "running",
  pending: "needs-you",
  completed: "done",
  returned: "done",
} as const satisfies Record<VoicePresentedActionResponse["status"], string>;

/** A field with no value (unset, cleared, empty text or an empty list) cannot satisfy `requires`. */
export const presentedValueMissing = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

/** The press the program describes: the pressed node and the descriptor with fields already read. */
export function presentedPressParams(action: unknown) {
  const step = (action as ActionPlan | undefined)?.steps?.[0] as
    | { type?: string; params?: { node?: unknown; button?: unknown } }
    | undefined;
  const node = step?.params?.node;
  return typeof node === "number" ? { node, button: step?.params?.button } : undefined;
}

function PressFeedback({ press }: { press: PresentedPress }) {
  const t = useT();
  if (press.state === "pending") return null;
  if (press.state === "failed") {
    return (
      <InlineError details={press.detail}>
        {press.reason === "incomplete"
          ? t("This action is incomplete.")
          : press.reason === "view-changed"
            ? t("This view changed. Ask for it again.")
            : t("Could not run this action.")}
      </InlineError>
    );
  }
  const label: Record<VoicePresentedActionResponse["status"], string> = {
    accepted: t("Accepted"),
    queued: t("Queued"),
    running: t("Running"),
    pending: t("Pending"),
    completed: t("Completed"),
    returned: t("Result"),
  };
  const status = press.response?.status ?? "completed";
  return (
    <div className="grid min-w-0 gap-1.5">
      <StatusText tone={statusTone[status]}>{label[status]}</StatusText>
      {press.response?.preview && (
        <OutputBlock frame="filled" size="secondary" scroll className="max-h-48 p-2">
          {press.response.preview}
        </OutputBlock>
      )}
    </div>
  );
}

/** Runs one registered action. The press goes to the view's owner, which re-checks it at the app. */
export const presentedActionViews: Record<string, PresentedView> = {
  Button: presentedView<{
    label: string;
    variant?: "primary" | "secondary" | "ghost";
    action: unknown;
    requires?: unknown[];
  }>(function ButtonView({ label, variant = "secondary", action, requires }) {
    const t = useT();
    const trigger = useTriggerAction();
    const host = useContext(PresentedHostContext);
    const params = presentedPressParams(action);
    const press = params ? host.feedback.get(params.node) : undefined;
    const current = press?.signature === JSON.stringify(params?.button);
    const pending = press?.state === "pending" && current;
    const missing = (requires ?? []).some(presentedValueMissing);
    const disabledReason = !host.canPress
      ? t("This view cannot run actions.")
      : missing
        ? t("Fill in the required fields first.")
        : !params || !parsePresentedPress(params.button).success
          ? t("This action is incomplete.")
          : undefined;
    return (
      <div className="grid min-w-0 content-start gap-1.5">
        <div>
          <Button
            variant={variant}
            size="sm"
            loading={pending}
            disabled={!!disabledReason}
            disabledReason={disabledReason}
            onClick={() => void trigger(label, undefined, action as ActionPlan)}
          >
            {label}
          </Button>
        </div>
        {press && current && <PressFeedback press={press} />}
      </div>
    );
  }),
};
