use tauri::Manager;

mod account_identity;
mod automations;
mod azure_devops;
pub mod build_info;
mod bundled_host;
mod chat_background;
mod checkpoint;
mod claude_commands;
mod control;
pub mod control_cli;
mod conversation_tools_bridge;
mod cursor_store;
mod debug_profile;
mod desktop_inbox_review;
mod external_editor;
mod file_access;
mod fs;
mod generic_acp;
mod git_conflicts;
mod git_submodules;
mod git_watch;
mod github_review;
mod gitlab;
mod handoff_history;
mod harness;
mod harness_updates;
mod html_preview;
mod inbox_media;
mod integrations;
mod jira;
mod keep_awake;
mod linear;
mod link_preview;
mod local_host;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
mod macos_background;
mod mcp;
mod menu;
mod mobile_pty;
mod native_language;
mod native_workspace;
mod notes;
mod notifications;
mod pasteboard;
mod pi_usage;
mod project_logo;
mod provider_terminal_profiles;
mod provider_usage;
mod pty;
mod pty_runtime_logs;
#[cfg(target_os = "macos")]
mod quick_composer;
mod rate_limits;
mod reminders;
mod remote;
mod remote_files;
mod remote_ssh;
mod runtime_logs_bridge;
mod search;
mod server_inventory;
mod session_import;
mod session_store;
mod session_tools_bridge;
mod session_transfer;
mod skills;
mod social_bridge;
mod ssh_agent_forwarding;
pub mod ssh_askpass;
mod ssh_certificate;
mod ssh_configuration;
mod ssh_environment;
mod ssh_execution;
mod ssh_forward;
mod ssh_group_defaults;
pub mod ssh_http_proxy;
mod ssh_http_proxy_credentials;
mod ssh_jump_config;
mod ssh_keys;
mod ssh_runbooks;
mod ssh_security;
mod ssh_sftp;
mod ssh_shell_integration;
mod ssh_terminal;
mod ssh_window_lifecycle;
mod terminal_completion;
mod terminal_profiles;
mod termius_import;
mod termius_keys;
mod termius_reader;
mod termius_transfer;
mod trackpad_zoom;
mod tray;
mod turn_probe;
mod turn_steps;
mod window;
mod window_fullscreen;
mod window_transfer;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod windows_instance;
mod worktree_lifecycle;
mod worktrees;

// Phase 1 seam: spawn / kill harness children per bycoda thread.
// Adapters own the protocol; this host only supervises processes.

/// Project directory for new sessions — prefer cwd, else home.
#[tauri::command]
fn default_cwd() -> String {
    if let Ok(cwd) = std::env::current_dir() {
        return fs::path_to_js(&cwd);
    }
    dirs_home()
        .map(|home| fs::path_to_js(std::path::Path::new(&home)))
        .unwrap_or_else(|| "~".into())
}

#[tauri::command]
fn home_dir() -> String {
    dirs_home()
        .map(|home| fs::path_to_js(std::path::Path::new(&home)))
        .unwrap_or_else(|| "~".into())
}

#[tauri::command]
fn path_environment() -> std::collections::HashMap<String, String> {
    [
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "TEMP",
        "TMP",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "WINDIR",
    ]
    .into_iter()
    .filter_map(|key| {
        std::env::var(key).ok().map(|value| {
            (
                key.to_string(),
                fs::path_to_js(std::path::Path::new(&value)),
            )
        })
    })
    .collect()
}

pub(crate) struct PasswdIdentity {
    pub home: String,
    pub user: String,
    pub shell: String,
}

pub(crate) fn dirs_home() -> Option<String> {
    #[cfg(windows)]
    let keys = ["USERPROFILE", "HOME"];
    #[cfg(not(windows))]
    let keys = ["HOME", "USERPROFILE"];
    for key in keys {
        if let Some(home) = std::env::var_os(key) {
            let home = home.to_string_lossy().into_owned();
            if !home.is_empty() {
                return Some(home);
            }
        }
    }
    match (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
        (Ok(drive), Ok(path)) if !drive.is_empty() && !path.is_empty() => {
            Some(format!("{drive}{path}"))
        }
        _ => passwd_identity().map(|id| id.home),
    }
}

/// Hide the console window that Windows allocates for GUI-spawned children.
pub(crate) fn hide_window_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(WINDOWS_BACKGROUND_CREATION_FLAGS);
    }
    let _ = cmd;
}

#[cfg(windows)]
const WINDOWS_BACKGROUND_CREATION_FLAGS: u32 = 0x0800_0000; // CREATE_NO_WINDOW

#[cfg(all(test, windows))]
mod background_command_tests {
    use super::*;

    #[test]
    fn background_commands_keep_piped_output_and_exit_status() {
        assert_eq!(WINDOWS_BACKGROUND_CREATION_FLAGS, 0x0800_0000);

        let mut cmd = std::process::Command::new("cmd.exe");
        cmd.args(["/D", "/C", "(echo stdout)&(echo stderr 1>&2)&exit /b 7"]);
        hide_window_console(&mut cmd);

        let output = cmd.output().expect("background command should run");
        assert_eq!(output.status.code(), Some(7));
        assert!(String::from_utf8_lossy(&output.stdout).contains("stdout"));
        assert!(String::from_utf8_lossy(&output.stderr).contains("stderr"));
    }
}

/// Finder-launched .app bundles often omit HOME/USER/SHELL. Fall back to the
/// passwd database so harness CLIs still find `~/.fx` and the login keychain.
pub(crate) fn passwd_identity() -> Option<PasswdIdentity> {
    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        let mut buf = vec![0u8; 4096];
        let mut pwd = unsafe { std::mem::zeroed::<libc::passwd>() };
        let mut result = std::ptr::null_mut::<libc::passwd>();
        let rc = unsafe {
            libc::getpwuid_r(
                uid,
                &mut pwd,
                buf.as_mut_ptr() as *mut libc::c_char,
                buf.len(),
                &mut result,
            )
        };
        if rc != 0 || result.is_null() {
            return None;
        }
        unsafe {
            let user = std::ffi::CStr::from_ptr(pwd.pw_name)
                .to_string_lossy()
                .into_owned();
            let home = std::ffi::CStr::from_ptr(pwd.pw_dir)
                .to_string_lossy()
                .into_owned();
            let shell = std::ffi::CStr::from_ptr(pwd.pw_shell)
                .to_string_lossy()
                .into_owned();
            if user.is_empty() || home.is_empty() {
                return None;
            }
            Some(PasswdIdentity { home, user, shell })
        }
    }
    #[cfg(not(unix))]
    {
        None
    }
}

#[tauri::command]
fn set_traffic_lights_visible(
    #[allow(unused_variables)] window: tauri::WebviewWindow,
    #[allow(unused_variables)] visible: bool,
) {
    #[cfg(target_os = "macos")]
    macos::set_visible(&window, visible);
}

#[tauri::command]
fn set_window_background_blur(
    #[allow(unused_variables)] window: tauri::WebviewWindow,
    #[allow(unused_variables)] radius: u8,
) {
    #[cfg(target_os = "macos")]
    macos::set_background_blur_radius(&window, radius);
}

#[tauri::command]
fn set_dock_badge(
    #[allow(unused_variables)] window: tauri::WebviewWindow,
    #[allow(unused_variables)] count: u32,
) {
    #[cfg(target_os = "macos")]
    macos::set_window_badge(&window, count);
}

// Async: building a webview from a sync command deadlocks the Windows event loop (wry#583).
#[tauri::command]
async fn open_new_window(
    app: tauri::AppHandle,
    transfer: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || match transfer {
        Some(payload) => window::open_transfer_window(&app, payload, x.zip(y)),
        None => window::open_new_window(&app),
    })
    .await
    .map_err(|error| error.to_string())?
}

fn should_request_quit(code: Option<i32>) -> bool {
    code.is_some() || cfg!(any(target_os = "linux", target_os = "windows"))
}

#[tauri::command]
async fn open_tool_window(
    app: tauri::AppHandle,
    tool: String,
    cwd: String,
    grouped: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        window::open_tool_window(&app, &tool, &cwd, grouped)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// wry's own WebView2 browser arguments; replacing them must keep these.
const WEBVIEW_DEFAULT_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// The browser arguments for an opt-in local DevTools port, or None. WebView2
/// ignores `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` because wry always passes
/// explicit arguments, so profiling a release build needs this switch. Chromium
/// binds the port to 127.0.0.1 only; it is never on unless the variable is set.
fn webview_debug_args(port: Option<&str>) -> Option<String> {
    let port: u16 = port?.trim().parse().ok().filter(|port| *port >= 1024)?;
    Some(format!(
        "{WEBVIEW_DEFAULT_ARGS} --remote-debugging-port={port}"
    ))
}

/// Every window shares one WebView2 environment, which rejects windows whose
/// arguments differ, so the switch is applied to the config all windows copy.
fn webview_debug_context(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    if cfg!(windows) {
        let port = std::env::var("BYCODA_WEBVIEW_DEBUG_PORT").ok();
        if let Some(args) = webview_debug_args(port.as_deref()) {
            eprintln!("WebView DevTools protocol enabled on 127.0.0.1 (BYCODA_WEBVIEW_DEBUG_PORT)");
            for window in &mut context.config_mut().app.windows {
                window.additional_browser_args = Some(args.clone());
            }
        }
    }
    context
}

pub fn run() {
    #[cfg(windows)]
    windows::initialize().expect("Failed to initialize Windows process safety");
    let builder = tauri::Builder::default();
    // Reject duplicate GUI launches before stores, relays, hosts or trays start.
    #[cfg(windows)]
    let builder = builder.plugin(windows_instance::init());
    let app = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[
                    window::QUICK_COMPOSER_LABEL,
                    window::QUICK_COMPOSER_GIT_LABEL,
                ])
                .build(),
        )
        .manage(harness::HarnessHost::new())
        .manage(keep_awake::KeepAwakeState::new())
        .manage(git_watch::GitWatchHost::default())
        .manage(pty::PtyHost::new())
        .manage(mobile_pty::MobilePtyHost::default())
        .manage(remote::RemoteConnections::default())
        .manage(ssh_forward::SshForwards::default())
        .manage(ssh_agent_forwarding::AgentForwardingReviews::default())
        .manage(ssh_http_proxy_credentials::HttpProxyCredentials::default())
        .manage(ssh_execution::SshExecutionReviews::default())
        .manage(std::sync::Arc::new(ssh_execution::SshExecutions::default()))
        .manage(window_transfer::WindowTransferState::new())
        .setup(|app| {
            for window in window::workspace_windows(app.handle()) {
                ssh_window_lifecycle::register(window.label())?;
            }
            harness::reap_orphaned_harness_processes();
            app.state::<remote::RemoteConnections>()
                .emit_tunnel_exits(app.handle().clone());
            file_access::init(app.handle())?;
            session_store::init(app.handle())?;
            control::init(app.handle())?;
            reminders::init(app.handle());
            // Keep this computer's host in step with the desktop it shipped with.
            bundled_host::start(app.handle());
            conversation_tools_bridge::start_desktop_relay(app.handle().clone());
            checkpoint::init(app.handle())?;
            menu::install(app.handle())?;
            tray::install(app.handle())?;
            #[cfg(target_os = "macos")]
            {
                quick_composer::init(app.handle())?;
                macos::install_dock_menu(app.handle());
                if let Some(window) = app.get_webview_window("main") {
                    macos::install(&window);
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                    let _ = window.set_shadow(true);
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::dispatch(app, event.id().as_ref());
        })
        .register_uri_scheme_protocol("html-preview", |_context, request| {
            html_preview::respond(request)
        })
        .invoke_handler(tauri::generate_handler![
            build_info::build_identity,
            session_store::rewind::managed_turn_begin,
            session_store::rewind::managed_turn_end,
            session_store::rewind::managed_rewind_plan,
            session_store::rewind::managed_rewind_apply,
            session_store::rewind::managed_rewind_undo,
            session_store::rewind::managed_rewind_reconcile,
            worktrees::managed_worktree_removal_plan,
            worktrees::managed_worktree_removal_apply,
            native_workspace::managed_workspace_buffers,
            remote::remote_machines,
            server_inventory::server_inventory_list,
            termius_import::termius_import_preview,
            termius_import::termius_import_apply,
            termius_import::termius_import_forget,
            server_inventory::server_ssh_save,
            server_inventory::server_ssh_identity_set,
            server_inventory::server_metadata_update,
            server_inventory::server_ssh_remove,
            server_inventory::server_activity_bookmark,
            ssh_terminal::ssh_terminal_spawn,
            ssh_terminal::ssh_terminal_quick_spawn,
            pty::ssh_terminal_suggestions_request,
            pty::ssh_terminal_suggestion_accept,
            pty::ssh_terminal_suggestions_dismiss,
            pty::ssh_terminal_command_insert,
            ssh_sftp::ssh_sftp_list,
            ssh_sftp::ssh_sftp_download,
            ssh_sftp::ssh_sftp_upload,
            ssh_sftp::ssh_sftp_cancel,
            ssh_sftp::ssh_sftp_recoveries,
            ssh_sftp::ssh_sftp_resume,
            ssh_sftp::ssh_sftp_discard,
            ssh_forward::ssh_forward_start,
            ssh_forward::ssh_forward_stop,
            ssh_forward::ssh_forward_list,
            ssh_security::ssh_config_preview,
            ssh_configuration::ssh_group_defaults_list,
            ssh_configuration::ssh_group_defaults_save,
            ssh_configuration::ssh_group_defaults_remove,
            ssh_configuration::server_ssh_configuration_preview,
            ssh_configuration::server_ssh_inheritance_set,
            ssh_runbooks::ssh_runbooks_list,
            ssh_runbooks::ssh_runbook_save,
            ssh_runbooks::ssh_runbook_remove,
            ssh_runbooks::ssh_runbook_preview,
            ssh_runbooks::ssh_runbook_start,
            ssh_runbooks::ssh_runbook_status,
            ssh_runbooks::ssh_runbook_cancel,
            ssh_runbooks::ssh_runbook_pending_intents,
            ssh_runbooks::ssh_runbook_trigger_intent,
            ssh_runbooks::ssh_runbook_dismiss_intent,
            ssh_http_proxy_credentials::ssh_http_proxy_credentials_approve,
            ssh_http_proxy_credentials::ssh_http_proxy_credentials_revoke,
            ssh_runbooks::ssh_runbook_abandon_missing,
            ssh_security::ssh_known_hosts_list,
            ssh_security::ssh_public_keys_list,
            ssh_security::ssh_agent_identities,
            ssh_keys::ssh_key_generate,
            ssh_certificate::ssh_certificate_inspect,
            ssh_terminal::ssh_agent_forwarding_review,
            remote::remote_connect,
            local_host::local_host_connect,
            local_host::local_host_status,
            local_host::local_host_start,
            bundled_host::local_host_bundle_status,
            generic_acp::generic_acp_list,
            generic_acp::generic_acp_save,
            generic_acp::generic_acp_remove,
            generic_acp::generic_acp_registry,
            generic_acp::generic_acp_install,
            generic_acp::generic_acp_cancel_install,
            handoff_history::handoff_history_save,
            handoff_history::handoff_history_read,
            remote::remote_disconnect,
            remote::remote_request,
            remote::dev_access::remote_dev_server_url,
            remote::folder_access::remote_open_live_folder,
            remote_files::begin_remote_file_copy,
            remote_files::cached_remote_file_copy,
            remote_files::append_remote_file_copy,
            remote_files::finish_remote_file_copy,
            remote_files::cancel_remote_file_copy,
            remote_files::prepare_local_file,
            remote::social_authority_status,
            remote::social_authority_connect,
            remote::remote_ssh_begin,
            remote::remote_ssh_reconnect,
            remote::remote_machine_update,
            remote::remote_ssh_poll,
            remote::remote_ssh_answer,
            remote::remote_ssh_cancel,
            control::control_enable,
            control::control_disable,
            control::control_reply,
            control::control_desktop_authorize_effect,
            control::control_save,
            control::control_load,
            control::control_scopes,
            control::control_write_path,
            control::control_attach_worker,
            control::control_authorize_turn,
            control::control_turn_finished,
            control::control_history_sources,
            mobile_pty::mobile_pty_call,
            control::app_cli_path,
            social_bridge::harness_social_bridge,
            runtime_logs_bridge::harness_runtime_logs_bridge,
            conversation_tools_bridge::harness_conversation_tools_bridge,
            default_cwd,
            home_dir,
            path_environment,
            keep_awake::set_keep_awake,
            notifications::notification_permission,
            notifications::request_notification_permission,
            notifications::show_notification,
            notifications::open_notification_settings,
            notifications::set_taskbar_attention,
            tray::tray_sessions_update,
            reminders::reminder_list,
            reminders::reminder_set,
            reminders::reminder_clear,
            reminders::reminder_configure,
            reminders::reminder_take_open,
            reminders::reminder_register_window,
            reminders::reminder_open,
            automations::automations_list,
            automations::automations_upsert,
            automations::automations_delete,
            automations::automation_runs_list,
            automations::automation_runs_recover,
            automations::automation_run_now,
            automations::automations_claim_due,
            automations::automations_claim_event,
            automations::automation_run_update,
            external_editor::list_external_editors,
            external_editor::open_in_external_editor,
            html_preview::open_html_in_chrome,
            html_preview::create_html_preview,
            html_preview::close_html_preview,
            fs::resolve_project_location,
            file_access::authorize_project_path,
            file_access::revoke_file_access,
            file_access::get_file_access_mode,
            file_access::configure_file_access,
            fs::open_path_with_default_app,
            fs::claude_sessions,
            session_transfer::provider_transfer_session,
            fs::list_dir,
            fs::list_project_files,
            fs::git_diff_stats,
            fs::git_diff_index,
            fs::git_diff_files,
            fs::git_file_diff,
            fs::git_history,
            fs::git_commit_files,
            fs::git_commit_file_diff,
            fs::git_stage_file,
            fs::git_stage_files,
            fs::git_discard_files,
            fs::git_unstage_files,
            fs::git_stage_contents,
            fs::git_unstage_file,
            fs::git_discard_file,
            fs::git_discard_all,
            fs::git_stage_all,
            fs::git_unstage_all,
            fs::git_commit,
            fs::git_head_message,
            fs::git_staged_context,
            fs::git_push,
            fs::git_pull,
            fs::git_sync,
            fs::git_range_context,
            fs::git_pr_status,
            fs::git_pr_create,
            fs::git_github_status,
            fs::github_bycoda_star_status,
            fs::github_star_bycoda,
            fs::git_github_repo,
            fs::git_github_repositories,
            fs::git_github_work_item,
            fs::git_github_work_items,
            fs::git_github_work_item_details,
            fs::git_github_work_item_thread,
            fs::git_github_work_item_comment,
            github_review::git_github_pr_review_context,
            github_review::git_github_pr_review,
            desktop_inbox_review::desktop_inbox_review,
            fs::git_github_pr_action,
            fs::git_github_pr_diff,
            fs::git_github_pr_checks,
            fs::git_github_check_details,
            inbox_media::fetch_inbox_media,
            gitlab::checks::gitlab_pr_checks,
            gitlab::checks::gitlab_check_details,
            gitlab::checks::gitlab_list_projects,
            gitlab::gitlab_status,
            gitlab::gitlab_set_config,
            gitlab::gitlab_repo,
            gitlab::gitlab_list_work_items,
            gitlab::gitlab_list_todos,
            gitlab::gitlab_work_item_details,
            gitlab::gitlab_work_item_thread,
            gitlab::gitlab_work_item_comment,
            gitlab::gitlab_mr_diff,
            azure_devops::checks::azure_devops_pr_checks,
            azure_devops::checks::azure_devops_check_details,
            azure_devops::checks::azure_devops_list_projects,
            azure_devops::azure_devops_status,
            azure_devops::azure_devops_set_config,
            azure_devops::azure_devops_repo,
            azure_devops::azure_devops_list_work_items,
            azure_devops::azure_devops_list_todos,
            azure_devops::azure_devops_work_item_details,
            azure_devops::azure_devops_work_item_thread,
            azure_devops::azure_devops_work_item_comment,
            azure_devops::azure_devops_mr_diff,
            linear::linear_status,
            linear::linear_set_token,
            linear::linear_list_teams,
            linear::linear_list_issues,
            linear::linear_issue_details,
            linear::linear_issue_thread,
            linear::linear_issue_comment,
            jira::jira_status,
            jira::jira_set_config,
            jira::jira_list_projects,
            jira::jira_list_issues,
            jira::jira_issue_details,
            jira::jira_issue_thread,
            jira::jira_issue_comment,
            jira::board::jira_list_boards,
            jira::board::jira_board_configuration,
            jira::board::jira_board_issues,
            jira::board::jira_issue_transitions,
            jira::board::jira_issue_transition,
            jira::board::jira_board_move,
            jira::board::mobile_board::jira_mobile_boards,
            jira::board::mobile_board::jira_mobile_board_read,
            jira::board::mobile_board::jira_mobile_issue_transitions,
            jira::board::mobile_board::jira_mobile_board_prepare,
            jira::board::mobile_board::jira_mobile_board_commit,
            jira::board::mobile_board::jira_mobile_board_discard_approval,
            link_preview::fetch_link_preview,
            fs::git_branches,
            fs::git_checkout,
            fs::git_create_branch,
            fs::git_stash,
            fs::git_checkout_commit,
            fs::git_create_branch_at,
            fs::git_create_tag,
            fs::git_cherry_pick,
            fs::git_revert,
            fs::git_reset,
            fs::git_operation_state,
            fs::git_operation_abort,
            fs::git_operation_continue,
            fs::git_delete_branch,
            fs::git_rename_branch,
            fs::git_merge,
            fs::git_rebase,
            fs::git_fetch,
            fs::git_trust_repository,
            fs::git_undo_last_commit,
            fs::git_stash_clear,
            fs::git_create_branch_from,
            fs::git_delete_remote_branch,
            fs::git_remotes,
            fs::git_remote_add,
            fs::git_remote_remove,
            fs::git_tags,
            fs::git_delete_tag,
            fs::git_stash_list,
            fs::git_stash_action,
            fs::git_conflicts,
            fs::git_resolve_conflict,
            git_conflicts::git_conflict_stages,
            git_watch::git_watch,
            git_watch::git_unwatch,
            git_watch::git_watch_reset,
            fs::git_file_history,
            fs::git_blame,
            fs::git_commit_message,
            worktrees::git_worktrees,
            git_submodules::git_submodules,
            worktrees::git_worktree_create,
            worktrees::git_orchestration_worktree_create,
            worktrees::git_worktree_rename_branch,
            worktrees::git_worktree_check_remove,
            worktrees::git_worktree_removal_review,
            worktrees::git_worktree_remove,
            worktrees::git_orchestration_worktree_remove,
            worktrees::git_orchestration_branch_remove,
            fs::create_path,
            fs::rename_path,
            fs::delete_path,
            fs::copy_path,
            fs::move_path,
            fs::reveal_path,
            pasteboard::clipboard_file_paths,
            pasteboard::copy_text_to_clipboard,
            pasteboard::clipboard_image,
            pasteboard::copy_file_to_clipboard,
            fs::clone_repo,
            fs::read_file_preview,
            fs::stat_files,
            fs::inspect_paths,
            fs::read_file_base64,
            fs::read_attachment_chunk,
            fs::hash_attachment_prefix,
            fs::read_binary_file,
            fs::read_project_image,
            fs::write_attachment,
            fs::save_generated_image,
            fs::delete_generated_images,
            fs::read_text_file,
            fs::format_text_file,
            fs::omp_session_interjections,
            fs::omp_active_assistant_texts,
            fs::claude_shell_commands,
            fs::write_text_file,
            skills::list_skills,
            skills::skill_policy_get,
            skills::skill_policy_set,
            skills::skill_export,
            skills::skill_delete,
            skills::skill_import,
            claude_commands::list_claude_commands,
            search::search_project,
            search::cancel_project_search,
            cursor_store::cursor_tool_calls,
            cursor_store::cursor_subagent_runs,
            harness::harness_resolve_cursor,
            harness::harness_resolve_codex,
            harness::harness_resolve_opencode,
            harness::harness_resolve_configured,
            harness::harness_runtime_binary_paths,
            harness::harness_resolve_claude,
            harness::claude_mcp_list,
            mcp::mcp_discover,
            mcp::mcp_add,
            harness::claude_mcp_add,
            harness::claude_mcp_remove,
            harness::mcp_provider_login,
            harness::harness_resolve_omp,
            harness::harness_resolve_pi,
            harness::harness_resolve_fx,
            harness::harness_resolve_grok,
            harness::harness_resolve_hermes,
            harness::harness_resolve_antigravity,
            harness::harness_free_port,
            harness::harness_spawn,
            harness::harness_write,
            harness::harness_kill,
            harness::harness_kill_all,
            harness::harness_set_owner,
            harness::harness_http,
            harness::harness_sse_open,
            harness::harness_sse_close,
            harness::harness_exec,
            harness::harness_auth_status,
            harness::harness_prepare_text_workspace,
            harness::harness_read_task_output,
            harness::run_shell_command,
            terminal_profiles::terminal_profiles,
            terminal_profiles::set_terminal_profile,
            harness_updates::harness_latest_version,
            harness_updates::harness_update_check_claim,
            harness_updates::harness_update,
            harness::provider_account_remove,
            account_identity::provider_account_identity,
            provider_terminal_profiles::provider_terminal_profiles,
            provider_terminal_profiles::provider_terminal_profile_connect,
            pi_usage::fetch_pi_usage,
            rate_limits::fetch_claude_usage,
            rate_limits::fetch_claude_usage_once,
            rate_limits::fetch_opencode_go_usage,
            provider_usage::provider_usage_report,
            session_store::usage::session_usage_report,
            provider_usage::provider_model_prices,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_set_visible,
            pty::pty_output_ack,
            pty::pty_output_flow,
            pty::pty_status,
            pty::pty_suggestions,
            pty::pty_kill,
            pty::pty_kill_all,
            session_import::import_discover,
            session_import::import_read_claude,
            session_import::import_read_codex,
            session_import::import_placeholder_dir,
            session_store::session_upsert,
            session_store::incremental::session_apply_delta,
            session_store::incremental::session_get_page,
            session_store::session_import,
            session_store::session_import_keys,
            session_store::session_list_by_project,
            session_store::session_rebase_project,
            session_store::session_list_linked,
            session_store::session_list_recent,
            session_store::session_search,
            session_store::session_search_content,
            session_store::cancel_session_search,
            session_store::session_get,
            session_store::session_delete,
            session_store::session_set_archived,
            session_store::session_set_pinned,
            session_store::session_set_linked_work_item,
            session_store::session_set_queue,
            turn_probe::probe_turn_tail,
            turn_steps::read_turn_steps,
            session_store::session_get_queue,
            session_store::session_set_draft,
            session_store::session_list_drafts,
            session_store::session_attachment_references,
            session_store::session_set_in_flight,
            session_store::session_list_in_flight,
            session_store::session_take_in_flight,
            session_store::workspace_set_snapshot,
            session_store::workspace_get_snapshot,
            notes::notes_list,
            notes::notes_list_summaries,
            notes::notes_search,
            notes::notes_get,
            notes::notes_upsert,
            notes::notes_link_session,
            notes::notes_delete,
            notes::notes_discard_recovery_assets,
            notes::notes_save_image,
            notes::notes_image_path,
            checkpoint::session_checkpoint_ensure,
            trackpad_zoom::set_trackpad_zoom_enabled,
            checkpoint::turn::session_checkpoint_begin_turn,
            checkpoint::turn::session_checkpoint_finish_turn,
            checkpoint::session_checkpoint_prepare,
            checkpoint::session_checkpoint_capture,
            checkpoint::session_checkpoint_status,
            checkpoint::session_checkpoint_apply,
            checkpoint::session_checkpoint_cleanup_safe,
            checkpoint::session_checkpoint_forget,
            checkpoint::session_checkpoint_file_diff,
            checkpoint::session_checkpoint_undo,
            checkpoint::session_checkpoint_keep,
            set_traffic_lights_visible,
            set_window_background_blur,
            set_dock_badge,
            #[cfg(target_os = "macos")]
            menu::keybindings_set_overrides,
            native_language::native_language_set,
            #[cfg(target_os = "macos")]
            menu::autosave_set_enabled,
            open_new_window,
            open_tool_window,
            window::hide_window,
            window::destroy_window,
            window::quit_poll_reply,
            window::quit_decision,
            window::quit_ready,
            window::set_window_glass_enabled,
            window_fullscreen::set_window_fullscreen,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_set_enabled,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_prepare,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_fit,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_submit,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_take,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_ack,
            #[cfg(target_os = "macos")]
            quick_composer::screenshots::quick_composer_release_capture,
            #[cfg(target_os = "macos")]
            quick_composer::quick_composer_capture,
            #[cfg(target_os = "macos")]
            quick_composer::git_popup::quick_git_open,
            #[cfg(target_os = "macos")]
            quick_composer::git_popup::quick_git_state,
            #[cfg(target_os = "macos")]
            quick_composer::git_popup::quick_git_fit,
            #[cfg(target_os = "macos")]
            quick_composer::git_popup::quick_git_complete,
            #[cfg(target_os = "macos")]
            quick_composer::git_popup::quick_composer_dismiss,
            window_transfer::take_window_transfer,
            window_transfer::window_transfer_ready,
            window_transfer::reject_window_transfer,
            window_transfer::move_window_tabs,
            window_transfer::try_relocate_workspace_window,
            window_transfer::preview_window_tab_drag,
            window_transfer::clear_window_tab_drag,
            chat_background::save_chat_background,
            chat_background::remove_chat_background,
            chat_background::save_project_chat_background,
            chat_background::remove_project_chat_background,
            project_logo::save_project_logo,
            project_logo::remove_project_logo,
            project_logo::forget_logo_file,
        ])
        .build(webview_debug_context(debug_profile::context(
            tauri::generate_context!(),
        )))
        .expect("error while building bycoda");

    app.run(|handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            // Utility surfaces can be visible while every workspace is hidden.
            if !window::workspace_windows(handle)
                .iter()
                .any(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
            {
                let _ = window::show_hidden_or_open_new(handle);
            }
        }
        tauri::RunEvent::Ready => {
            #[cfg(target_os = "macos")]
            {
                macos::request_badge_authorization();
                notifications::install_delegate(handle);
                #[cfg(debug_assertions)]
                macos::prefer_bundle_dock_icon();
            }
            window::ensure_launch_window_visible(handle);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Focused(focused),
            ..
        } => {
            if !focused {
                return;
            }
            if let Some(workspace) = window::workspace_windows(handle)
                .into_iter()
                .find(|window| window.label() == label)
            {
                let _ = window::ensure_window_reachable(&workspace);
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            window_transfer::window_closed(handle, &label);
            ssh_window_lifecycle::close(&label);
            handle
                .state::<ssh_forward::SshForwards>()
                .kill_window(&label);
            ssh_sftp::kill_window(&label);
            handle
                .state::<ssh_http_proxy_credentials::HttpProxyCredentials>()
                .close_window(&label);
            handle
                .state::<ssh_execution::SshExecutionReviews>()
                .close_window(&label);
            handle
                .state::<std::sync::Arc<ssh_execution::SshExecutions>>()
                .close_window(&label);
            handle
                .state::<ssh_agent_forwarding::AgentForwardingReviews>()
                .kill_window(&label);
            window::forget_quit_window(handle, &label);
            tray::window_closed(handle, &label);
            let other_window = window::workspace_windows(handle)
                .iter()
                .any(|window| window.label() != label);
            control::window_closed(handle, &label);
            if let Some(state) = handle.try_state::<keep_awake::KeepAwakeState>() {
                state.window_closed(&label);
            }
            if let Some(state) = handle.try_state::<git_watch::GitWatchHost>() {
                state.window_closed(&label);
            }
            if !other_window {
                // Off the event loop: each tree kill waits for its taskkill.
                // Exit joins this reaper, so the children are gone before quit.
                spawn_tracked_reap(handle, reap_harness_children);
            } else {
                // A page unload no longer kills its terminals, because a
                // reload keeps them. The window going away is what ends them.
                // Off the event loop: the reap waits for the shells to die.
                // Shutdown joins it so the shells are dead before we exit.
                if let Some(host) = handle.try_state::<pty::PtyHost>() {
                    let app = handle.clone();
                    host.track_reaper(std::thread::spawn(move || {
                        if let Some(host) = app.try_state::<pty::PtyHost>() {
                            host.kill_window(&label);
                        }
                    }));
                }
            }
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if window::allow_exit() {
                return;
            }
            api.prevent_exit();
            // Last window destroyed (red button). Stay in the dock on macOS;
            // ⌘Q is a separate menu handler and arrives with an exit code.
            // Linux and Windows have no dock, so the last close is a quit.
            if !should_request_quit(code) {
                return;
            }
            window::request_quit(handle);
        }
        tauri::RunEvent::Exit => {
            let _ = native_workspace::retire_buffers(handle);
            ssh_window_lifecycle::shutdown();
            if let Some(state) = handle.try_state::<keep_awake::KeepAwakeState>() {
                state.shutdown();
            }
            ssh_sftp::shutdown();
            handle
                .state::<ssh_http_proxy_credentials::HttpProxyCredentials>()
                .shutdown();
            handle
                .state::<std::sync::Arc<ssh_execution::SshExecutions>>()
                .shutdown();
            handle.state::<ssh_forward::SshForwards>().kill_all();
            handle
                .state::<ssh_agent_forwarding::AgentForwardingReviews>()
                .kill_all();
            handle.state::<remote::RemoteConnections>().shutdown();
            finish_reaping_on_exit(handle);
        }
        _ => {}
    });
}

/// Kills every harness and terminal child. Blocks on taskkill, so callers
/// either run it off the event loop or accept the wait (exit).
fn reap_harness_children(handle: &tauri::AppHandle) {
    if let Some(host) = handle.try_state::<harness::HarnessHost>() {
        host.kill_all();
    }
    if let Some(host) = handle.try_state::<pty::PtyHost>() {
        host.kill_all();
    }
}

/// Runs `work` on a background thread that `PtyHost::join_reapers` waits for
/// at exit, so its kills land before the process ends.
pub(crate) fn spawn_tracked_reap(
    handle: &tauri::AppHandle,
    work: impl FnOnce(&tauri::AppHandle) + Send + 'static,
) {
    let app = handle.clone();
    let reaper = std::thread::spawn(move || work(&app));
    match handle.try_state::<pty::PtyHost>() {
        Some(host) => host.track_reaper(reaper),
        None => drop(reaper),
    }
}

/// Exit must reap children before the process ends, but a wedged taskkill
/// must not hang quit. The kills and the join of background reapers share one
/// deadline; past it the process exits and the OS drops what is left.
fn finish_reaping_on_exit(handle: &tauri::AppHandle) {
    const EXIT_REAP_DEADLINE: std::time::Duration = std::time::Duration::from_secs(3);
    let (done, finished) = std::sync::mpsc::channel();
    let app = handle.clone();
    std::thread::spawn(move || {
        reap_harness_children(&app);
        if let Some(host) = app.try_state::<pty::PtyHost>() {
            host.join_reapers();
        }
        let _ = done.send(());
    });
    let _ = finished.recv_timeout(EXIT_REAP_DEADLINE);
}

#[cfg(all(debug_assertions, target_os = "macos"))]
pub fn ensure_macos_dev_bundle() {
    macos::ensure_dev_bundle();
}

#[cfg(test)]
mod tests {
    use super::{should_request_quit, webview_debug_args, WEBVIEW_DEFAULT_ARGS};

    #[test]
    fn webview_debug_port_is_opt_in_and_keeps_default_arguments() {
        assert_eq!(webview_debug_args(None), None);
        assert_eq!(webview_debug_args(Some("")), None);
        assert_eq!(webview_debug_args(Some("abc")), None);
        assert_eq!(webview_debug_args(Some("80")), None);
        let args = webview_debug_args(Some(" 9222 ")).unwrap();
        assert!(args.starts_with(WEBVIEW_DEFAULT_ARGS));
        assert!(args.ends_with(" --remote-debugging-port=9222"));
    }

    #[test]
    fn explicit_exit_requests_quit() {
        assert!(should_request_quit(Some(0)));
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    #[test]
    fn last_window_close_requests_quit_without_dock() {
        assert!(should_request_quit(None));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn last_window_close_stays_alive_with_dock() {
        assert!(!should_request_quit(None));
    }
}
