// Test-only peer for the real Native HostNotesFenceOwner integration fixture.
// The parent owns Native closure; this peer uses production Host admission only.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(specifier, context.parentURL);
      if (candidate.protocol === "file:" && !/\.[a-z]+$/i.test(candidate.pathname)) {
        const typed = new URL(`${candidate.href}.ts`);
        if (existsSync(fileURLToPath(typed))) return nextResolve(typed.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const note = (value) => ({
  id: value.id,
  body: value.body,
  updatedAt: value.updatedAt,
});

async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.length, 3, "Expected REPO_ROOT DATABASE_PATH ADDON_PATH");
  const [repository, database, artifact] = args;
  assert.ok(args.every(isAbsolute), "Fixture paths must be absolute");
  assert.ok(statSync(repository).isDirectory(), "Repository must exist");
  assert.ok(statSync(database).isFile(), "Native must create the actual database first");
  assert.ok(statSync(artifact).isFile(), "Supply the actual native artifact");
  const { AsyncHostNotes } = await import(
    pathToFileURL(join(repository, "host/host-notes-async.ts")).href
  );
  const host = new AsyncHostNotes(
    () => [database],
    pathToFileURL(join(repository, "host/host-notes-worker.mjs")),
    { admissionArtifact: artifact },
  );
  assert.equal(host.admissionStatus.mode, "joined", "Actual connection admission is required");

  let phase = "starting";
  let input;
  let originalsQueued = false;
  let firstChecks = 0;
  let originalFailure;
  let releaseAuthorization;
  const authorization = new Promise((resolve) => {
    releaseAuthorization = resolve;
  });
  const originals = [];
  const raw = (id, title, body) => ({
    id,
    title,
    body,
    tags: [],
    sourceCwd: repository,
  });
  const watch = (promise) => {
    originals.push(promise);
    void promise.catch((error) => {
      originalFailure ??= error;
      input?.close();
    });
    return promise;
  };

  try {
    const warm = await host.save(raw("original", "Original", "original"), 0, repository);
    assert.equal(warm.body, "original");
    phase = "queued";
    const first = watch(
      host.save({ ...warm, body: "first" }, warm.updatedAt, repository, async () => {
        firstChecks += 1;
        if (firstChecks === 1) return true;
        assert.equal(firstChecks, 2, "Only the original post-lock authorization may wait");
        assert.ok(originalsQueued, "Both actual jobs must acquire admission before acceptance");
        assert.equal(phase, "queued");
        phase = "accepted";
        emit({
          event: "accepted",
          originals: 2,
          firstId: "original",
          secondId: "second",
        });
        return authorization;
      }),
    );
    const second = watch(
      host.save(raw("second", "Second", "second"), 0, repository, () =>
        ["committing", "committed", "read", "reopened"].includes(phase),
      ),
    );
    originalsQueued = true;
    input = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    });

    for await (const line of input) {
      if (originalFailure) throw originalFailure;
      const command = JSON.parse(line);
      assert.ok(command && typeof command === "object" && !Array.isArray(command));
      assert.deepEqual(Object.keys(command), ["command"], "Only a command is accepted");
      assert.equal(typeof command.command, "string");
      switch (command.command) {
        case "try-new": {
          assert.ok(["accepted", "committed", "read"].includes(phase), "try-new out of order");
          let rejection;
          try {
            await host.save(raw("new", "Forbidden new", "must remain absent"), 0, repository);
          } catch (error) {
            rejection = error;
          }
          assert.equal(rejection?.code, "HOST_NOTES_ADMISSION_BUSY");
          emit({ event: "new-rejected", code: rejection.code, id: "new" });
          break;
        }
        case "commit": {
          assert.equal(phase, "accepted", "commit out of order");
          phase = "committing";
          releaseAuthorization(true);
          const [savedFirst, savedSecond] = await Promise.all([first, second]);
          assert.equal(savedFirst.body, "first");
          assert.equal(savedSecond.body, "second");
          // A real serial readonly job proves the rejected fresh request had no effect.
          assert.equal(await host.get("new", repository), null);
          phase = "committed";
          emit({
            event: "committed",
            first: note(savedFirst),
            second: note(savedSecond),
            newAbsent: true,
          });
          break;
        }
        case "read": {
          assert.ok(["committed", "read"].includes(phase), "read out of order");
          const value = await host.get("second", repository);
          assert.equal(value?.body, "second");
          phase = "read";
          emit({ event: "read", id: "second", body: value.body });
          break;
        }
        case "reopened": {
          assert.ok(["committed", "read"].includes(phase), "reopened out of order");
          const value = await host.save(
            raw("after", "After Native", "after native"),
            0,
            repository,
          );
          assert.equal(value.body, "after native");
          phase = "reopened";
          emit({ event: "reopened", ...note(value) });
          break;
        }
        case "exit":
          assert.ok(["committed", "read", "reopened"].includes(phase), "exit out of order");
          await host.close();
          phase = "closed";
          emit({ event: "closed" });
          input.close();
          break;
        default:
          throw new Error("Unknown fixture command");
      }
      if (phase === "closed") break;
    }
    if (phase !== "closed") throw originalFailure ?? new Error("Input ended before exit");
  } catch (error) {
    phase = "failed";
    releaseAuthorization(false);
    input?.close();
    await Promise.allSettled(originals);
    await host.close();
    throw error;
  } finally {
    input?.close();
  }
}

try {
  await main();
} catch (error) {
  emit({
    event: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
