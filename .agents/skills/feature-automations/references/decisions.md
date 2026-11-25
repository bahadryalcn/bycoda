# Automation decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Automations are simplified like Tasks

Owner decision, 2026-11-23, Crews, Automations and Voice simplification, source: owner chat (translated):

> We did Tasks. Let's also do Crews and simplify them, Automation and the voice assistant too. You need to edit every setting, every dialog, settings etc. I do not want anything unnecessary.

Recorded decision: creating and editing an automation is one editor page. The name is optional and derived from the instructions. Whether it runs in the app or in the background is chosen automatically from the project, trigger and template; the owner keeps one explicit choice only where both are possible. A background automation holds exactly one time trigger or one Host event.
## Recipes live under Automations

On 2026-11-25 the owner approved the task-execution plan with: "olur hepsini yap".

Reusable recipes (the equivalent of T3 Code Workflows) are automations whose body is an ordered list of steps; there is no Workflows menu and no second scheduler. First scope: manual run and schedule, sequential task steps and owner-decision steps. Event triggers are a later extension.

- A recipe is `HostAutomation.recipe` (`version`, `steps`); a task step is created through `createWork`, a decision step pauses the occurrence until the owner approves or declines.
- An occurrence is an ordinary automation run whose `recipe` instance copies the steps and run settings it started with, so editing a recipe (a new version) never changes a running occurrence.
- Each step result is saved in the transaction that creates its task. A saved step is never started again; a step whose task cannot be read stops the occurrence with `step_uncertain` and is not repeated.
