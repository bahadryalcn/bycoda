# Repository hygiene

Follow the root [`.artifact` policy](../../.artifact) for file placement, task output
directories, and archive handling. `AGENTS.md` requires agents to read it before
creating or moving files.

Source, tests, build scripts, current product documentation and licenses belong in Git. Local agent scratch work, machine-specific
deployment reports, research exports, development plans, visual previews, benchmark results, validation captures and Python bytecode
remain on the developer's machine and are excluded by `.gitignore`.

Retain useful development material in the ignored `temp/archive/` directory.
Use `temp/local/` for machine-specific scratch files and `temp/history/` for
history recovery material. These files must not be required to build or run the
application. See [repository layout](repository-layout.md) for maintained locations.

Repository documentation is maintained in English. Keep application translation
catalogs in their target languages; they are product source, not documentation.
Local session databases, SQLite sidecar files, and backups are also excluded
because they can contain private conversations or credentials. Do not force-add
these files to bypass the ignore rules.

Run `node scripts/checks/check-repository-hygiene.mjs` before committing. CI runs the
same check without installing dependencies. It detects tracked files matching
ignore rules, including files added with `git add -f`. It checks paths only;
it does not replace a secret scanner or inspect earlier commits.

When removing already tracked local files, use `git rm --cached -- <path>`.
This stages their removal from the repository while preserving the local copy.
Review `git diff --cached --stat` before committing. A later ordinary commit
removes these files from the current tree, but earlier commits still contain them.

## Cleaning earlier commits

Decide whether the goal is file removal or commit consolidation before rewriting
history. Preserve the upstream author's history and attribution by default.
Cosmetic commit titles alone do not require a rewrite.

1. Pause writers, inventory remote branches/tags and check for open pull requests.
2. Back up all local refs, uncommitted work and the affected remote refs outside
   the repository. Work on a disposable clone, not the active development checkout.
3. Use `git-filter-repo` with an explicit reviewed list of paths and refs. Remove
   historical spellings too if files were renamed. Do not filter source, tests,
   product assets or upstream attribution as part of scratch-file cleanup.
4. Verify the resulting tree and focused checks, and review the commit/ref mapping.
5. Obtain explicit approval before replacing remote history. Update only reviewed
   branches with an explicit expected old SHA (`--force-with-lease`); handle tags
   separately. Do not use a blanket mirror force-push.
6. Coordinate other checkouts so they cannot merge the old history back in.

If a live credential is discovered, revoke or rotate it first. Rewriting Git
history cannot remove copies in other clones, forks or GitHub cached references.
See [GitHub's sensitive data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
