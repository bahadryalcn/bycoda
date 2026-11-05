use std::path::Path;
use napi::{bindgen_prelude::AsyncTask, Env, Task};
use napi_derive::napi;

#[napi(object)]
pub struct GuardedMoveResult {
    pub path: String,
    pub recovery_path: String,
    pub receipt_path: String,
    pub warning: Option<String>,
}

pub struct GuardedMoveTask { source: String, destination: String }
impl Task for GuardedMoveTask {
    type Output = bycoda_physical_store_admission::guarded_move_paths::RecoveryResult;
    type JsValue = GuardedMoveResult;
    fn compute(&mut self) -> napi::Result<Self::Output> {
        bycoda_physical_store_admission::guarded_move_paths::move_paths(Path::new(&self.source), Path::new(&self.destination))
            .map_err(|error| napi::Error::from_reason(error.to_string()))
    }
    fn resolve(&mut self, _: Env, result: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(GuardedMoveResult { path: result.path.to_string_lossy().into_owned(), recovery_path: result.recovery_path.to_string_lossy().into_owned(), receipt_path: result.receipt_path.to_string_lossy().into_owned(), warning: result.warning })
    }
}
#[napi]
pub fn guarded_move(source: String, destination: String) -> AsyncTask<GuardedMoveTask> {
    AsyncTask::new(GuardedMoveTask { source, destination })
}
