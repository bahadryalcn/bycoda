import type { Sequence } from "../../../src/features/social/model/outreach";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { pageInput } from "./outreach-input";
import { readStats, type OutreachStatMetric } from "./outreach-pacing";
import {
  enrollMembers,
  parseSequence,
  recordStart,
  requireEmailStepAccount,
} from "./outreach-sequences";

async function requireSequence(ctx: SocialActionContext, id: string): Promise<Sequence> {
  const sequence = await ctx.store.getRecord("sequence", id);
  if (!sequence) throw new Error("Sequence not found.");
  return sequence;
}

/** Every sequence, page by page. Used for the overview totals only. */
async function allSequences(ctx: SocialActionContext): Promise<Sequence[]> {
  const all: Sequence[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.store.listRecords("sequence", { cursor, limit: 200 });
    all.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return all;
}

export const sequenceActions: SocialActionModule = {
  "sequences.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["cursor", "limit"]);
      return await ctx.store.listRecords("sequence", pageInput(input));
    },
  },
  "sequences.save": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["id", "name", "listId", "steps", "pacing", "status"]);
      const existing =
        input.id === undefined
          ? undefined
          : await requireSequence(ctx, str(input.id, "sequence", 200));
      const sequence = await parseSequence(input, {
        store: ctx.store,
        service: ctx.service,
        principal: ctx.principal,
        now: ctx.now(),
        ...(existing ? { existing } : {}),
      });
      return await ctx.store.putRecord("sequence", sequence.id, sequence);
    },
  },
  "sequences.start": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["sequenceId"]);
      const sequence = await requireSequence(ctx, str(input.sequenceId, "sequence", 200));
      if (sequence.status === "active") return { sequence, enrolled: 0 };
      if (sequence.status === "done") throw new Error("This sequence is finished.");
      const list = await ctx.store.getList(sequence.listId);
      if (!list) throw new Error("Audience list not found.");
      if (!list.projectIds.length)
        throw new Error("Assign the audience list to a project before starting outreach.");
      // Older email accounts may lack an unsubscribe link; such a sequence never starts.
      for (const step of sequence.steps)
        if (step.channel === "email") await requireEmailStepAccount(ctx.store, step.accountId);
      if (ctx.principal.kind !== "owner") {
        // A non-owner starts sends only inside its own project, and only when outreach is autonomous.
        if (!ctx.principal.projectId || !list.projectIds.includes(ctx.principal.projectId))
          throw new Error("This project does not own the audience list.");
        const accountIds = new Set(
          sequence.steps.map((step) => step.accountId).filter((id): id is string => Boolean(id)),
        );
        for (const accountId of accountIds) {
          const decision = await ctx.service.authorizeAutonomous({
            accountId,
            action: "outreach",
            principal: ctx.principal,
          });
          if (decision.mode !== "autonomous")
            throw new Error(
              "Outreach must be set to autonomous for every account in this sequence.",
            );
        }
      }
      const now = ctx.now();
      const enrolled = await enrollMembers({ store: ctx.store, now }, sequence, list);
      await recordStart(ctx.store, sequence.id, now);
      const active: Sequence = { ...sequence, status: "active" };
      await ctx.store.putRecord("sequence", active.id, active);
      return { sequence: active, enrolled };
    },
  },
  "sequences.pause": {
    readOnly: false,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["sequenceId"]);
      const sequence = await requireSequence(ctx, str(input.sequenceId, "sequence", 200));
      if (sequence.status !== "active") return sequence;
      return await ctx.store.putRecord("sequence", sequence.id, { ...sequence, status: "paused" });
    },
  },
  "sequences.stats": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["sequenceId"]);
      if (input.sequenceId !== undefined) {
        const sequence = await requireSequence(ctx, str(input.sequenceId, "sequence", 200));
        return { sequenceId: sequence.id, ...(await readStats(ctx.store, sequence.id)) };
      }
      const totals: Record<OutreachStatMetric, number> = {
        sent: 0,
        replied: 0,
        positive: 0,
        optedOut: 0,
        failed: 0,
      };
      for (const sequence of await allSequences(ctx)) {
        const stats = await readStats(ctx.store, sequence.id);
        for (const metric of Object.keys(totals) as OutreachStatMetric[])
          totals[metric] += stats[metric];
      }
      return totals;
    },
  },
  "enrollments.list": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: async (ctx, input) => {
      exact(input, ["sequenceId", "cursor", "limit"]);
      const sequenceId = str(input.sequenceId, "sequence", 200);
      return await ctx.store.listEnrollments({ sequenceId, ...pageInput(input) });
    },
  },
};
