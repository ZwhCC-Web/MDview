//! System integration: opener (file / URL / reveal), web windows, native dialogs.
use crate::util::err;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command(async)]
pub fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

#[tauri::command(async)]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener().open_url(url, None::<&str>).map_err(err)
}

#[tauri::command(async)]
pub fn reveal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(path).map_err(err)
}

/// Open a web page in its own WebView2 window (side-by-side with the notes).
#[tauri::command(async)]
pub fn open_web(app: tauri::AppHandle, url: String, title: Option<String>) -> Result<(), String> {
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
pub fn pick_files(app: tauri::AppHandle, multiple: bool) -> Vec<String> {
    let d = app.dialog().file().add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"]);
    if multiple {
        d.blocking_pick_files().unwrap_or_default().into_iter().map(|f| f.to_string()).collect()
    } else {
        d.blocking_pick_file().map(|f| vec![f.to_string()]).unwrap_or_default()
    }
}

#[tauri::command(async)]
pub fn pick_any(app: tauri::AppHandle) -> Vec<String> {
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
pub fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file().blocking_pick_folder().map(|f| f.to_string())
}

#[tauri::command(async)]
pub fn save_dialog(app: tauri::AppHandle, name: String, filter: String, ext: String, dir: Option<String>) -> Option<String> {
    // 1.3: optional start folder (the workspace's 笔记 folder for new notes)
    let mut d = app.dialog().file().set_file_name(name).add_filter(filter, &[ext.as_str()]);
    if let Some(p) = dir.filter(|p| Path::new(p).is_dir()) { d = d.set_directory(p); }
    d.blocking_save_file().map(|f| f.to_string())
}
