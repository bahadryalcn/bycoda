//! Window glass on Windows. WebView2 composites a transparent window on the CPU
//! for every frame, so the main window is created opaque unless the user keeps
//! Window glass on. The saved choice lives in `window-glass.json` and decides how
//! the next launch creates the window; the frontend sends it on every sync, with
//! the opaque page colour that the same file keeps so an opaque launch does not
//! flash black before the page paints.

#[cfg(any(target_os = "windows", test))]
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

use crate::window::Rgb;

const FILE_NAME: &str = "window-glass.json";
const MAIN_LABEL: &str = "main";
static CREATED_TRANSPARENT: OnceLock<bool> = OnceLock::new();

#[derive(Serialize, Deserialize)]
struct Stored {
    enabled: bool,
    /// Read leniently (raw JSON) so a malformed colour never drops `enabled`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background: Option<serde_json::Value>,
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, PartialEq, Eq)]
pub struct GlassPlan {
    /// A backdrop effect and a clear background: only possible on a transparent window.
    pub glass: bool,
    /// The requested glass state is in effect now.
    pub applied: bool,
    /// The saved preference differs from how this window was created.
    pub restart_required: bool,
}

#[cfg(any(target_os = "windows", test))]
/// `enabled` is this sync's effective state (dark mode and the setting);
/// `preference` is the saved Window glass setting; `transparent` is how the
/// window was created this launch.
pub fn glass_plan(enabled: bool, preference: bool, transparent: bool) -> GlassPlan {
    GlassPlan {
        glass: enabled && transparent,
        applied: !enabled || transparent,
        restart_required: preference != transparent,
    }
}

#[cfg(any(target_os = "windows", test))]
/// First Windows 11 build; the system backdrop (Mica) API needs it.
const WINDOWS_11_BUILD: u32 = 22000;

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum GlassEffect {
    Mica,
    Acrylic,
}

#[cfg(any(target_os = "windows", test))]
/// Mica samples the wallpaper once; Acrylic re-blurs the backdrop every frame,
/// which keeps the GPU and CPU busy while content streams. Windows 10 has no Mica.
fn glass_effect(build: u32) -> GlassEffect {
    if build >= WINDOWS_11_BUILD {
        GlassEffect::Mica
    } else {
        GlassEffect::Acrylic
    }
}

/// Windows build number from `RtlGetVersion`, which unlike `GetVersionEx` is not
/// shimmed by manifests. Zero when the call fails, which selects Acrylic.
#[cfg(target_os = "windows")]
fn windows_build() -> u32 {
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
    }

    // SAFETY: `info` is a zeroed OSVERSIONINFOW with its size field set, which is
    // all RtlGetVersion requires; it only writes within that struct.
    unsafe {
        let mut info: OSVERSIONINFOW = std::mem::zeroed();
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        if RtlGetVersion(&mut info) == 0 {
            info.dwBuildNumber
        } else {
            0
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGlassOutcome {
    applied: bool,
    restart_required: bool,
}

/// `%APPDATA%\<identifier>\window-glass.json`.
fn flag_path(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join(identifier).join(FILE_NAME))
}

fn read_stored(path: &Path) -> Option<Stored> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Stored>(&text).ok())
}

/// A missing or unreadable file means opaque, the cheap default.
fn read_flag(path: &Path) -> bool {
    read_stored(path).is_some_and(|stored| stored.enabled)
}

/// The opaque page colour the last sync saved; None when missing or malformed.
fn read_background(path: &Path) -> Option<Rgb> {
    read_stored(path)?
        .background
        .and_then(|value| serde_json::from_value::<Rgb>(value).ok())
}

#[cfg(any(target_os = "windows", test))]
fn write_flag(path: &Path, enabled: bool, background: Rgb) -> Result<(), String> {
    let dir = path.parent().ok_or("Window glass folder is unavailable")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let stored = Stored {
        enabled,
        background: Some(serde_json::to_value(background).map_err(|e| e.to_string())?),
    };
    let body = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&temp).map_err(|e| format!("{}: {e}", temp.display()))?;
    file.write_all(body.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("{}: {e}", temp.display()))?;
    std::fs::rename(&temp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The opaque `main` window's creation colour: the page colour saved by the last
/// sync, so the launch matches the app instead of the config's black. A glass
/// (transparent) window keeps the config value, and so does a launch with no
/// saved colour yet.
pub fn creation_background(transparent: bool, saved: Option<Rgb>) -> Option<Rgb> {
    if transparent {
        None
    } else {
        saved
    }
}

/// Chooses the `main` window's transparency from the saved flag before the app
/// is built. Other platforms keep the config value; the JSON configs keep
/// `transparent: true` and this runtime decision overrides it on Windows only.
pub fn apply_to_context(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    if cfg!(windows) {
        let path = flag_path(&context.config().identifier);
        let transparent = path.as_deref().is_some_and(read_flag);
        let page = creation_background(transparent, path.as_deref().and_then(read_background));
        for window in &mut context.config_mut().app.windows {
            if window.label == MAIN_LABEL {
                window.transparent = transparent;
                if let Some(Rgb { r, g, b }) = page {
                    window.background_color = Some(tauri::utils::config::Color(r, g, b, 255));
                }
            }
        }
        let _ = CREATED_TRANSPARENT.set(transparent);
    }
    context
}

/// Whether the main window was created transparent this launch.
pub fn created_transparent() -> bool {
    CREATED_TRANSPARENT.get().copied().unwrap_or(false)
}

/// Host tools windows follow the main window on Windows; other platforms stay transparent.
pub fn tools_window_transparent() -> bool {
    !cfg!(windows) || created_transparent()
}

/// Desktop blur goes on after the first UI paint and only in dark mode.
#[tauri::command]
pub fn set_window_glass_enabled(
    window: WebviewWindow,
    enabled: bool,
    background: Rgb,
    preference: Option<bool>,
) -> Result<WindowGlassOutcome, String> {
    #[cfg(target_os = "windows")]
    return apply_windows(&window, enabled, preference.unwrap_or(enabled), background);

    #[cfg(not(target_os = "windows"))]
    {
        let _ = preference;
        #[cfg(target_os = "macos")]
        {
            if crate::macos::ns_window(&window).is_none() {
                return Err("Native window is unavailable".into());
            }
            if enabled {
                window
                    .set_background_color(Some(tauri::window::Color(0, 0, 0, 3)))
                    .map_err(|e| e.to_string())?;
                crate::macos::enable_glass(&window);
            } else {
                crate::macos::disable_glass(&window, background.r, background.g, background.b);
            }
        }
        #[cfg(target_os = "linux")]
        {
            // No system blur API on Linux: transparency only. The compositor
            // (e.g. Mutter) blends the translucent CSS glass over the desktop.
            window
                .set_background_color(Some(if enabled {
                    tauri::window::Color(0, 0, 0, 0)
                } else {
                    background.fill()
                }))
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = (window, enabled, background);
        }
        Ok(WindowGlassOutcome {
            applied: true,
            restart_required: false,
        })
    }
}

#[cfg(target_os = "windows")]
fn apply_windows(
    window: &WebviewWindow,
    enabled: bool,
    preference: bool,
    background: Rgb,
) -> Result<WindowGlassOutcome, String> {
    use tauri::window::{Color, Effect, EffectsBuilder};
    use tauri::Manager;

    let identifier = window.app_handle().config().identifier.clone();
    let path = flag_path(&identifier).ok_or("Window glass folder is unavailable")?;
    write_flag(&path, preference, background)?;

    let plan = glass_plan(enabled, preference, created_transparent());
    if plan.glass {
        window
            .set_background_color(Some(Color(0, 0, 0, 0)))
            .map_err(|e| e.to_string())?;
        // Glass is only enabled in dark mode, so Mica is always the dark variant.
        let preferred = match glass_effect(windows_build()) {
            GlassEffect::Mica => Effect::MicaDark,
            GlassEffect::Acrylic => Effect::Acrylic,
        };
        let set = |effect| window.set_effects(EffectsBuilder::new().effect(effect).build());
        if set(preferred).is_err() {
            let fallback = preferred != Effect::Acrylic && set(Effect::Acrylic).is_ok();
            if !fallback {
                // The window stays transparent with no backdrop effect.
                window.set_effects(None).map_err(|e| e.to_string())?;
            }
        }
    } else {
        window.set_effects(None).map_err(|e| e.to_string())?;
        window
            .set_background_color(Some(background.fill()))
            .map_err(|e| e.to_string())?;
    }
    Ok(WindowGlassOutcome {
        applied: plan.applied,
        restart_required: plan.restart_required,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bycoda-glass-{name}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_flag_file_means_opaque() {
        let dir = temp_dir("missing");
        assert!(!read_flag(&dir.join(FILE_NAME)));
    }

    #[test]
    fn enabled_flag_file_means_transparent() {
        let dir = temp_dir("enabled");
        std::fs::write(dir.join(FILE_NAME), r#"{"enabled":true}"#).unwrap();
        assert!(read_flag(&dir.join(FILE_NAME)));
    }

    #[test]
    fn invalid_flag_file_means_opaque() {
        let dir = temp_dir("invalid");
        std::fs::write(dir.join(FILE_NAME), "{not json").unwrap();
        assert!(!read_flag(&dir.join(FILE_NAME)));
        std::fs::write(dir.join(FILE_NAME), r#"{"enabled":"yes"}"#).unwrap();
        assert!(!read_flag(&dir.join(FILE_NAME)));
    }

    #[test]
    fn written_flag_round_trips_and_replaces_previous_value() {
        let dir = temp_dir("round-trip");
        let path = dir.join(FILE_NAME);
        write_flag(&path, true, PAGE).unwrap();
        assert!(read_flag(&path));
        write_flag(&path, false, PAGE).unwrap();
        assert!(!read_flag(&path));
        assert!(!dir.join("window-glass.json.tmp").exists());
    }

    const PAGE: Rgb = Rgb { r: 12, g: 14, b: 18 };

    #[test]
    fn saved_page_colour_survives_and_a_bad_one_keeps_the_flag() {
        let dir = temp_dir("page-colour");
        let path = dir.join(FILE_NAME);
        write_flag(&path, true, Rgb { r: 250, g: 249, b: 246 }).unwrap();
        let saved = read_background(&path).unwrap();
        assert_eq!((saved.r, saved.g, saved.b), (250, 249, 246));
        assert!(read_flag(&path));

        std::fs::write(&path, r#"{"enabled":true,"background":{"r":"x"}}"#).unwrap();
        assert!(read_background(&path).is_none());
        assert!(read_flag(&path));
    }

    #[test]
    fn creation_colour_is_the_saved_page_only_when_opaque() {
        let saved = Some(PAGE);
        assert!(creation_background(true, saved).is_none());
        let opaque = creation_background(false, saved).unwrap();
        assert_eq!((opaque.r, opaque.g, opaque.b), (12, 14, 18));
        assert!(creation_background(false, None).is_none());
    }

    #[test]
    fn restart_decision_table() {
        // (enabled, preference, created transparent) -> (glass, applied, restart)
        let cases = [
            ((true, true, true), (true, true, false)),
            ((true, true, false), (false, false, true)),
            ((false, false, true), (false, true, true)),
            ((false, false, false), (false, true, false)),
        ];
        for ((enabled, preference, transparent), (glass, applied, restart)) in cases {
            assert_eq!(
                glass_plan(enabled, preference, transparent),
                GlassPlan {
                    glass,
                    applied,
                    restart_required: restart,
                },
                "enabled={enabled} preference={preference} transparent={transparent}"
            );
        }
    }

    #[test]
    fn mica_needs_windows_11() {
        assert_eq!(glass_effect(0), GlassEffect::Acrylic);
        assert_eq!(glass_effect(19045), GlassEffect::Acrylic);
        assert_eq!(glass_effect(21999), GlassEffect::Acrylic);
        assert_eq!(glass_effect(22000), GlassEffect::Mica);
        assert_eq!(glass_effect(26200), GlassEffect::Mica);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_build_is_detected() {
        assert!(windows_build() >= 10240);
    }

    #[test]
    fn light_mode_does_not_change_the_restart_need() {
        // Light mode sends enabled=false while the saved preference stays on.
        let plan = glass_plan(false, true, true);
        assert!(!plan.restart_required && plan.applied && !plan.glass);
    }
}
