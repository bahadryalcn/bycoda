//! Native-only Room delegation coordinator. Bearer secrets never leave this module.
use super::*;
use tauri::WebviewWindow;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use super::assistant_native_signer::NativeSigner;

#[derive(Clone)]
struct Delegation {
    token: String,
    origin: String,
    target: String,
    machine: String,
    thread: String,
    project: String,
    public_key: String,
    origin_revision: String,
    actions: Vec<String>,
    expires_at: u64,
}
fn vault() -> &'static Mutex<HashMap<String, Delegation>> {
    static VAULT: OnceLock<Mutex<HashMap<String, Delegation>>> = OnceLock::new();
    VAULT.get_or_init(|| Mutex::new(HashMap::new()))
}
fn grant_metadata(grants:&HashMap<String,Delegation>, environment:&str, thread:&str, now:u64) -> Vec<Value> {
    grants.iter().filter(|(_,grant)| grant.origin==environment && grant.thread==thread && grant.expires_at>now).map(|(id,grant)|json!({"grantId":id,"targetEnvironmentId":grant.target,"projectId":grant.project,"actions":grant.actions,"expiresAt":grant.expires_at})).collect()
}
pub(crate) fn native_signer(app: &AppHandle) -> Result<NativeSigner, String> {
    let state = app.state::<RemoteConnections>();
    let _lock = state.store.lock().map_err(|_| "Native key store unavailable")?;
    let path = store_path(app)?.with_file_name("room-native-admission.pk8");
    NativeSigner::load_or_create(&path)
}

/// Public key is for explicit out-of-band Host-owner enrollment; it grants nothing.
#[tauri::command]
pub async fn room_delegation_native_identity(app: AppHandle) -> Result<Value, String> {
    crate::harness::run_blocking("room_delegation_native_identity", move || Ok(native_signer(&app)?.identity())).await
}
fn text(value: &Value, name: &str) -> Result<String, String> {
    value.get(name).and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 1000).map(str::to_owned).ok_or_else(|| format!("Invalid delegation {name}"))
}
fn source(app: &AppHandle, window: &WebviewWindow, thread: &str, origin: &str) -> Result<Arc<crate::control::receipts::WindowIssuer>, String> {
    let (owner, issuer) = crate::control::validate_assistant_source(app, thread, origin)?;
    if owner != window.label() { return Err("Assistant Room belongs to another window".into()); }
    Ok(issuer)
}
fn check_source(app: &AppHandle, window: &WebviewWindow, thread: &str, origin: &str, expected: &Arc<crate::control::receipts::WindowIssuer>) -> Result<(), String> {
    let current = source(app, window, thread, origin)?;
    if !Arc::ptr_eq(expected, &current) { return Err("Assistant Room source changed".into()); }
    Ok(())
}
fn protected_request(app: &AppHandle, window: &WebviewWindow, thread: &str, origin: &str, issuer: &Arc<crate::control::receipts::WindowIssuer>, channel: &Arc<NativeServiceChannel>, action: &str, operation: Value) -> Result<NativeServiceReply, String> {
    let signer = native_signer(app)?;
    let identity = signer.identity();
    let operation_json = serde_json::to_string(&operation).map_err(|_| "Invalid native operation")?;
    if operation_json.len() > 32768 { return Err("Native operation is too large".into()); }
    let digest = format!("{:x}", Sha256::digest(operation_json.as_bytes()));
    let installation = text(&identity, "installationId")?;
    let host = channel.environment_id();
    let challenge = channel.request("assistant.delegation.nativeChallenge", json!({"input":{"installationId":installation,"hostId":host,"action":action,"requestDigest":digest}}))?;
    let value = challenge.project(|value| Ok(value.clone()))?;
    check_source(app, window, thread, origin, issuer)?;
    challenge.check()?;
    let proof = signer.sign_challenge(&value, host, action, &digest)?;
    check_source(app, window, thread, origin, issuer)?;
    channel.request(action, json!({"input":{"operationJson":operation_json,"proof":proof}}))
}

#[tauri::command]
pub async fn room_delegation_issue(app: AppHandle, window: WebviewWindow, machine_id: String, thread_id: String, project_id: String, actions: Vec<String>, expires_at: u64, request_id: String) -> Result<Value, String> {
    crate::harness::run_blocking("room_delegation_issue", move || {
        let state = app.state::<RemoteConnections>();
        let origin = NativeServiceChannel::connect(&app)?;
        let source_id = origin.environment_id().to_owned();
        let issuer = source(&app, &window, &thread_id, &source_id)?;
        let target = {
            let _lock = state.store.lock().map_err(|_| "Connection store is locked")?;
            read_uncached(&store_path(&app)?)?.into_iter().find(|m| m.id == machine_id && m.environment_id != source_id).ok_or("Choose a different paired Host")?
        };
        if project_id.is_empty() || project_id.len() > 200 || actions.is_empty() || actions.len() > 6 || actions.iter().any(|a| !["sessions.list", "sessions.read", "tasks.list", "tasks.get", "tasks.create", "tasks.update"].contains(&a.as_str())) { return Err("Invalid Room delegation scope".into()); }
        let peer = NativeServiceChannel::peer(&app, &target.id, &target.environment_id)?;
        let key = origin.project("assistant.delegation.publicKey", json!({}), |v| {
            if v["environmentId"] != source_id { return Err("Origin Host changed".into()); }
            text(v, "publicKey")
        })?;
        let message = format!("Allow this Room to use the selected Host?\n\nOrigin Host: {source_id}\nRoom: {thread_id}\nTarget Host: {}\nProject: {project_id}\nActions: {}\nExpires at: {expires_at}\n\nOrigin public key:\n{key}", target.environment_id, actions.join(", "));
        if !app.dialog().message(message).title("bycoda — Room delegation").parent(&window).buttons(MessageDialogButtons::OkCancelCustom("Approve exact delegation".into(), "Cancel".into())).blocking_show() { return Err("Room delegation cancelled".into()); }
        check_source(&app, &window, &thread_id, &source_id, &issuer)?;
        origin.check()?; peer.check()?;
        let origin_review = protected_request(&app, &window, &thread_id, &source_id, &issuer, &origin, "assistant.delegation.origin", json!({"threadId":thread_id,"targetEnvironmentId":target.environment_id,"projectId":project_id,"publicKey":key}))?;
        let origin_revision = origin_review.project(|v| {
            if v["environmentId"] != source_id || v["threadId"] != thread_id || v["publicKey"] != key { return Err("Original Room identity changed".into()); }
            text(v, "originNativeRevision")
        })?;
        check_source(&app, &window, &thread_id, &source_id, &issuer)?;
        origin_review.check()?;
        let result = protected_request(&app, &window, &thread_id, &source_id, &issuer, &peer, "assistant.delegation.issue", json!({"requestId":request_id,"originEnvironmentId":source_id,"originNativeRevision":origin_revision,"targetEnvironmentId":target.environment_id,"threadId":thread_id,"projectId":project_id,"originPublicKey":key,"actions":actions,"expiresAt":expires_at}))?;
        let (grant_id, token, expiry) = result.project(|v| Ok((text(v,"grantId")?, text(v,"token")?, v["expiresAt"].as_u64().ok_or("Invalid delegation expiry")?)))?;
        check_source(&app, &window, &thread_id, &source_id, &issuer)?;
        result.check()?;
        vault().lock().map_err(|_| "Delegation vault unavailable")?.insert(grant_id.clone(), Delegation { token, origin: source_id, target: target.environment_id, machine: target.id, thread: thread_id, project: project_id, public_key: key, origin_revision, actions, expires_at:expiry });
        Ok(json!({"grantId":grant_id,"expiresAt":expiry}))
    }).await
}

#[tauri::command]
pub async fn room_delegation_call(app: AppHandle, window: WebviewWindow, grant_id: String, action: String, request_id: String, input: Value) -> Result<Value, String> {
    crate::harness::run_blocking("room_delegation_call", move || call(&app, &window, &grant_id, &action, &request_id, input, &|| Ok(()))).await
}
fn call(app:&AppHandle, window:&WebviewWindow, grant_id:&str, action:&str, request_id:&str, input:Value, authorized:&dyn Fn()->Result<(),String>) -> Result<Value,String> {
        let grant = vault().lock().map_err(|_| "Delegation vault unavailable")?.get(grant_id).cloned().ok_or("Delegation is unavailable; reconnect explicitly")?;
        let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_millis() as u64;
        if !input.is_object() || !grant.actions.iter().any(|item| item == action) || grant.expires_at <= now { return Err("Delegated operation is unavailable or expired".into()); }
        let issuer = source(&app, &window, &grant.thread, &grant.origin)?;
        let origin = NativeServiceChannel::connect(&app)?;
        if origin.environment_id() != grant.origin { return Err("Original Host is unavailable".into()); }
        let peer = NativeServiceChannel::peer(&app, &grant.machine, &grant.target)?;
        let current_key = origin.project("assistant.delegation.publicKey", json!({}), |v| { if v["environmentId"] != grant.origin { return Err("Origin Host changed".into()); } text(v,"publicKey") })?;
        if current_key != grant.public_key { return Err("Origin Host key changed; reconnect explicitly".into()); }
        if matches!(action, "tasks.create" | "tasks.update") {
            let reviewed = serde_json::to_string_pretty(&input).map_err(|_| "Invalid operation")?;
            if reviewed.len() > 32768 { return Err("Delegated operation is too large to review".into()); }
            let message = format!("Approve this exact delegated operation?\n\nOrigin Host: {}\nRoom: {}\nTarget Host: {}\nProject: {}\nAction: {action}\nRequest: {request_id}\n\n{reviewed}", grant.origin, grant.thread, grant.target, grant.project);
            if !app.dialog().message(message).title("bycoda — Delegated operation").parent(&window).buttons(MessageDialogButtons::OkCancelCustom("Approve exact operation".into(), "Cancel".into())).blocking_show() { return Err("Delegated operation cancelled".into()); }
            check_source(&app, &window, &grant.thread, &grant.origin, &issuer)?;
        }
        authorized()?;
        let challenge = protected_request(&app, &window, &grant.thread, &grant.origin, &issuer, &peer, "assistant.delegation.challenge", json!({"grantId":grant_id,"token":grant.token,"action":action,"requestId":request_id,"input":input}))?;
        let (nonce, scope, expires) = challenge.project(|v| Ok((text(v,"nonce")?,text(v,"scopeHash")?,v["expiresAt"].as_u64().ok_or("Invalid challenge expiry")?)))?;
        let exact_payload = serde_json::to_vec(&json!([action, input])).map_err(|_| "Invalid reviewed operation")?;
        let expected_scope = format!("{:x}", Sha256::digest(exact_payload));
        if scope != expected_scope { return Err("Target challenge differs from reviewed operation".into()); }
        check_source(&app, &window, &grant.thread, &grant.origin, &issuer)?;
        challenge.check()?;
        let attestation = json!({"version":1,"originEnvironmentId":grant.origin,"originNativeRevision":grant.origin_revision,"targetEnvironmentId":grant.target,"threadId":grant.thread,"projectId":grant.project,"grantId":grant_id,"action":action,"requestId":request_id,"scopeHash":scope,"nonce":nonce,"expiresAt":expires});
        let signed = protected_request(&app, &window, &grant.thread, &grant.origin, &issuer, &origin, "assistant.delegation.attest", attestation.clone())?;
        let signature = signed.project(|v| text(v,"signature"))?;
        check_source(&app, &window, &grant.thread, &grant.origin, &issuer)?;
        signed.check()?; challenge.check()?;
        authorized()?;
        let reply = protected_request(&app, &window, &grant.thread, &grant.origin, &issuer, &peer, "assistant.delegation.call", json!({"grantId":grant_id,"token":grant.token,"originEnvironmentId":grant.origin,"threadId":grant.thread,"projectId":grant.project,"action":action,"requestId":request_id,"input":input,"attestation":attestation,"signature":signature}))?;
        reply.project(|value| { check_source(&app, &window, &grant.thread, &grant.origin, &issuer)?; Ok(value.clone()) })
}

/// Private desktop relay, scoped to the actual originating Room and pending Host request.
pub(crate) fn room_tool(app:&AppHandle, request:&Value, channel:&Arc<NativeServiceChannel>, taken:&NativeServiceReply) -> Result<Value,String> {
    let thread=text(request,"threadId")?;
    let environment=text(request,"environmentId")?;
    let action=text(request,"action")?;
    if channel.environment_id()!=environment { return Err("Original Host changed".into()); }
    let (label, owner)=crate::control::validate_assistant_source(app,&thread,&environment)?;
    let window=app.get_webview_window(&label).ok_or("Room window unavailable")?;
    let check=|| -> Result<(),String> {
        taken.check()?;
        if !channel.is_current() { return Err("Original Host changed".into()); }
        let (current, issuer)=crate::control::validate_assistant_source(app,&thread,&environment)?;
        if current!=label || !Arc::ptr_eq(&owner,&issuer) { return Err("Original Room source changed".into()); }
        let allowed=channel.project("conversation.desktop.authorize",json!({"id":request["id"],"action":action}),|value| Ok(value["authorized"]==true))?;
        if !allowed { return Err("Original Room authority revoked".into()); }
        taken.check()
    };
    check()?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_millis() as u64;
    let value=match action.as_str() {
        "delegation.grants" => {
            let grants=vault().lock().map_err(|_|"Delegation vault unavailable")?;
            let items=grant_metadata(&grants,&environment,&thread,now);
            json!({"items":items})
        },
        "delegation.call" => {
            let input=request.get("input").ok_or("Delegation input unavailable")?;
            let grant_id=text(input,"grantId")?; let operation=text(input,"action")?; let request_id=text(input,"requestId")?;
            let grant=vault().lock().map_err(|_|"Delegation vault unavailable")?.get(&grant_id).cloned().ok_or("Delegation unavailable")?;
            if grant.origin!=environment || grant.thread!=thread { return Err("Delegation belongs to another Room".into()); }
            let result=call(app,&window,&grant_id,&operation,&request_id,input.get("input").cloned().ok_or("Operation input unavailable")?,&check)?;
            json!({"value":result,"targetEnvironmentId":grant.target,"projectId":grant.project,"observedAt":now,"remoteContext":"unverified"})
        },
        _ => return Err("Unsupported delegation action".into()),
    };
    check()?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_excludes_secrets_other_rooms_and_expired_grants() {
        let grant=Delegation { token:"secret".into(),origin:"origin".into(),target:"target".into(),machine:"machine".into(),thread:"room".into(),project:"project".into(),public_key:"key".into(),origin_revision:"revision".into(),actions:vec!["tasks.get".into()],expires_at:100 };
        let mut grants=HashMap::new(); grants.insert("grant".into(),grant);
        let visible=grant_metadata(&grants,"origin","room",99);
        assert_eq!(visible.len(),1); assert!(!visible[0].to_string().contains("secret"));
        assert!(grant_metadata(&grants,"origin","other",99).is_empty());
        assert!(grant_metadata(&grants,"origin","room",100).is_empty());
    }
}

#[tauri::command]
pub async fn room_delegation_revoke(app: AppHandle, window: WebviewWindow, grant_id: String) -> Result<Value, String> {
    crate::harness::run_blocking("room_delegation_revoke", move || {
        let grant = vault().lock().map_err(|_| "Delegation vault unavailable")?.get(&grant_id).cloned().ok_or("Delegation unavailable")?;
        let issuer = source(&app, &window, &grant.thread, &grant.origin)?;
        let peer = NativeServiceChannel::peer(&app, &grant.machine, &grant.target)?;
        let reply = protected_request(&app, &window, &grant.thread, &grant.origin, &issuer, &peer, "assistant.delegation.revoke", json!({"grantId":grant_id}))?;
        reply.project(|value| { check_source(&app, &window, &grant.thread, &grant.origin, &issuer)?; Ok(value.clone()) })?;
        vault().lock().map_err(|_| "Delegation vault unavailable")?.remove(&grant_id);
        Ok(json!({"revoked":true,"grantId":grant_id}))
    }).await
}

/// Reconcile a lost grant acknowledgement without reissuing or exposing a token.
#[tauri::command]
pub async fn room_delegation_issue_status(app: AppHandle, window: WebviewWindow, machine_id: String, thread_id: String, request_id: String) -> Result<Value, String> {
    crate::harness::run_blocking("room_delegation_issue_status", move || {
        let state = app.state::<RemoteConnections>();
        let origin = NativeServiceChannel::connect(&app)?;
        let source_id = origin.environment_id().to_owned();
        let issuer = source(&app, &window, &thread_id, &source_id)?;
        let target = {
            let _lock = state.store.lock().map_err(|_| "Connection store is locked")?;
            read_uncached(&store_path(&app)?)?.into_iter().find(|m| m.id == machine_id && m.environment_id != source_id).ok_or("Selected Host is unavailable")?
        };
        let peer = NativeServiceChannel::peer(&app, &target.id, &target.environment_id)?;
        let reply = protected_request(&app, &window, &thread_id, &source_id, &issuer, &peer, "assistant.delegation.issue.status", json!({"requestId":request_id}))?;
        reply.project(|value| { check_source(&app, &window, &thread_id, &source_id, &issuer)?; Ok(value.clone()) })
    }).await
}

/// A lost token cannot be recovered. The enrolled owner can retire that exact grant.
#[tauri::command]
pub async fn room_delegation_revoke_retained(app: AppHandle, window: WebviewWindow, machine_id: String, thread_id: String, grant_id: String) -> Result<Value, String> {
    crate::harness::run_blocking("room_delegation_revoke_retained", move || {
        let state = app.state::<RemoteConnections>();
        let origin = NativeServiceChannel::connect(&app)?;
        let source_id = origin.environment_id().to_owned();
        let issuer = source(&app, &window, &thread_id, &source_id)?;
        let target = {
            let _lock = state.store.lock().map_err(|_| "Connection store is locked")?;
            read_uncached(&store_path(&app)?)?.into_iter().find(|m| m.id == machine_id && m.environment_id != source_id).ok_or("Selected Host is unavailable")?
        };
        let peer = NativeServiceChannel::peer(&app, &target.id, &target.environment_id)?;
        let reply = protected_request(&app, &window, &thread_id, &source_id, &issuer, &peer, "assistant.delegation.revoke", json!({"grantId":grant_id}))?;
        reply.project(|value| { check_source(&app, &window, &thread_id, &source_id, &issuer)?; Ok(value.clone()) })?;
        vault().lock().map_err(|_| "Delegation vault unavailable")?.remove(&grant_id);
        Ok(json!({"revoked":true,"grantId":grant_id}))
    }).await
}

