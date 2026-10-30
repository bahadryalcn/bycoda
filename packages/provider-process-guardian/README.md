# Provider process guardian

Private Rust library and executable for original provider process ownership.
The library is `bycoda_provider_process_guardian`; the private executable is
`bycoda-provider-guardian`.
The package has no JavaScript exports. The desktop and guardian use the same
Windows job implementation; the desktop module is only a private re-export.

`windows_job::OwnedProcessJob` creates a dedicated kill-on-close job, enrolls a
child while suspended, observes its original members and retains their kernel
handles through termination and drain. `as_handle()` borrows the job handle;
the API does not accept raw handles or transfer ownership to callers.
The shared `create_job` and `resume_child` helpers also serve the desktop's
existing managed-child path. Resume still uses the original suspended child's
thread snapshot; this extraction adds no process/thread-handle-from-birth proof.

Actual Windows API failures remain sticky operational failures. Missing member
coverage remains a separate uncertainty. `drain()` can return actual drain
observations without issuing retirement proof; `JobDrain::require_verified()`
and `settle()` keep strict retirement semantics. An empty active-process count
alone never establishes complete descendant retirement.

The runtime and protocol modules own the private guardian stream, provider I/O
and actual child/writer cleanup. A result frame, process construction identity
or ordinary command output grants no application operation authority and does
not prove provider consumption, complete escaped-descendant coverage, Native
cohort retirement or migration qualification.

The Windows unit module retains the real restricted-handle API regressions and
their isolated child entry. Native deployment's existing strict job tests use
the shared library through the borrow-only handle API. Build, package, installed
Host/Desktop, Unix and physical-device acceptance require their own evidence;
this package's source does not assert those checks passed.
