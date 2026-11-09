use super::device::*;

#[test]
fn channel_follows_build_and_version() {
    assert_eq!(channel_for("0.7.5", false), "stable");
    assert_eq!(channel_for("0.7.5-preview.3", false), "preview");
    assert_eq!(channel_for("0.7.5-preview.3", true), "dev");
}

#[test]
fn reads_os_names_from_system_files() {
    let plist = "<dict><key>ProductName</key><string>macOS</string>\n<key>ProductVersion</key>\n<string>15.1</string></dict>";
    assert_eq!(parse_macos_plist(plist).as_deref(), Some("macOS 15.1"));
    assert_eq!(parse_macos_plist("<dict/>"), None);
    assert_eq!(
        parse_os_release("NAME=Ubuntu\nPRETTY_NAME=\"Ubuntu 24.04 LTS\"\n").as_deref(),
        Some("Ubuntu 24.04 LTS")
    );
    assert_eq!(parse_os_release("NAME=x\n"), None);
}

#[test]
fn current_device_fits_the_registration_limits() {
    let device = current();
    assert!(!device.name.is_empty() && device.name.chars().count() <= 80);
    assert!(device.os_version.chars().count() <= 64);
    assert!(device.app_version.chars().count() <= 32);
    assert!(["windows", "macos", "linux"].contains(&device.platform));
}
