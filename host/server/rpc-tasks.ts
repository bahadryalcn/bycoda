import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleTasksRpc(
  dependencies: Pick<
    ServerBindings,
    "automationsService" | "sprintsService" | "tasksService" | "goalsService" | "stewardsService"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "automations.list":
      request.result = await dependencies.automationsService.list(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "automations.preview":
      request.result = await dependencies.automationsService.preview(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;

    case "automations.save":
      request.result = await dependencies.automationsService.save(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "automations.delete":
      request.result = await dependencies.automationsService.delete(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "automations.runs":
      request.result = await dependencies.automationsService.runs(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "automations.runNow":
      request.result = await dependencies.automationsService.runNow(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    // These cross-project planning routes belong only to paired owner
    // dispatch. Project-scoped conversation tools have their own allowlist.
    case "sprints.list":
      request.result = await dependencies.sprintsService.list(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.get":
      request.result = await dependencies.sprintsService.get(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.create":
      request.result = await dependencies.sprintsService.create(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.update":
      request.result = await dependencies.sprintsService.update(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.start":
      request.result = await dependencies.sprintsService.start(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.complete":
      request.result = await dependencies.sprintsService.complete(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.archive":
      request.result = await dependencies.sprintsService.archive(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.plan":
      request.result = await dependencies.sprintsService.plan(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.report":
      request.result = await dependencies.sprintsService.report(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.ingest":
      request.result = await dependencies.sprintsService.ingest(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "sprints.goalContext":
      request.result = await dependencies.sprintsService.setGoalContext(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;

    case "tasks.snapshotWithCursor":
      request.result = await dependencies.tasksService.snapshotWithCursor(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;

    case "tasks.events":
      request.result = await dependencies.tasksService.events(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.list":
      request.result = await dependencies.tasksService.list(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "tasks.save":
      request.result = await dependencies.tasksService.save(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "tasks.move":
      request.result = await dependencies.tasksService.move(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "tasks.start":
      request.result = await dependencies.tasksService.start(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.reorder":
      request.result = await dependencies.tasksService.reorder(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.retarget":
      request.result = await dependencies.tasksService.retarget(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.review.recheck":
      request.result = await dependencies.tasksService.recheckReview(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;

    case "tasks.notes.read":
      request.result = await dependencies.tasksService.readNotes(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.notes.resolve":
      request.result = await dependencies.tasksService.resolveNote(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.delete":
      request.result = await dependencies.tasksService.delete(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "goals.list":
      request.result = await dependencies.goalsService.list(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "goals.create":
      request.result = await dependencies.goalsService.create(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "goals.final-review.recheck":
      request.result = await dependencies.goalsService.recheckFinalReview(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;

    case "tasks.preflight":
      request.result = await dependencies.tasksService.preflight(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "tasks.evaluation.save":
      request.result = await dependencies.tasksService.recordEvaluation(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;

    case "goals.approve":
      request.result = await dependencies.goalsService.approve(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "goals.update":
      request.result = await dependencies.goalsService.update(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "goals.replan":
      request.result = await dependencies.goalsService.replan(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "goals.cancel":
      request.result = await dependencies.goalsService.cancel(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "goals.delete":
      request.result = await dependencies.goalsService.delete(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "stewards.list":
      request.result = await dependencies.stewardsService.list(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "stewards.save":
      request.result = await dependencies.stewardsService.save(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "stewards.delete":
      request.result = await dependencies.stewardsService.delete(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "stewards.runNow":
      request.result = await dependencies.stewardsService.runNow(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "stewards.decline":
      request.result = await dependencies.stewardsService.decline(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;
  }
}
