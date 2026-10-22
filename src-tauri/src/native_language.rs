//! Application-owned menu labels. OS dialogs and provider output keep their own language.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

#[derive(Default)]
struct NativeLanguage {
    labels: HashMap<String, String>,
    #[cfg(target_os = "macos")]
    originals: HashMap<String, String>,
}
fn state() -> &'static Mutex<NativeLanguage> {
    static STATE: OnceLock<Mutex<NativeLanguage>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(NativeLanguage::default()))
}
#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn label(labels: &HashMap<String, String>, source: &str, name: &str) -> String {
    for prefix in ["Quit", "Show", "Hide", "About"] {
        if source == format!("{prefix} {name}") {
            let key = format!("{prefix} {{p0}}");
            return labels.get(&key).unwrap_or(&key).replace("{p0}", name);
        }
    }
    labels
        .get(source)
        .cloned()
        .unwrap_or_else(|| source.to_owned())
}

#[cfg(target_os = "macos")]
pub fn refresh(app: &AppHandle) -> Result<(), String> {
    use tauri::menu::MenuItemKind;
    fn walk(
        items: Vec<MenuItemKind<tauri::Wry>>,
        state: &mut NativeLanguage,
        name: &str,
    ) -> tauri::Result<()> {
        for item in items {
            let id = item.id().as_ref().to_owned();
            let current = match &item {
                MenuItemKind::MenuItem(item) => item.text()?,
                MenuItemKind::Submenu(item) => item.text()?,
                MenuItemKind::Predefined(item) => item.text()?,
                MenuItemKind::Check(item) => item.text()?,
                MenuItemKind::Icon(item) => item.text()?,
            };
            let source = state.originals.entry(id).or_insert(current);
            let translated = label(&state.labels, source, name);
            match item {
                MenuItemKind::MenuItem(item) => item.set_text(&translated)?,
                MenuItemKind::Submenu(item) => {
                    item.set_text(&translated)?;
                    walk(item.items()?, state, name)?;
                }
                MenuItemKind::Predefined(item) => {
                    if !source.is_empty() {
                        item.set_text(&translated)?;
                    }
                }
                MenuItemKind::Check(item) => item.set_text(&translated)?,
                MenuItemKind::Icon(item) => item.set_text(&translated)?,
            }
        }
        Ok(())
    }
    let mut state = state().lock().map_err(|error| error.to_string())?;
    if let Some(menu) = app.menu() {
        walk(
            menu.items().map_err(|error| error.to_string())?,
            &mut state,
            &app.package_info().name,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn native_language_set(app: AppHandle, labels: HashMap<String, String>) -> Result<(), String> {
    {
        let mut state = state().lock().map_err(|error| error.to_string())?;
        state.labels = labels.clone();
    }
    #[cfg(target_os = "macos")]
    refresh(&app)?;
    #[cfg(target_os = "windows")]
    if let Some(tray) = app.tray_by_id("main") {
        use tauri::menu::{MenuBuilder, MenuItemBuilder};
        let name = &app.package_info().name;
        let show =
            MenuItemBuilder::with_id("tray_show", label(&labels, &format!("Show {name}"), name))
                .build(&app)
                .map_err(|error| error.to_string())?;
        let quit =
            MenuItemBuilder::with_id("tray_quit", label(&labels, &format!("Quit {name}"), name))
                .build(&app)
                .map_err(|error| error.to_string())?;
        let menu = MenuBuilder::new(&app)
            .items(&[&show, &quit])
            .build()
            .map_err(|error| error.to_string())?;
        tray.set_menu(Some(menu))
            .map_err(|error| error.to_string())?;
    }
    let _ = app;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_build_identity_and_unknown_labels() {
        let labels =
            HashMap::from([("Quit {p0}".to_owned(), "{p0} uygulamasından çık".to_owned())]);
        assert_eq!(
            label(&labels, "Quit bycoda Dev", "bycoda Dev"),
            "bycoda Dev uygulamasından çık"
        );
        assert_eq!(label(&labels, "Unknown", "bycoda Dev"), "Unknown");
    }
}
