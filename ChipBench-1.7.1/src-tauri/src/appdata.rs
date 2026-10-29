//! Application data: data-directory resolution (portable / custom / default), key-value store, MCP state bridge.
use crate::util::{atomic_write, err, home};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

/* ---------- 1.3: data directory ----------
   Resolution order: 1. portable: `data` next to chipbench.exe  2. custom: path in %USERPROFILE%\.chipbench-location
   3. default: %USERPROFILE%\.chipbench.  The MCP server resolves the same way. */
pub fn location_file() -> PathBuf {
    home().join(".chipbench-location")
}

pub fn portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let d = exe.parent()?.join("data");
    if d.is_dir() { Some(d) } else { None }
}

pub fn data_root_info() -> (PathBuf, &'static str) {
    if let Some(d) = portable_dir() {
        return (d, "portable");
    }
    if let Ok(s) = fs::read_to_string(location_file()) {
        let t = s.trim().trim_start_matches('\u{feff}');
        if !t.is_empty() {
            let p = PathBuf::from(t);
            if p.is_dir() || fs::create_dir_all(&p).is_ok() {
                return (p, "custom");
            }
        }
    }
    (home().join(".chipbench"), "default")
}

pub fn data_root() -> PathBuf {
    data_root_info().0
}

/// <data root>[\sub] (created on demand): workspaces, kv store, caches, MCP state.
#[tauri::command(async)]
pub fn app_dir(sub: Option<String>) -> Result<String, String> {
    let (mut p, mode) = data_root_info();
    if mode == "default" && !p.exists() {
        let legacy = home().join(".silica");
        if legacy.is_dir() { let _ = fs::rename(&legacy, &p); }
    }
    if let Some(s) = sub {
        for part in s.split(['/', '\\']) {
            let clean: String = part.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
            if !clean.is_empty() {
                p = p.join(clean);
            }
        }
    }
    fs::create_dir_all(&p).map_err(err)?;
    Ok(p.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
pub struct DataDirInfo { pub path: String, pub mode: String, pub default_path: String }

#[tauri::command(async)]
pub fn data_dir_get() -> DataDirInfo {
    let (p, mode) = data_root_info();
    DataDirInfo { path: p.to_string_lossy().into_owned(), mode: mode.into(), default_path: home().join(".chipbench").to_string_lossy().into_owned() }
}

pub fn copy_tree(from: &Path, to: &Path) -> Result<u64, String> {
    let mut n = 0u64;
    fs::create_dir_all(to).map_err(err)?;
    for e in fs::read_dir(from).map_err(err)? {
        let e = e.map_err(err)?;
        let src = e.path();
        let dst = to.join(e.file_name());
        if e.file_type().map_err(err)?.is_dir() {
            n += copy_tree(&src, &dst)?;
        } else if !dst.exists() {
            fs::copy(&src, &dst).map_err(err)?;
            n += 1;
        }
    }
    Ok(n)
}

/// Point ChipBench at a new data folder (copy = copy current data first; existing target files are kept).
/// Empty path = back to default. Takes effect after restart.
#[tauri::command(async)]
pub fn data_dir_set(path: String, copy: bool) -> Result<u64, String> {
    let (cur, mode) = data_root_info();
    if mode == "portable" {
        return Err("便携模式下数据固定在程序旁的 data 文件夹；如需更改，请先移走该文件夹".into());
    }
    let t = path.trim();
    if t.is_empty() {
        let _ = fs::remove_file(location_file());
        return Ok(0);
    }
    let target = PathBuf::from(t);
    let cur_s = cur.to_string_lossy().to_lowercase();
    let tgt_s = target.to_string_lossy().to_lowercase();
    if tgt_s == cur_s { return Ok(0); }
    if tgt_s.starts_with(&format!("{}\\", cur_s)) || tgt_s.starts_with(&format!("{}/", cur_s)) {
        return Err("新位置不能放在当前数据目录里面".into());
    }
    fs::create_dir_all(&target).map_err(err)?;
    let mut n = 0;
    if copy && cur.is_dir() {
        n = copy_tree(&cur, &target)?;
    }
    atomic_write(&location_file().to_string_lossy(), target.to_string_lossy().as_bytes())?;
    Ok(n)
}

pub fn kv_path(key: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(app_dir(Some("kv".into()))?).join(format!("{}.json", key.replace(['/', '\\', '.', ':'], "_"))))
}

#[tauri::command(async)]
pub fn kv_get(key: String) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(kv_path(&key)?).ok())
}

#[tauri::command(async)]
pub fn kv_set(key: String, value: String) -> Result<(), String> {
    atomic_write(&kv_path(&key)?.to_string_lossy(), value.as_bytes())
}

/// op: status | init | root | commit(arg=message) | log(arg=file or "", n) | show(arg="rev:path") | diff(arg=file or "")
/* ---------------------------------------------------------------- MCP bridge */

pub fn state_file() -> PathBuf {
    let d = data_root();
    let _ = fs::create_dir_all(&d);
    d.join("state.json")
}

static POINTER_AT: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// ~/.chipbench-active.json tells the MCP server where THIS running app keeps its data (portable / custom / default installs differ and a
/// Python script cannot know the exe's folder). Rewritten at most once a minute.
fn write_pointer() {
    let t = now_ms();
    if t.saturating_sub(POINTER_AT.load(Ordering::Relaxed)) < 60_000 {
        return;
    }
    POINTER_AT.store(t, Ordering::Relaxed);
    let body = format!("{{\"data_dir\":\"{}\",\"pid\":{},\"time\":{}}}", json_escape(&data_root().to_string_lossy()), std::process::id(), t);
    let _ = atomic_write(&home().join(".chipbench-active.json").to_string_lossy(), body.as_bytes());
}

#[tauri::command(async)]
pub fn set_state(json: String) -> Result<(), String> {
    write_pointer();
    atomic_write(&state_file().to_string_lossy(), json.as_bytes())
}

#[tauri::command(async)]
pub fn mcp_script_path(app: tauri::AppHandle) -> Result<String, String> {
    let p = app.path().resolve("mcp/chipbench_mcp.py", tauri::path::BaseDirectory::Resource).map_err(err)?;
    let s = p.to_string_lossy().into_owned();
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_escape_handles_windows_paths() {
        assert_eq!(json_escape(r"C:\Users\me\.chipbench"), r"C:\\Users\\me\\.chipbench");
        assert_eq!(json_escape("a\"b"), "a\\\"b");
    }

    #[test]
    fn copy_tree_copies_files_and_keeps_existing_targets() {
        let base = std::env::temp_dir().join(format!("chipbench-test-copy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (from, to) = (base.join("from"), base.join("to"));
        fs::create_dir_all(from.join("n")).unwrap();
        fs::write(from.join("a.txt"), "new").unwrap();
        fs::write(from.join("n").join("b.txt"), "b").unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(to.join("a.txt"), "keep").unwrap();
        let n = copy_tree(&from, &to).unwrap();
        assert_eq!(n, 1, "only b.txt is new");
        assert_eq!(fs::read_to_string(to.join("a.txt")).unwrap(), "keep");
        assert_eq!(fs::read_to_string(to.join("n").join("b.txt")).unwrap(), "b");
        let _ = fs::remove_dir_all(&base);
    }
}
