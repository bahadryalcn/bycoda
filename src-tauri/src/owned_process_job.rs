//! Native uses the same original Windows job owner as the guardian executable.
#[allow(unused_imports)]
pub(crate) use bycoda_provider_process_guardian::windows_job::{
    JobDrain, OwnedJobError, OwnedProcessJob,
};
