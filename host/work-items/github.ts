import { stat } from "node:fs/promises";
import {
  workItemGetParams,
  workItemSearchParams,
  workItemNumber,
  workItemRow,
  type WorkItemResult,
} from "../../src/shared/model/host-contracts/work-items";
import type { GhRuntime } from "../git/gh-runtime";
import { createLogger } from "../diagnostics/logger";
import { assertDomainAuthority } from "../domains/context";
import type { ServerBindings } from "../server/bindings";
import type { OwnerRpcRequest } from "../server/owner-rpc-context";

const fields = "number,title,url,state,updatedAt";
function itemRow(row: Record<string, unknown>, repo: string, kind: "issue" | "pr") {
  const { number, title, url, state, updatedAt, body, isDraft } = row;
  return workItemRow.parse({
    number,
    title,
    url,
    state,
    updatedAt,
    body,
    draft: isDraft ?? false,
    repo,
    kind,
  });
}
const repoPattern = /^[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d_.-]{1,100}$/i;
type ProjectLookup = (id: string) => Promise<{ cwd: string }>;
const log = createLogger("host.work-items");
const repositories = new WeakMap<object, Map<string, { name: string; expiresAt: number }>>();
const repositoryTtlMs = 5 * 60_000;

async function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function failure(error: unknown): WorkItemResult["errors"][number] {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|CLI is still being installed|no GitHub CLI|CLI is not published/i.test(message))
    return { reason: "missing-tool", message: "GitHub CLI is unavailable on the project Host." };
  if (/rate limit|HTTP 429/i.test(message)) {
    const seconds = /retry-after:\s*(\d+)/i.exec(message);
    const reset = /x-ratelimit-reset:\s*(\d+)/i.exec(message);
    const at = seconds ? Date.now() + Number(seconds[1]) * 1_000 : Number(reset?.[1]) * 1_000;
    return {
      reason: "rate-limited",
      message: "GitHub rate limit reached on the project Host.",
      ...(Number.isSafeInteger(at) && at >= 0 ? { retryAt: at } : {}),
    };
  }
  if (
    /gh auth login|GitHub is not signed in|HTTP 401|bad credentials|authentication required/i.test(
      message,
    )
  )
    return { reason: "unauthenticated", message: "Sign in to GitHub CLI on the project Host." };
  if (
    /HTTP 404|could not resolve|no git remotes|not a git repository|not registered|not found/i.test(
      message,
    )
  )
    return { reason: "not-found", message: "GitHub repository or work item was not found." };
  return { reason: "failed", message: "GitHub work item lookup failed on the project Host." };
}

export async function readGithubWorkItems(
  project: ProjectLookup,
  gh: Pick<GhRuntime, "run">,
  method: string,
  params: unknown,
  requestSignal?: AbortSignal,
): Promise<WorkItemResult> {
  const request =
    method === "workItems.get"
      ? workItemGetParams.parse(params)
      : workItemSearchParams.parse(params);
  if (
    "query" in request &&
    [...request.query].some((character) => character < " " || character.charCodeAt(0) === 127)
  )
    throw new Error("Invalid GitHub work item query");
  const result: WorkItemResult = { items: [], errors: [] };
  const deadline = AbortSignal.timeout(5_900);
  const signal = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
  let cache = repositories.get(gh);
  if (!cache) repositories.set(gh, (cache = new Map()));
  let cwd: string | undefined;
  async function recordFailure(error: unknown) {
    const missingCwd =
      cwd &&
      /ENOENT|ENOTDIR/i.test(String(error)) &&
      !signal.aborted &&
      !(await withAbort(stat(cwd), signal).then(
        (entry) => entry.isDirectory(),
        (cause: NodeJS.ErrnoException) => !["ENOENT", "ENOTDIR"].includes(cause.code ?? ""),
      ));
    const entry: WorkItemResult["errors"][number] = missingCwd
      ? { reason: "not-found", message: "Project folder was not found on the project Host." }
      : failure(error);
    result.errors.push(entry);
    log.warn("GitHub work item read failed", { method, reason: entry.reason });
  }
  try {
    signal.throwIfAborted();
    const projectCwd = (await withAbort(project(request.projectId), signal)).cwd;
    cwd = projectCwd;
    const run = async (args: string[], budget = 3_500) => {
      const commandSignal = AbortSignal.any([signal, AbortSignal.timeout(budget)]);
      commandSignal.throwIfAborted();
      return JSON.parse(
        await withAbort(
          gh.run(projectCwd, args, {
            timeoutMs: budget,
            allowInstall: false,
            signal: commandSignal,
          }),
          commandSignal,
        ),
      );
    };
    const cached = cache.get(cwd);
    let name = cached && cached.expiresAt > Date.now() ? cached.name : undefined;
    if (!name) {
      const repo = await run(["repo", "view", "--json", "nameWithOwner,url"], 2_300);
      if (
        typeof repo.nameWithOwner !== "string" ||
        !repoPattern.test(repo.nameWithOwner) ||
        repo.url?.toLowerCase() !== `https://github.com/${repo.nameWithOwner.toLowerCase()}`
      )
        throw new Error("GitHub repository not found");
      name = String(repo.nameWithOwner);
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(cwd, { name, expiresAt: Date.now() + repositoryTtlMs });
    }
    const repository = name;
    const query = "query" in request ? request.query.trim() : "";
    const ref = /^(?:(.+)[#!]|#?)(\d+)$/.exec(query);
    if (ref?.[1] && ref[1].toLowerCase() !== name.toLowerCase()) return result;
    const number = "number" in request ? request.number : Number(ref?.[2]);
    const kinds = "kind" in request && request.kind ? [request.kind] : (["issue", "pr"] as const);
    const reads: Promise<WorkItemResult["items"]>[] = [];
    if ("query" in request) {
      const search = (ref?.[2] ?? query)
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => JSON.stringify(word))
        .join(" ");
      for (const kind of kinds) {
        reads.push(
          run([
            kind,
            "list",
            "--repo",
            name,
            "--state",
            "open",
            "--limit",
            "20",
            "--json",
            kind === "pr" ? `${fields},isDraft` : fields,
            ...(search ? [`--search=${search}`] : []),
          ]).then((rows) =>
            rows.map((row: Record<string, unknown>) => itemRow(row, repository, kind)),
          ),
        );
      }
    }
    if (workItemNumber.safeParse(number).success) {
      reads.push(readNumbers(run, name, number, "number" in request, kinds));
    }
    for (const outcome of await Promise.allSettled(reads)) {
      if (outcome.status === "fulfilled") result.items.push(...outcome.value);
      else await recordFailure(outcome.reason);
    }
    if ("number" in request && !result.items.length && !result.errors.length)
      await recordFailure(new Error("Work item not found"));
    result.items = [...new Map(result.items.map((item) => [item.number, item])).values()];
    const exact = result.items.findIndex((item) => item.number === number);
    if (exact > 0) result.items.unshift(...result.items.splice(exact, 1));
  } catch (error) {
    await recordFailure(error);
  }
  if (cwd && result.errors.length) cache.delete(cwd);
  return result;
}

async function readNumbers(
  run: (args: string[]) => Promise<unknown>,
  repo: string,
  number: number,
  exact: boolean,
  kinds: readonly ("issue" | "pr")[],
): Promise<WorkItemResult["items"]> {
  const numbers = [number];
  if (!exact) {
    for (let width = 10; numbers.length < 100 && number * width <= 2_147_483_647; width *= 10) {
      for (let offset = 0; offset < width && numbers.length < 100; offset++) {
        const candidate = number * width + offset;
        if (candidate > 2_147_483_647) break;
        numbers.push(candidate);
      }
    }
  }
  const [owner, name] = repo.split("/");
  const selected = fields.replaceAll(",", " ") + (exact ? " body" : "");
  const aliases = numbers.map(
    (n) =>
      `n${n}:issueOrPullRequest(number:${n}){... on Issue{${selected}} ... on PullRequest{${selected} isDraft}}`,
  );
  const query = `query{repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){${aliases.join(" ")}}}`;
  type Response = { data?: { repository?: Record<string, Record<string, unknown> | null> } };
  let response: Response;
  try {
    response = (await run([
      "api",
      "graphql",
      "--hostname",
      "github.com",
      "-f",
      `query=${query}`,
    ])) as Response;
  } catch (error) {
    // GitHub reports absent aliases as GraphQL errors alongside successful rows.
    const stdout = (error as { stdout?: string })?.stdout;
    if (!stdout) throw error;
    const partial = JSON.parse(stdout) as Response & { errors?: { type?: string }[] };
    if (!partial.data?.repository || !partial.errors?.every((entry) => entry.type === "NOT_FOUND"))
      throw error;
    response = partial;
  }
  if (!response.data?.repository) throw new Error("GitHub repository not found");
  return Object.values(response.data.repository).flatMap((row) => {
    if (!row) return [];
    const kind = typeof row.isDraft === "boolean" ? "pr" : "issue";
    return kinds.includes(kind) ? [itemRow(row, repo, kind)] : [];
  });
}

export async function handleGithubWorkItemsRpc(
  { engine, workspace }: Pick<ServerBindings, "engine" | "workspace">,
  request: OwnerRpcRequest,
): Promise<void> {
  const { store } = engine;
  const deadline = AbortSignal.timeout(5_900);
  const ownerSignal = request.domainContext.signal;
  const signal = ownerSignal ? AbortSignal.any([ownerSignal, deadline]) : deadline;
  await withAbort(assertDomainAuthority(request.domainContext), signal);
  request.result = await readGithubWorkItems(
    (id) => store.project(id),
    workspace.gh,
    String(request.input.method),
    request.params,
    signal,
  );
}
