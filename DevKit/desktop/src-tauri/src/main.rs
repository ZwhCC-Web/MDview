// MDView desktop shell: Tauri 2 + system WebView2.
// The UI (dist/index.html) is the same single-file MDView used on the web. This Rust side provides
// native file I/O with encoding detection, a file-system watcher, folder search, a link indexer,
// dialogs, file association / single instance, Outlook .eml hand-off and the MCP state bridge.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use encoding_rs::Encoding;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/* ---------------- text files with encoding detection ---------------- */

#[derive(serde::Serialize)]
struct TextFile {
    text: String,
    encoding: String,
}

fn decode(bytes: &[u8]) -> TextFile {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let (cow, _) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        return TextFile { text: cow.into_owned(), encoding: enc.name().to_string() };
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return TextFile { text: s.to_string(), encoding: "UTF-8".into() };
    }
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    let enc = det.guess(None, true);
    let (cow, _, _) = enc.decode(bytes);
    let name = match enc.name() {
        "GBK" | "gb18030" => "GBK",
        n => n,
    };
    TextFile { text: cow.into_owned(), encoding: name.to_string() }
}

#[tauri::command(async)]
fn read_text(path: String) -> Result<TextFile, String> {
    Ok(decode(&fs::read(&path).map_err(err)?))
}

#[tauri::command(async)]
fn read_b64(path: String) -> Result<String, String> {
    Ok(STANDARD.encode(fs::read(&path).map_err(err)?))
}

/// Atomic save: write a temp file next to the target, then rename it over the target.
fn atomic_write(path: &str, data: &[u8]) -> Result<(), String> {
    let tmp = format!("{}.mdview-tmp", path);
    fs::write(&tmp, data).map_err(err)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        // fall back to a direct write (e.g. the file is locked by a sync client)
        fs::write(path, data).map_err(|e2| format!("{e}; {e2}"))?;
    }
    Ok(())
}

/// Write text, optionally re-encoding to a legacy encoding (GBK, Shift_JIS, Big5 ...).
#[tauri::command(async)]
fn write_text(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    match encoding.as_deref() {
        None | Some("") | Some("UTF-8") | Some("utf-8") => atomic_write(&path, content.as_bytes()),
        Some(label) => {
            let enc = Encoding::for_label(label.as_bytes()).ok_or_else(|| format!("未知编码: {label}"))?;
            let (bytes, _, lossy) = enc.encode(&content);
            if lossy {
                return Err(format!("内容中有无法用 {label} 表示的字符，请先转换为 UTF-8（单击状态栏中的编码）"));
            }
            atomic_write(&path, &bytes)
        }
    }
}

#[tauri::command(async)]
fn write_b64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data.as_bytes()).map_err(err)?;
    atomic_write(&path, &bytes)
}

/* ---------------- file system helpers ---------------- */

#[derive(serde::Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command(async)]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut v = Vec::new();
    for e in fs::read_dir(&path).map_err(err)?.flatten() {
        let p = e.path();
        v.push(Entry { name: e.file_name().to_string_lossy().into_owned(), path: p.to_string_lossy().into_owned(), is_dir: p.is_dir() });
    }
    Ok(v)
}

#[tauri::command]
fn path_kind(path: String) -> String {
    let p = Path::new(&path);
    if p.is_dir() {
        "dir".into()
    } else if p.is_file() {
        "file".into()
    } else {
        "none".into()
    }
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
fn remove_path(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        if recursive {
            fs::remove_dir_all(p).map_err(err)
        } else {
            fs::remove_dir(p).map_err(err)
        }
    } else {
        fs::remove_file(p).map_err(err)
    }
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err(format!("目标已存在: {to}"));
    }
    fs::rename(&from, &to).map_err(err)
}

#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let m = fs::metadata(&path).map_err(err)?.modified().map_err(err)?;
    Ok(m.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

/// Paths passed on the command line (file association / "Open with").
#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

/// Write bytes to a file in the temp folder (used for the Outlook .eml draft) and return its path.
#[tauri::command(async)]
fn write_temp(name: String, data: String) -> Result<String, String> {
    let safe: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let dir = std::env::temp_dir().join("MDView");
    fs::create_dir_all(&dir).map_err(err)?;
    let p = dir.join(safe);
    fs::write(&p, STANDARD.decode(data.as_bytes()).map_err(err)?).map_err(err)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/* ---------------- MCP bridge ---------------- */

fn state_file() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join(".mdview").join("state.json")
}

/// Publish the active document / selection for the MCP server's get_active_document tool.
#[tauri::command(async)]
fn set_state(json: String) -> Result<(), String> {
    let p = state_file();
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(err)?;
    }
    atomic_write(&p.to_string_lossy(), json.as_bytes())
}

/// Location of the bundled MCP server script (installed as a Tauri resource).
#[tauri::command]
fn mcp_script_path(app: tauri::AppHandle) -> Result<String, String> {
    let p = app.path().resolve("mcp/mdview_mcp.py", tauri::path::BaseDirectory::Resource).map_err(err)?;
    let s = p.to_string_lossy().into_owned();
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

/* ---------------- file-system watcher ---------------- */

struct WatchState(Mutex<Option<RecommendedWatcher>>);

/// Replace the watch set: folders of the open files (non-recursive) + the open folder (recursive).
/// Changes are pushed to the UI as the "fs-changed" event with the affected paths.
#[tauri::command]
fn watch_set(app: tauri::AppHandle, state: tauri::State<'_, WatchState>, files: Vec<String>, dirs: Vec<String>) -> Result<(), String> {
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
            let paths: Vec<String> = ev.paths.iter().map(|p| p.to_string_lossy().into_owned()).filter(|p| !p.ends_with(".mdview-tmp") && !p.contains(".mdview\\backup") && !p.contains(".mdview/backup")).collect();
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
        // watch the parent folder: many editors (and the MCP server) save by replacing the file
        if let Some(parent) = Path::new(f).parent() {
            if !dirs.iter().any(|d| parent.starts_with(d)) {
                let _ = w.watch(parent, RecursiveMode::NonRecursive);
            }
        }
    }
    *guard = Some(w);
    Ok(())
}

/* ---------------- folder search & link index ---------------- */

fn is_md(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("md") | Some("markdown") | Some("mdown") | Some("mkd") | Some("txt"))
}

fn md_files(root: &str) -> Vec<walkdir::DirEntry> {
    WalkDir::new(root)
        .max_depth(12)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0 || !(n.starts_with('.') || n == "node_modules" || n == "target" || n == "__pycache__")
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_md(e.path()))
        .collect()
}

#[derive(serde::Serialize)]
struct Hit {
    path: String,
    line: usize,
    text: String,
}

#[tauri::command(async)]
fn search_dir(root: String, pattern: String, is_regex: bool, case_sensitive: bool, max: usize) -> Result<Vec<Hit>, String> {
    let pat = if is_regex { pattern } else { regex::escape(&pattern) };
    let re = regex::RegexBuilder::new(&pat).case_insensitive(!case_sensitive).build().map_err(err)?;
    let mut out = Vec::new();
    for e in md_files(&root) {
        let Ok(bytes) = fs::read(e.path()) else { continue };
        if bytes.len() > 20_000_000 {
            continue;
        }
        let text = decode(&bytes).text;
        if !re.is_match(&text) {
            continue;
        }
        let mut n = 0;
        for (i, l) in text.lines().enumerate() {
            if re.is_match(l) {
                out.push(Hit { path: e.path().to_string_lossy().into_owned(), line: i, text: l.chars().take(300).collect() });
                n += 1;
                if n >= 30 || out.len() >= max {
                    break;
                }
            }
        }
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}

#[derive(serde::Serialize)]
struct Link {
    kind: String,
    target: String,
    line: usize,
    text: String,
}

#[derive(serde::Serialize)]
struct FileLinks {
    path: String,
    links: Vec<Link>,
}

/// Extract [[wiki]] links and relative *.md links from every Markdown file under root.
#[tauri::command(async)]
fn scan_links(root: String) -> Result<Vec<FileLinks>, String> {
    let wiki = regex::Regex::new(r"\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]").map_err(err)?;
    let mdl = regex::Regex::new(r#"(?i)\]\(\s*<?([^)>]+?\.(?:md|markdown))(?:#[^)\s]*)?>?(?:\s+["'][^"']*["'])?\s*\)"#).map_err(err)?;
    let mut out = Vec::new();
    for e in md_files(&root) {
        let Ok(bytes) = fs::read(e.path()) else { continue };
        if bytes.len() > 5_000_000 {
            continue;
        }
        let text = decode(&bytes).text;
        let mut links = Vec::new();
        let mut fence = false;
        for (i, l) in text.lines().enumerate() {
            let t = l.trim_start();
            if t.starts_with("```") || t.starts_with("~~~") {
                fence = !fence;
                continue;
            }
            if fence || (!l.contains("[[") && !l.contains("](")) {
                continue;
            }
            for c in wiki.captures_iter(l) {
                links.push(Link { kind: "w".into(), target: c[1].trim().to_string(), line: i, text: l.chars().take(300).collect() });
            }
            for c in mdl.captures_iter(l) {
                let t = &c[1];
                if t.contains("://") {
                    continue;
                }
                links.push(Link { kind: "m".into(), target: t.to_string(), line: i, text: l.chars().take(300).collect() });
            }
        }
        out.push(FileLinks { path: e.path().to_string_lossy().into_owned(), links });
    }
    Ok(out)
}

/* ---------------- dialogs / shell ---------------- */

#[tauri::command(async)]
fn pick_files(app: tauri::AppHandle, multiple: bool) -> Vec<String> {
    let d = app.dialog().file().add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"]);
    if multiple {
        d.blocking_pick_files().unwrap_or_default().into_iter().map(|f| f.to_string()).collect()
    } else {
        d.blocking_pick_file().map(|f| vec![f.to_string()]).unwrap_or_default()
    }
}

#[tauri::command(async)]
fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file().blocking_pick_folder().map(|f| f.to_string())
}

#[tauri::command(async)]
fn save_dialog(app: tauri::AppHandle, name: String, filter: String, ext: String) -> Option<String> {
    app.dialog().file().set_file_name(name).add_filter(filter, &[ext.as_str()]).blocking_save_file().map(|f| f.to_string())
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[tauri::command]
fn reveal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

fn main() {
    tauri::Builder::default()
        // must be the first plugin: a second launch (double-click another .md) is forwarded here
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let _ = app.emit("open-paths", argv);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_text, read_b64, write_text, write_b64, list_dir, path_kind, make_dir, remove_path, rename_path, file_mtime,
            launch_args, write_temp, open_path, set_state, mcp_script_path, watch_set, search_dir, scan_links,
            pick_files, pick_folder, save_dialog, open_url, reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running MDView");
}
