// ChipBench desktop shell — Tauri 2 + WebView2.
// The UI (app/) is plain HTML/JS. This Rust side provides what a browser cannot: native file I/O with encoding
// detection, a file-system watcher, folder search / indexing, PDF text extraction (cached), GB-scale log access,
// Office → PDF conversion, Git, a global quick-capture hot key, web windows and the MCP state bridge.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use encoding_rs::Encoding;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/* ---------------------------------------------------------------- text files */

#[derive(serde::Serialize)]
struct TextFile {
    text: String,
    encoding: String,
}

fn decode(bytes: &[u8]) -> TextFile {
    if let Some((enc, bom)) = Encoding::for_bom(bytes) {
        let (cow, _) = enc.decode_without_bom_handling(&bytes[bom..]);
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
    if let Some(d) = Path::new(path).parent() {
        let _ = fs::create_dir_all(d);
    }
    let tmp = format!("{}.chipbench-tmp", path);
    fs::write(&tmp, data).map_err(err)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        fs::write(path, data).map_err(|e2| format!("{e}; {e2}"))?; // e.g. locked by a sync client
    }
    Ok(())
}

#[tauri::command(async)]
fn write_text(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    match encoding.as_deref() {
        None | Some("") | Some("UTF-8") | Some("utf-8") => atomic_write(&path, content.as_bytes()),
        Some(label) => {
            let enc = Encoding::for_label(label.as_bytes()).ok_or_else(|| format!("未知编码: {label}"))?;
            let (bytes, _, lossy) = enc.encode(&content);
            if lossy {
                return Err(format!("内容中有无法用 {label} 表示的字符，请先转换为 UTF-8"));
            }
            atomic_write(&path, &bytes)
        }
    }
}

#[tauri::command(async)]
fn write_b64(path: String, data: String) -> Result<(), String> {
    atomic_write(&path, &STANDARD.decode(data.as_bytes()).map_err(err)?)
}

/* ---------------------------------------------------------------- file system */

#[derive(serde::Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    mtime: u64,
}

fn mtime_ms(m: &fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[tauri::command(async)]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut v = Vec::new();
    for e in fs::read_dir(&path).map_err(err)?.flatten() {
        let p = e.path();
        let md = e.metadata().ok();
        v.push(Entry { name: e.file_name().to_string_lossy().into_owned(), path: p.to_string_lossy().into_owned(), is_dir: md.as_ref().map(|m| m.is_dir()).unwrap_or(false), size: md.as_ref().map(|m| m.len()).unwrap_or(0), mtime: md.as_ref().map(mtime_ms).unwrap_or(0) });
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
        (if recursive { fs::remove_dir_all(p) } else { fs::remove_dir(p) }).map_err(err)
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
    Ok(mtime_ms(&fs::metadata(&path).map_err(err)?))
}

#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    Ok(fs::metadata(&path).map_err(err)?.len())
}

#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

/* ---------- 1.3: data directory ----------
   Resolution order: 1. portable: `data` next to chipbench.exe  2. custom: path in %USERPROFILE%\.chipbench-location
   3. default: %USERPROFILE%\.chipbench.  The MCP server resolves the same way. */
fn location_file() -> PathBuf {
    home().join(".chipbench-location")
}

fn portable_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let d = exe.parent()?.join("data");
    if d.is_dir() { Some(d) } else { None }
}

fn data_root_info() -> (PathBuf, &'static str) {
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

fn data_root() -> PathBuf {
    data_root_info().0
}

/// <data root>[\sub] (created on demand): workspaces, kv store, caches, MCP state.
#[tauri::command]
fn app_dir(sub: Option<String>) -> Result<String, String> {
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
struct DataDirInfo { path: String, mode: String, default_path: String }

#[tauri::command]
fn data_dir_get() -> DataDirInfo {
    let (p, mode) = data_root_info();
    DataDirInfo { path: p.to_string_lossy().into_owned(), mode: mode.into(), default_path: home().join(".chipbench").to_string_lossy().into_owned() }
}

fn copy_tree(from: &Path, to: &Path) -> Result<u64, String> {
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
fn data_dir_set(path: String, copy: bool) -> Result<u64, String> {
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

fn kv_path(key: &str) -> Result<PathBuf, String> {
    Ok(PathBuf::from(app_dir(Some("kv".into()))?).join(format!("{}.json", key.replace(['/', '\\', '.', ':'], "_"))))
}

/* ---------- 1.1: secrets (Windows Credential Manager via keyring) ---------- */
#[tauri::command(async)]
fn secret_set(account: String, secret: String) -> Result<(), String> {
    let e = keyring::Entry::new("ChipBench", &account).map_err(|e| e.to_string())?;
    if secret.is_empty() { let _ = e.delete_credential(); return Ok(()); }
    e.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn secret_get(account: String) -> Result<Option<String>, String> {
    let e = keyring::Entry::new("ChipBench", &account).map_err(|e| e.to_string())?;
    match e.get_password() { Ok(s) => Ok(Some(s)), Err(keyring::Error::NoEntry) => Ok(None), Err(x) => Err(x.to_string()) }
}

#[tauri::command(async)]
fn kv_get(key: String) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(kv_path(&key)?).ok())
}

#[tauri::command(async)]
fn kv_set(key: String, value: String) -> Result<(), String> {
    atomic_write(&kv_path(&key)?.to_string_lossy(), value.as_bytes())
}

#[tauri::command(async)]
fn write_temp(name: String, data: String) -> Result<String, String> {
    let safe: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let dir = std::env::temp_dir().join("ChipBench");
    fs::create_dir_all(&dir).map_err(err)?;
    let p = dir.join(safe);
    fs::write(&p, STANDARD.decode(data.as_bytes()).map_err(err)?).map_err(err)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[tauri::command]
fn reveal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

/// Open a web page in its own WebView2 window (side-by-side with the notes).
#[tauri::command]
fn open_web(app: tauri::AppHandle, url: String, title: Option<String>) -> Result<(), String> {
    let u = tauri::Url::parse(&url).map_err(err)?;
    if !matches!(u.scheme(), "http" | "https" | "file") {
        return Err("只能打开 http / https / file 网页".into());
    }
    let label = format!("web-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(u)).title(title.unwrap_or_else(|| "网页".into())).inner_size(1000.0, 800.0).build().map_err(err)?;
    Ok(())
}

/* ---------------------------------------------------------------- dialogs */

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
fn pick_any(app: tauri::AppHandle) -> Vec<String> {
    app.dialog()
        .file()
        .add_filter("资料与笔记", &["md", "markdown", "txt", "pdf", "xlsx", "xlsm", "csv", "tsv", "docx", "pptx", "eml", "msg", "hex", "mot", "srec", "s19", "s28", "s37", "elf", "axf", "out", "abs", "map", "svd", "log", "png", "jpg", "jpeg", "html", "htm", "cbws", "cbboard", "code-workspace", "json", "h", "su"])
        .add_filter("所有文件", &["*"])
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(|f| f.to_string())
        .collect()
}

#[tauri::command(async)]
fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file().blocking_pick_folder().map(|f| f.to_string())
}

#[tauri::command(async)]
fn save_dialog(app: tauri::AppHandle, name: String, filter: String, ext: String, dir: Option<String>) -> Option<String> {
    // 1.3: optional start folder (the workspace's 笔记 folder for new notes)
    let mut d = app.dialog().file().set_file_name(name).add_filter(filter, &[ext.as_str()]);
    if let Some(p) = dir.filter(|p| Path::new(p).is_dir()) { d = d.set_directory(p); }
    d.blocking_save_file().map(|f| f.to_string())
}

/* ---------------------------------------------------------------- watcher */

struct WatchState(Mutex<Option<RecommendedWatcher>>);

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
            let paths: Vec<String> = ev.paths.iter().map(|p| p.to_string_lossy().into_owned()).filter(|p| !p.ends_with(".chipbench-tmp") && !p.contains(".git") && !p.contains(".chipbench\\backup") && !p.contains(".chipbench/backup")).collect();
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

/* ---------------------------------------------------------------- folder scan / search / index feed */

fn skip_name(n: &str, extra: &[String]) -> bool {
    n.starts_with('.') || n == "node_modules" || n == "target" || n == "__pycache__" || extra.iter().any(|e| e == n)
}

#[derive(serde::Serialize)]
struct Scanned {
    path: String,
    size: u64,
    mtime: u64,
}

/// All files under root whose extension is in `exts` (lower-case, no dot) — feeds the JS search index.
#[tauri::command(async)]
fn scan_dir(root: String, exts: Vec<String>, exclude: Option<Vec<String>>) -> Result<Vec<Scanned>, String> {
    let ex = exclude.unwrap_or_default();
    let mut out = Vec::new();
    for e in WalkDir::new(&root).max_depth(14).into_iter().filter_entry(|e| e.depth() == 0 || !skip_name(&e.file_name().to_string_lossy(), &ex)).flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let ext = e.path().extension().and_then(|x| x.to_str()).map(|x| x.to_lowercase()).unwrap_or_default();
        if exts.iter().any(|x| *x == ext) {
            if let Ok(md) = e.metadata() {
                out.push(Scanned { path: e.path().to_string_lossy().into_owned(), size: md.len(), mtime: mtime_ms(&md) });
            }
        }
    }
    Ok(out)
}

#[derive(serde::Serialize)]
struct Doc {
    path: String,
    text: String,
}

/// Read many text files at once (decoded, size-capped) for indexing.
#[tauri::command(async)]
fn read_many(paths: Vec<String>, max_bytes: Option<u64>) -> Vec<Doc> {
    let cap = max_bytes.unwrap_or(2_000_000);
    paths.into_iter().filter_map(|p| {
        let md = fs::metadata(&p).ok()?;
        if md.len() > cap {
            return None;
        }
        Some(Doc { text: decode(&fs::read(&p).ok()?).text, path: p })
    }).collect()
}

#[derive(serde::Serialize)]
struct Hit {
    path: String,
    line: usize,
    text: String,
}

#[tauri::command(async)]
fn search_dir(roots: Vec<String>, pattern: String, is_regex: bool, case_sensitive: bool, max: usize, exts: Option<Vec<String>>) -> Result<Vec<Hit>, String> {
    let pat = if is_regex { pattern } else { regex::escape(&pattern) };
    let re = regex::RegexBuilder::new(&pat).case_insensitive(!case_sensitive).build().map_err(err)?;
    let exts = exts.unwrap_or_else(|| vec!["md".into(), "markdown".into(), "txt".into()]);
    let mut out = Vec::new();
    'outer: for root in roots {
        for e in WalkDir::new(&root).max_depth(14).into_iter().filter_entry(|e| e.depth() == 0 || !skip_name(&e.file_name().to_string_lossy(), &[])).flatten() {
            if !e.file_type().is_file() {
                continue;
            }
            let ext = e.path().extension().and_then(|x| x.to_str()).map(|x| x.to_lowercase()).unwrap_or_default();
            if !exts.iter().any(|x| *x == ext) {
                continue;
            }
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
                break 'outer;
            }
        }
    }
    Ok(out)
}

/* ---------------------------------------------------------------- PDF text (memory + disk cache) */

struct PdfCache(Mutex<Vec<(String, Arc<Vec<String>>)>>);

fn pdf_pages(app: &tauri::AppHandle, path: &str) -> Result<Arc<Vec<String>>, String> {
    let md = fs::metadata(path).map_err(err)?;
    let key = format!("{}|{}|{}", path.to_lowercase(), mtime_ms(&md), md.len());
    let state = app.state::<PdfCache>();
    if let Some((_, v)) = state.0.lock().map_err(err)?.iter().find(|(k, _)| *k == key) {
        return Ok(v.clone());
    }
    let mut h: u64 = 1469598103934665603;
    for b in key.as_bytes() {
        h = (h ^ *b as u64).wrapping_mul(1099511628211);
    }
    let disk = PathBuf::from(app_dir(Some("cache/pdf".into()))?).join(format!("{h:016x}.json"));
    let pages: Vec<String> = match fs::read_to_string(&disk).ok().and_then(|s| serde_json::from_str(&s).ok()) {
        Some(v) => v,
        None => {
            let bytes = fs::read(path).map_err(err)?;
            let v = pdf_extract::extract_text_from_mem_by_pages(&bytes).map_err(err)?;
            let _ = fs::write(&disk, serde_json::to_string(&v).unwrap_or_default());
            v
        }
    };
    let arc = Arc::new(pages);
    let mut c = state.0.lock().map_err(err)?;
    c.push((key, arc.clone()));
    if c.len() > 4 {
        c.remove(0);
    }
    Ok(arc)
}

#[tauri::command(async)]
fn pdf_text(app: tauri::AppHandle, path: String, from: usize, to: usize) -> Result<BTreeMap<usize, String>, String> {
    let pages = pdf_pages(&app, &path)?;
    let a = from.max(1);
    let b = to.min(pages.len());
    let mut out = BTreeMap::new();
    for p in a..=b.max(a) {
        if let Some(t) = pages.get(p - 1) {
            out.insert(p, t.clone());
        }
    }
    if out.is_empty() {
        return Err(format!("页码超出范围（共 {} 页）", pages.len()));
    }
    Ok(out)
}

#[tauri::command(async)]
fn pdf_page_count(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    Ok(pdf_pages(&app, &path)?.len())
}

/* ---------------------------------------------------------------- GB-scale logs: sparse line index */

#[derive(Clone)]
struct LogIdx {
    key: String,
    bytes: u64,
    lines: u64,
    marks: Vec<u64>,
}
struct LogCache(Mutex<Vec<LogIdx>>);
const LOG_STEP: u64 = 256;

fn log_build(app: &tauri::AppHandle, path: &str) -> Result<LogIdx, String> {
    let md = fs::metadata(path).map_err(err)?;
    let key = format!("{}|{}|{}", path.to_lowercase(), mtime_ms(&md), md.len());
    let st = app.state::<LogCache>();
    if let Some(i) = st.0.lock().map_err(err)?.iter().find(|i| i.key == key) {
        return Ok(i.clone());
    }
    let mut f = std::io::BufReader::with_capacity(1 << 20, fs::File::open(path).map_err(err)?);
    let mut buf = vec![0u8; 1 << 20];
    let (mut off, mut lines, mut marks) = (0u64, 0u64, vec![0u64]);
    let mut last = b'\n';
    loop {
        let n = f.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        for (i, b) in buf[..n].iter().enumerate() {
            if *b == b'\n' {
                lines += 1;
                if lines % LOG_STEP == 0 {
                    marks.push(off + i as u64 + 1);
                }
            }
        }
        last = buf[n - 1];
        off += n as u64;
    }
    if off > 0 && last != b'\n' {
        lines += 1;
    }
    let idx = LogIdx { key, bytes: off, lines, marks };
    let mut c = st.0.lock().map_err(err)?;
    c.push(idx.clone());
    if c.len() > 3 {
        c.remove(0);
    }
    Ok(idx)
}

#[derive(serde::Serialize)]
struct LogInfo {
    bytes: u64,
    lines: u64,
}

#[tauri::command(async)]
fn log_index(app: tauri::AppHandle, path: String) -> Result<LogInfo, String> {
    let i = log_build(&app, &path)?;
    Ok(LogInfo { bytes: i.bytes, lines: i.lines })
}

#[tauri::command(async)]
fn log_lines(app: tauri::AppHandle, path: String, start: u64, count: u64) -> Result<Vec<String>, String> {
    let i = log_build(&app, &path)?;
    let m = (start / LOG_STEP) as usize;
    let mut f = std::io::BufReader::new(fs::File::open(&path).map_err(err)?);
    f.seek(SeekFrom::Start(*i.marks.get(m).unwrap_or(&0))).map_err(err)?;
    let mut ln = m as u64 * LOG_STEP;
    let mut out = Vec::with_capacity(count.min(2000) as usize);
    let mut buf = Vec::new();
    while ln < start + count.min(2000) {
        buf.clear();
        if f.read_until(b'\n', &mut buf).map_err(err)? == 0 {
            break;
        }
        if ln >= start {
            out.push(String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).chars().take(4000).collect());
        }
        ln += 1;
    }
    Ok(out)
}

#[derive(serde::Serialize)]
struct LogHit {
    line: u64,
    text: String,
}

#[tauri::command(async)]
fn log_grep(path: String, pattern: String, max: usize) -> Result<Vec<LogHit>, String> {
    let re = regex::RegexBuilder::new(&pattern).case_insensitive(true).build().map_err(err)?;
    let mut f = std::io::BufReader::with_capacity(1 << 20, fs::File::open(&path).map_err(err)?);
    let (mut out, mut buf, mut ln) = (Vec::new(), Vec::new(), 0u64);
    loop {
        buf.clear();
        if f.read_until(b'\n', &mut buf).map_err(err)? == 0 {
            break;
        }
        let s = String::from_utf8_lossy(&buf);
        if re.is_match(&s) {
            out.push(LogHit { line: ln, text: s.trim_end_matches(['\r', '\n']).chars().take(2000).collect() });
            if out.len() >= max {
                break;
            }
        }
        ln += 1;
    }
    Ok(out)
}

/* ---------------------------------------------------------------- Office → PDF (cached) */

fn silent(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

#[tauri::command(async)]
fn office_to_pdf(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let md = fs::metadata(&src).map_err(err)?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "doc".into());
    let out_dir = PathBuf::from(app_dir(Some("cache/office".into()))?);
    let out = out_dir.join(format!("{}-{:x}.pdf", stem, mtime_ms(&md) ^ md.len()));
    if out.exists() {
        return Ok(out.to_string_lossy().into_owned());
    }
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let esc = |p: &Path| p.to_string_lossy().replace('\'', "''");
    let script = if ext.starts_with("ppt") {
        format!("$a=New-Object -ComObject PowerPoint.Application;$p=$a.Presentations.Open('{}',$true,$false,$false);$p.SaveAs('{}',32);$p.Close();$a.Quit()", esc(&src), esc(&out))
    } else {
        format!("$a=New-Object -ComObject Word.Application;$a.Visible=$false;$d=$a.Documents.Open('{}',$false,$true);$d.ExportAsFixedFormat('{}',17);$d.Close($false);$a.Quit()", esc(&src), esc(&out))
    };
    let ok = silent(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script])).output().map(|o| o.status.success()).unwrap_or(false);
    if !ok || !out.exists() {
        let lo = silent(Command::new("soffice").args(["--headless", "--convert-to", "pdf", "--outdir"]).arg(&out_dir).arg(&src)).output();
        let produced = out_dir.join(format!("{stem}.pdf"));
        if lo.map(|o| !o.status.success()).unwrap_or(true) || !produced.exists() {
            return Err("需要本机安装 Microsoft Office 或 LibreOffice".into());
        }
        fs::rename(&produced, &out).map_err(err)?;
    }
    Ok(out.to_string_lossy().into_owned())
}

/* ---------------------------------------------------------------- Git (uses the git CLI if installed) */

fn git(dir: &str, args: &[&str]) -> Result<String, String> {
    let o = silent(Command::new("git").args(["-c", "core.quotepath=false", "-C", dir]).args(args)).output().map_err(|_| "未安装 Git（https://git-scm.com）".to_string())?;
    let s = String::from_utf8_lossy(&o.stdout).into_owned();
    if o.status.success() {
        Ok(s)
    } else {
        Err(format!("{}{}", s, String::from_utf8_lossy(&o.stderr)))
    }
}

/// op: status | init | root | commit(arg=message) | log(arg=file or "", n) | show(arg="rev:path") | diff(arg=file or "")
#[tauri::command(async)]
fn git_cmd(dir: String, op: String, arg: Option<String>, n: Option<u32>) -> Result<String, String> {
    let a = arg.unwrap_or_default();
    match op.as_str() {
        "status" => git(&dir, &["status", "--porcelain"]),
        "init" => git(&dir, &["init"]),
        "root" => git(&dir, &["rev-parse", "--show-toplevel"]).map(|s| s.trim().to_string()),
        "commit" => {
            git(&dir, &["add", "-A"])?;
            let msg = if a.is_empty() { "ChipBench snapshot".to_string() } else { a };
            git(&dir, &["-c", "user.name=ChipBench", "-c", "user.email=chipbench@localhost", "commit", "-m", msg.as_str()])
        }
        "log" => {
            let ns = format!("-n{}", n.unwrap_or(50));
            let mut args: Vec<&str> = vec!["log", ns.as_str(), "--pretty=format:%h%x1f%ad%x1f%s", "--date=format:%Y-%m-%d %H:%M"];
            if !a.is_empty() {
                args.push("--");
                args.push(a.as_str());
            }
            git(&dir, &args)
        }
        "show" => {
            if a.contains("..") || a.starts_with('-') {
                return Err("非法参数".into());
            }
            git(&dir, &["show", a.as_str()])
        }
        "diff" => {
            if a.is_empty() { git(&dir, &["diff", "--stat"]) } else { git(&dir, &["diff", "--", a.as_str()]) }
        }
        _ => Err("不支持的 Git 操作".into()),
    }
}

/* ---------------------------------------------------------------- MCP bridge */

fn state_file() -> PathBuf {
    let d = data_root();
    let _ = fs::create_dir_all(&d);
    d.join("state.json")
}

#[tauri::command(async)]
fn set_state(json: String) -> Result<(), String> {
    atomic_write(&state_file().to_string_lossy(), json.as_bytes())
}

#[tauri::command]
fn mcp_script_path(app: tauri::AppHandle) -> Result<String, String> {
    let p = app.path().resolve("mcp/chipbench_mcp.py", tauri::path::BaseDirectory::Resource).map_err(err)?;
    let s = p.to_string_lossy().into_owned();
    Ok(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

/* ---------------------------------------------------------------- app */

fn main() {
    tauri::Builder::default()
        // must be the first plugin: a second launch (double-click another file) is forwarded here
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("quick-capture", ());
                    }
                })
                .build(),
        )
        .manage(WatchState(Mutex::new(None)))
        .manage(PdfCache(Mutex::new(Vec::new())))
        .manage(LogCache(Mutex::new(Vec::new())))
        .setup(|app| {
            // Ctrl+Alt+Space → quick capture (ignored if another program already owns the key)
            let sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
            let _ = app.global_shortcut().register(sc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text, read_b64, write_text, write_b64, list_dir, path_kind, make_dir, remove_path, rename_path, file_mtime, file_size, launch_args,
            app_dir, kv_get, kv_set, write_temp, open_path, open_url, reveal, open_web, pick_files, pick_any, pick_folder, save_dialog, watch_set,
            scan_dir, read_many, search_dir, pdf_text, pdf_page_count, log_index, log_lines, log_grep, office_to_pdf, git_cmd, set_state, mcp_script_path, secret_set, secret_get, data_dir_get, data_dir_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChipBench");
}
