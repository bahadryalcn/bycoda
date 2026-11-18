import { useState } from "react";
import { useT } from "../../../shared/i18n";
import {
  LiveGamesConfigPatchSchema,
  LiveGamesRulesSchema,
} from "../../../shared/model/host-contracts/live-games";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Divider } from "../../../shared/ui/Divider";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { NumberField } from "../../../shared/ui/NumberField";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { Plus, Trash2 } from "../../../shared/ui/icons";
import type { LiveGamesFeedback } from "../hooks/useLiveGames";
import {
  HALAY_ACTIONS,
  type HalayAction,
  type HalayConfig,
  type HalayGiftRule,
} from "../model/halayGame";
import { liveGamesRequest } from "../model/liveGamesClient";

type ConfigPatch = Partial<
  Omit<HalayConfig, "giftRules" | "capacity" | "leaderHoldSeconds" | "frontHoldSeconds">
> & {
  capacity?: string;
  leaderHoldSeconds?: string;
  frontHoldSeconds?: string;
};
const numericConfig = ["capacity", "leaderHoldSeconds", "frontHoldSeconds"] as const;

export function HalayControls({
  config,
  feedback,
}: {
  config: HalayConfig;
  feedback: LiveGamesFeedback;
}) {
  const t = useT();
  const [patch, setPatch] = useState<ConfigPatch>({});
  const [invalid, setInvalid] = useState(false);
  const edit = <K extends keyof ConfigPatch>(field: K, value: ConfigPatch[K]) => {
    setPatch((previous) => ({ ...previous, [field]: value }));
    setInvalid(false);
    feedback.clear();
  };
  const save = () => {
    const { capacity, leaderHoldSeconds, frontHoldSeconds, ...rest } = patch;
    const numeric = { capacity, leaderHoldSeconds, frontHoldSeconds };
    const input = LiveGamesConfigPatchSchema.safeParse({
      ...rest,
      ...Object.fromEntries(
        numericConfig.flatMap((field) => {
          const value = numeric[field];
          return value === undefined ? [] : [[field, value.trim() ? Number(value) : Number.NaN]];
        }),
      ),
    });
    if (!input.success) {
      setInvalid(true);
      return;
    }
    feedback.run({
      action: "config",
      request: () => liveGamesRequest("liveGames.setConfig", { patch: input.data }),
      applied: () => setPatch({}),
    });
  };
  const busy = feedback.pending("config");
  const dirty = Object.keys(patch).length > 0;
  const error = feedback.error("config");
  return (
    <Disclosure summary={t("Joining and privacy")} variant="row" defaultOpen>
      <form
        className="flex flex-col gap-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !feedback.busy) save();
        }}
      >
        <TagInput
          label={t("Join keywords")}
          value={patch.joinKeywords ?? config.joinKeywords}
          onValueChange={(value) => edit("joinKeywords", value)}
          maxTags={32}
          inputProps={{ maxLength: 40, disabled: busy }}
        />
        <TagInput
          label={t("Blocked handles")}
          value={patch.blocked ?? config.blocked}
          onValueChange={(value) => edit("blocked", value)}
          maxTags={500}
          inputProps={{ maxLength: 64, disabled: busy }}
        />
        <div className="grid gap-2 @min-[470px]:grid-cols-3">
          <NumberField
            label={t("Capacity")}
            min={1}
            max={120}
            value={patch.capacity ?? config.capacity}
            onChange={(event) => edit("capacity", event.target.value)}
            disabled={busy}
          />
          <NumberField
            label={t("Lead time (sec)")}
            min={0}
            max={3600}
            value={patch.leaderHoldSeconds ?? config.leaderHoldSeconds}
            onChange={(event) => edit("leaderHoldSeconds", event.target.value)}
            disabled={busy}
            steppers={false}
          />
          <NumberField
            label={t("Front time (sec)")}
            min={0}
            max={3600}
            value={patch.frontHoldSeconds ?? config.frontHoldSeconds}
            onChange={(event) => edit("frontHoldSeconds", event.target.value)}
            disabled={busy}
            steppers={false}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Checkbox
            label={t("Short names")}
            checked={patch.shortNames ?? config.shortNames}
            onChange={(event) => edit("shortNames", event.target.checked)}
            disabled={busy}
          />
          <Checkbox
            label={t("Join on any comment")}
            checked={patch.joinOnAnyComment ?? config.joinOnAnyComment}
            onChange={(event) => edit("joinOnAnyComment", event.target.checked)}
            disabled={busy}
          />
          <Checkbox
            label={t("Join on like")}
            checked={patch.joinOnLike ?? config.joinOnLike}
            onChange={(event) => edit("joinOnLike", event.target.checked)}
            disabled={busy}
          />
          <Checkbox
            label={t("Join on follow")}
            checked={patch.joinOnFollow ?? config.joinOnFollow}
            onChange={(event) => edit("joinOnFollow", event.target.checked)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="submit"
            loading={busy}
            disabled={feedback.busy || !dirty}
            success={feedback.succeeded("config")}
            successLabel={t("Saved")}
          >
            {t("Save settings")}
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPatch({});
                setInvalid(false);
                feedback.clear();
              }}
            >
              {t("Discard changes")}
            </Button>
          ) : null}
        </div>
        {invalid || error ? (
          <InlineError details={error}>{t("Could not save game settings")}</InlineError>
        ) : null}
      </form>
    </Disclosure>
  );
}

const actionLabel: Record<HalayAction, string> = {
  join: "Join the dance",
  front: "Move to front",
  leader: "Lead the dance",
  tempo: "Increase tempo",
  confetti: "Confetti",
  drum: "Drum",
  fireworks: "Fireworks",
  "money-rain": "Money rain",
  handkerchief: "Handkerchief",
};
type DraftRule = Omit<HalayGiftRule, "minDiamonds"> & { id: string; minDiamonds: string };

export function HalayRules({
  rules,
  feedback,
}: {
  rules: HalayGiftRule[];
  feedback: LiveGamesFeedback;
}) {
  const t = useT();
  const [draft, setDraft] = useState<DraftRule[]>();
  const [invalid, setInvalid] = useState(false);
  const rows =
    draft ??
    rules.map((rule, index) => ({
      ...rule,
      id: String(index),
      minDiamonds: String(rule.minDiamonds),
    }));
  const busy = feedback.pending("rules");
  const change = (next: DraftRule[]) => {
    setDraft(next);
    setInvalid(false);
    feedback.clear();
  };
  const edit = (id: string, patch: Partial<DraftRule>) =>
    change(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const save = () => {
    const input = LiveGamesRulesSchema.safeParse(
      rows.map(({ minDiamonds, giftName, actions }) => ({
        minDiamonds: minDiamonds.trim() ? Number(minDiamonds) : giftName?.trim() ? 0 : Number.NaN,
        giftName: giftName?.trim() || undefined,
        actions,
      })),
    );
    if (!input.success) {
      setInvalid(true);
      return;
    }
    feedback.run({
      action: "rules",
      request: () => liveGamesRequest("liveGames.setRules", { rules: input.data }),
      applied: () => setDraft(undefined),
    });
  };
  const error = feedback.error("rules");
  return (
    <Disclosure summary={t("Gift rules")} count={rows.length} variant="row">
      <form
        className="flex flex-col gap-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft && !feedback.busy) save();
        }}
      >
        {rows.length === 0 ? (
          <EmptyState size="inline" context="list" title={t("No gift rules")} />
        ) : null}
        {rows.map((row, index) => (
          <div className="flex flex-col gap-2" key={row.id}>
            {index ? <Divider /> : null}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <TextField
                label={t("Gift name")}
                value={row.giftName ?? ""}
                placeholder={t("Any gift")}
                onChange={(event) => edit(row.id, { giftName: event.target.value })}
                maxLength={60}
                disabled={busy}
              />
              <NumberField
                label={t("Minimum diamonds")}
                value={row.minDiamonds}
                onChange={(event) => edit(row.id, { minDiamonds: event.target.value })}
                min={0}
                max={100_000_000}
                disabled={busy}
                steppers={false}
              />
              <Button
                variant="ghost"
                iconOnly
                label={t("Remove rule")}
                disabled={busy}
                onClick={() => change(rows.filter((item) => item.id !== row.id))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {HALAY_ACTIONS.map((action) => (
                <Checkbox
                  key={action}
                  label={t(actionLabel[action])}
                  disabled={busy}
                  checked={row.actions.includes(action)}
                  onChange={(event) =>
                    edit(row.id, {
                      actions: event.target.checked
                        ? [...row.actions, action]
                        : row.actions.filter((item) => item !== action),
                    })
                  }
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            startIcon={<Plus />}
            disabled={busy || rows.length >= 100}
            onClick={() =>
              change([...rows, { id: crypto.randomUUID(), minDiamonds: "", actions: ["confetti"] }])
            }
          >
            {t("Add rule")}
          </Button>
          <Button
            variant="secondary"
            type="submit"
            loading={busy}
            disabled={feedback.busy || !draft}
            success={feedback.succeeded("rules")}
            successLabel={t("Saved")}
          >
            {t("Save rules")}
          </Button>
          {draft ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(undefined);
                setInvalid(false);
                feedback.clear();
              }}
            >
              {t("Discard changes")}
            </Button>
          ) : null}
        </div>
        {invalid || error ? (
          <InlineError details={error}>{t("Could not save gift rules")}</InlineError>
        ) : null}
      </form>
    </Disclosure>
  );
}
