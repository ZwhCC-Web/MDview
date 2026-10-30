//! File-system commands: listing, kinds, mkdir / remove / rename, mtime / size, temp files, launch arguments.
use crate::util::{err, mtime_ms};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::path::Path;

/* ---------------------------------------------------------------- file system */

#[derive(serde::Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: u64,
}

#[tauri::command(async)]
pub fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut v = Vec::new();
    for e in fs::read_dir(&path).map_err(err)?.flatten() {
        let p = e.path();
        let md = e.metadata().ok();
        v.push(Entry { name: e.file_name().to_string_lossy().into_owned(), path: p.to_string_lossy().into_owned(), is_dir: md.as_ref().map(|m| m.is_dir()).unwrap_or(false), size: md.as_ref().map(|m| m.len()).unwrap_or(0), mtime: md.as_ref().map(mtime_ms).unwrap_or(0) });
    }
    Ok(v)
}

#[tauri::command(async)]
pub fn path_kind(path: String) -> String {
    let p = Path::new(&path);
    if p.is_dir() {
        "dir".into()
    } else if p.is_file() {
        "file".into()
    } else {
        "none".into()
    }
}

#[tauri::command(async)]
pub fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command(async)]
pub fn remove_path(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        (if recursive { fs::remove_dir_all(p) } else { fs::remove_dir(p) }).map_err(err)
    } else {
        fs::remove_file(p).map_err(err)
    }
}

#[tauri::command(async)]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err(format!("目标已存在: {to}"));
    }
    fs::rename(&from, &to).map_err(err)
}

#[tauri::command(async)]
pub fn file_mtime(path: String) -> Result<u64, String> {
    Ok(mtime_ms(&fs::metadata(&path).map_err(err)?))
}

#[tauri::command(async)]
pub fn file_size(path: String) -> Result<u64, String> {
    Ok(fs::metadata(&path).map_err(err)?.len())
}

#[tauri::command(async)]
pub fn launch_args() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

#[tauri::command(async)]
pub fn write_temp(name: String, data: String) -> Result<String, String> {
    let safe: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let dir = std::env::temp_dir().join("ChipBench");
    fs::create_dir_all(&dir).map_err(err)?;
    let p = dir.join(safe);
    fs::write(&p, STANDARD.decode(data.as_bytes()).map_err(err)?).map_err(err)?;
    Ok(p.to_string_lossy().into_owned())
}
