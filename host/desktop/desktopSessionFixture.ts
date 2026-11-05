// Real HTTP/SQLite jobs need more than 1 s on busy Windows runners, while
// remaining below the 12 s desktop writer transfer deadline.
export const WAIT_FOR_DESKTOP_JOB = { timeout: 10_000 };
