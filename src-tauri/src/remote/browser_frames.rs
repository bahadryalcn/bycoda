//! Read-only binary browser frames. Native preserves the saved Host route and keeps only its latest packet.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tauri::{ipc::Response, WebviewWindow};
use tokio::sync::{oneshot, watch};
use tokio::time::{self, Duration, Instant};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig, Message},
};

const MAX_PACKET_BYTES: usize = 2 * 1024 * 1024;
const PROTOCOL: &str = "bycoda.browser-frames.v1";
type Frame = Arc<(u32, Vec<u8>)>;

struct Viewer {
    window: String,
    frames: watch::Receiver<Option<Frame>>,
    _close: oneshot::Sender<()>,
}

#[derive(Default)]
pub(super) struct Streams(Mutex<HashMap<String, Viewer>>);

impl Streams {
    pub(super) fn detach(&self, window: &str) {
        if let Ok(mut viewers) = self.0.lock() {
            viewers.retain(|_, viewer| viewer.window != window);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    project_id: Option<String>,
    session_id: Option<String>,
    owner_presentation_scope: Option<String>,
}

#[tauri::command]
pub async fn remote_browser_frames_open(
    app: AppHandle,
    window: WebviewWindow,
    machine_id: String,
    environment_id: String,
    scope: Scope,
) -> Result<String, String> {
    let lookup_app = app.clone();
    let (machine, route) = tauri::async_runtime::spawn_blocking(move || {
        let state = lookup_app.state::<RemoteConnections>();
        let machine =
            saved_ws_machine(&lookup_app, &state, &machine_id).map_err(native_ws_failure)?;
        require_machine_environment(&machine, Some(&environment_id))?;
        let route = native_ws_route(&state, &machine, true).map_err(native_ws_failure)?;
        with_current_ws_machine(&lookup_app, &state, &machine, || Ok(()))
            .map_err(native_ws_failure)?;
        Ok::<_, String>((machine, route))
    })
    .await
    .map_err(|_| "Browser stream route interrupted")??;
    let mut endpoint = route.browser_frames_endpoint()?;
    for (key, value) in [
        ("projectId", scope.project_id),
        ("sessionId", scope.session_id),
        ("ownerPresentationScope", scope.owner_presentation_scope),
    ] {
        if let Some(value) = value {
            if value.is_empty() || value.len() > 512 {
                return Err("Invalid browser stream scope".into());
            }
            endpoint.query_pairs_mut().append_pair(key, &value);
        }
    }
    let mut request = endpoint
        .as_str()
        .into_client_request()
        .map_err(|_| "Invalid browser stream route")?;
    let headers = request.headers_mut();
    headers.insert(
        "Authorization",
        format!("Bearer {}", machine.token)
            .parse()
            .map_err(|_| "Invalid Host credential")?,
    );
    headers.insert(
        "x-bycoda-environment",
        machine
            .environment_id
            .parse()
            .map_err(|_| "Invalid Host identity")?,
    );
    headers.insert(
        "Sec-WebSocket-Protocol",
        PROTOCOL
            .parse()
            .map_err(|_| "Invalid browser stream protocol")?,
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_PACKET_BYTES))
        .max_frame_size(Some(MAX_PACKET_BYTES));
    let (mut socket, _) = time::timeout(
        Duration::from_secs(4),
        connect_async_with_config(request, Some(config), true),
    )
    .await
    .map_err(|_| "Browser stream timed out")?
    .map_err(|_| "Browser stream unavailable")?;
    let state = app.state::<RemoteConnections>();
    with_current_ws_machine(&app, &state, &machine, || Ok(())).map_err(native_ws_failure)?;
    let (send, frames) = watch::channel(None);
    let (close, stopped) = oneshot::channel();
    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut viewers = state
            .browser_frames
            .0
            .lock()
            .map_err(|_| "Browser stream state unavailable")?;
        if app.get_webview_window(window.label()).is_none() || viewers.len() >= 16 {
            return Err("Browser stream viewer unavailable".into());
        }
        viewers.insert(
            id.clone(),
            Viewer {
                window: window.label().to_owned(),
                frames,
                _close: close,
            },
        );
    }
    let viewer_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut stopped = stopped;
        let mut sequence = 0_u32;
        let mut checked = Instant::now();
        loop {
            let message = tokio::select! {
                _ = &mut stopped => break,
                data = time::timeout(Duration::from_secs(5), socket.next()) => data,
            };
            if checked.elapsed() >= Duration::from_secs(1) {
                let check_app = app.clone();
                let expected = machine.clone();
                let current = tauri::async_runtime::spawn_blocking(move || {
                    let state = check_app.state::<RemoteConnections>();
                    account_routes::require_machine_enabled(&expected).is_ok()
                        && with_current_ws_machine(&check_app, &state, &expected, || Ok(())).is_ok()
                })
                .await;
                if !matches!(current, Ok(true)) {
                    break;
                }
                checked = Instant::now();
            }
            match message {
                Ok(Some(Ok(Message::Binary(packet)))) => {
                    if packet.len() < 3 {
                        break;
                    }
                    sequence = sequence.wrapping_add(1);
                    send.send_replace(Some(Arc::new((sequence, packet.to_vec()))));
                    if !matches!(
                        time::timeout(
                            Duration::from_secs(1),
                            socket.send(Message::Binary(vec![0].into()))
                        )
                        .await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
                Ok(Some(Ok(Message::Ping(bytes)))) => {
                    if !matches!(
                        time::timeout(Duration::from_secs(1), socket.send(Message::Pong(bytes)))
                            .await,
                        Ok(Ok(()))
                    ) {
                        break;
                    }
                }
                Ok(Some(Ok(Message::Pong(_)))) => {}
                _ => break,
            }
        }
        if let Ok(mut viewers) = app.state::<RemoteConnections>().browser_frames.0.lock() {
            viewers.remove(&viewer_id);
        }
    });
    Ok(id)
}

#[tauri::command]
pub async fn remote_browser_frames_read(
    window: WebviewWindow,
    state: State<'_, RemoteConnections>,
    viewer_id: String,
    after: u32,
) -> Result<Response, String> {
    let mut frames = state
        .browser_frames
        .0
        .lock()
        .map_err(|_| "Browser stream state unavailable")?
        .get(&viewer_id)
        .filter(|viewer| viewer.window == window.label())
        .map(|viewer| viewer.frames.clone())
        .ok_or("Browser stream ended")?;
    let next = async {
        loop {
            if frames.has_changed().is_err() {
                return Err("Browser stream ended");
            }
            let frame = frames.borrow_and_update().clone();
            if let Some(frame) = frame.filter(|frame| frame.0 != after) {
                let mut bytes = Vec::with_capacity(4 + frame.1.len());
                bytes.extend_from_slice(&frame.0.to_be_bytes());
                bytes.extend_from_slice(&frame.1);
                return Ok(Response::new(bytes));
            }
            frames.changed().await.map_err(|_| "Browser stream ended")?;
        }
    };
    match time::timeout(Duration::from_secs(1), next).await {
        Ok(result) => result.map_err(str::to_owned),
        Err(_) => Ok(Response::new(Vec::<u8>::new())),
    }
}

#[tauri::command]
pub fn remote_browser_frames_close(
    window: WebviewWindow,
    state: State<'_, RemoteConnections>,
    viewer_id: String,
) {
    if let Ok(mut viewers) = state.browser_frames.0.lock() {
        if viewers
            .get(&viewer_id)
            .is_some_and(|viewer| viewer.window == window.label())
        {
            viewers.remove(&viewer_id);
        }
    }
}
