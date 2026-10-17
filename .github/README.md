# Continuous integration

`CI` runs on pull requests and pushes to `main`. Use `workflow_dispatch` for a
full run on another branch. New commits cancel an older CI run for the same PR or
branch. Release runs use a separate concurrency group and are not cancelled.

| Check                                               | Pull requests                                                                                   | Main / manual                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| Repository hygiene                                  | Always                                                                                          | Always                              |
| Web tests, TypeScript and Vite production build     | Web/host sources, tests, assets, shared configuration or tooling                                | Always, on Linux                    |
| Host tests and package smoke check                  | Web/host sources, tests, assets, shared configuration or tooling                                | Always, on Linux, macOS and Windows |
| Rust format, Clippy and tests                       | Native sources/configuration, Cargo files, embedded host files, shared configuration or tooling | Always, on Linux, macOS and Windows |
| Fedora / AlmaLinux RPM build and clean installation | Same scope as Rust                                                                              | Always                              |

The filters live in `workflows/ci.yml`. Host checks deliberately include all of
`src/`: the host imports application models and shared code. Rust filters include
the host ACL script and parity fixtures embedded with `include_str!`. Update the
filters when adding inputs outside these directories. Documentation-only PRs
still produce the hygiene and change-detection checks; other jobs are skipped at
job level, so the workflow itself is not left pending by a path trigger filter.

Web checks run once instead of repeating in the native OS matrix. Rust jobs do
not install frontend dependencies, and Clippy already provides the type checking
previously repeated by `cargo check`. Host tests build/typecheck through their
`pretest:host` hook; packaging reuses that output.

Cargo dependency caches are separate for native checks, each RPM distribution,
and release builds. PRs restore native/RPM caches but only `main` writes them.
Release builds keep their own cache and still produce signed packages only on
version tags. No CI filter grants publishing authority.

Main and manual runs intentionally ignore change filters: they retain full
coverage and warm caches even if an earlier push was cancelled. A cold cache or
Rust toolchain/dependency change can still require a full compile. Confirm timing
improvements from GitHub runs after merging; local workflow validation does not
measure hosted runner performance.
