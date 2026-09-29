/// Desktop (Windows/macOS/Linux) shell for Health Tracker.
///
/// The whole app is the same React + TypeScript build that ships to Android
/// and the web; Tauri only provides the window. That is deliberate: one
/// codebase, one set of reminders logic, three surfaces.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Health Tracker");
}
