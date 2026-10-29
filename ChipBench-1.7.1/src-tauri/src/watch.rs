//! File-system watcher -> `fs-changed` events.
use crate::util::err;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/* ---------------------------------------------------------------- watcher */

pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

/// Paths the UI never needs to hear about: git / ChipBench bookkeeping folders (matched as whole path components - a folder merely
/// containing ".git" in its name, like "notes.gitbook" or ".github", is NOT ignored; 1.6.1 used a substring test and swallowed those),
/// temp files and Office lock files.
pub fn ignored(p: &Path) -> bool {
    if p.components().any(|c| {
        let n = c.as_os_str();
        n == ".git" || n == ".chipbench"
    }) {
        return true;
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    name.ends_with(".chipbench-tmp") || name.ends_with(".tmp") || name.starts_with("~$")
}

#[tauri::command(async)]
pub fn watch_set(app: tauri::AppHandle, files: Vec<String>, dirs: Vec<String>) -> Result<(), String> {
    // 1.6: off the UI thread; state taken from the app handle
    let state = app.state::<WatchState>();
    let mut guard = state.0.lock().map_err(err)?;
    *guard = None;
    if files.is_empty() && dirs.is_empty() {
        return Ok(());
    }
    let handle = app.clone();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            let paths: Vec<String> = ev.paths.iter().filter(|p| !ignored(p)).map(|p| p.to_string_lossy().into_owned()).collect();
            if !paths.is_empty() {
                let _ = handle.emit("fs-changed", paths);
            }
        }
    })
    .map_err(err)?;
    for d in &dirs {
        let _ = w.watch(Path::new(d), RecursiveMode::Recursive);
    }
    for f in &files {
        if let Some(parent) = Path::new(f).parent() {
            if !dirs.iter().any(|d| parent.starts_with(d)) {
                let _ = w.watch(parent, RecursiveMode::NonRecursive);
            }
        }
    }
    *guard = Some(w);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bookkeeping_paths_are_ignored() {
        assert!(ignored(Path::new("D:/p/.git/index")));
        assert!(ignored(Path::new("D:/p/.chipbench/backup/a.md.bak")));
        assert!(ignored(Path::new("D:/p/a.md.chipbench-tmp")));
        assert!(ignored(Path::new("D:/p/~$report.docx")));
        assert!(ignored(Path::new("D:/p/x.tmp")));
    }

    #[test]
    fn look_alike_names_are_not_ignored() {
        assert!(!ignored(Path::new("D:/p/notes.gitbook/a.md")));
        assert!(!ignored(Path::new("D:/p/.github/workflows/b.yml")));
        assert!(!ignored(Path::new("D:/p/a.md")));
    }
}
