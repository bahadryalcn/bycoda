//! Read-only, signed lookup of an original native workspace receipt.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use crate::remote::{NativeServiceChannel, NativeServiceReply};
fn field<'a>(v:&'a Value,key:&str,max:usize)->Result<&'a str,String> { v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty() && s.len()<=max && !s.contains('\0')).ok_or_else(||format!("Invalid workspace receipt {key}")) }
pub(super) fn status(app:&AppHandle,request:&Value,channel:&Arc<NativeServiceChannel>,taken:&NativeServiceReply)->Result<Value,String> {
    let environment=field(request,"environmentId",200)?; let thread=field(request,"threadId",200)?;
    let project=field(request,"projectId",200)?; let cwd=field(request,"targetProjectCwd",4096)?; let relay=field(request,"id",200)?;
    let input=request.get("input").filter(|v|v.as_object().is_some_and(|o|o.len()==3)).ok_or("Invalid workspace receipt input")?;
    let operation=field(input,"operationId",300)?; let action=field(input,"action",100)?;
    if !matches!(action,"workspace.projects.select"|"workspace.sessions.create"|"workspace.sessions.open"|"workspace.sessions.submit"|"workspace.sessions.stop"|"organization.patch") { return Err("Invalid original workspace action".into()); }
    let original=input.get("originalInput").filter(|v|v.is_object()).ok_or("Original workspace input required")?;
    if action == "organization.patch" { crate::room_organization_owner::validate(action, original, operation)?; }
    if original["requestId"].as_str()!=Some(operation) || channel.environment_id()!=environment { return Err("Original workspace operation changed".into()); }
    let deadline=request["deadline"].as_u64().ok_or("Workspace receipt deadline required")?;
    let (window,owner)=crate::control::validate_assistant_source(app,thread,environment)?;
    let webview=app.get_webview_window(&window).ok_or("Room window unavailable")?;
    let check=||->Result<(),String>{
        taken.check()?;
        if !channel.is_current() || deadline<=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_millis() as u64 { return Err("Workspace receipt authority expired".into()); }
        let allowed=channel.project("conversation.desktop.authorize",json!({"id":relay,"action":"workspace.operation.status"}),|v|Ok(v.as_object().is_some_and(|o|o.len()==1 && o.get("authorized")==Some(&Value::Bool(true)))))?;
        if !allowed { return Err("Workspace receipt authority revoked".into()); }
        let (current,issuer)=crate::control::validate_assistant_source(app,thread,environment)?;
        if current!=window || !Arc::ptr_eq(&owner,&issuer) { return Err("Workspace Room source changed".into()); }
        taken.check()
    };
    check()?;
    let _permit=crate::conversation_tools_bridge::privacy_scope_capture::begin_effect()?;
    let scope=crate::control::privacy_scope_admission_pinned(app,&webview,&owner)?;
    crate::privacy_projection::scope_projection_metadata(app,&owner,&scope)?;
    if !scope["visibleProjects"].as_array().is_some_and(|items|items.iter().any(|v|v["cwd"].as_str()==Some(cwd))) { return Err("Workspace project is unavailable or private".into()); }
    check()?;
    let result=crate::control::workspace_effect_receipts::status(app,environment,thread,project,cwd,operation,action,original)?;
    let operation_json=serde_json::to_string(&json!({"environmentId":environment,"threadId":thread,"issuer":owner.identity(),"relayId":relay,"projectId":project,"targetCwd":cwd,"operationId":operation,"action":action,"originalInput":original,"result":result})).map_err(|_|"Invalid workspace receipt")?;
    let hash=format!("{:x}",Sha256::digest(operation_json.as_bytes()));
    let signer=crate::remote::assistant_room_delegation::native_signer(app)?;
    let installation=field(&signer.identity(),"installationId",200)?.to_owned();
    check()?;
    let challenge=channel.request("assistant.delegation.nativeChallenge",json!({"input":{"installationId":installation,"hostId":environment,"action":"assistant.workspace.receipt","requestDigest":hash}}))?;
    let value=challenge.project(|v|Ok(v.clone()))?; check()?; challenge.check()?;
    let proof=signer.sign_challenge(&value,environment,"assistant.workspace.receipt",&hash)?; check()?;
    Ok(json!({"operationJson":operation_json,"proof":proof}))
}
