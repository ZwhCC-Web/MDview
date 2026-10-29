// ChipBench desktop shell — Tauri 2 + WebView2.
// The UI (app/) is plain HTML/JS. This Rust side provides what a browser cannot: native file I/O with encoding detection, a file-system
// watcher, folder search / indexing, PDF text extraction (cached), GB-scale log access, Office -> PDF conversion, a global quick-capture
// hot key, web windows and the MCP state bridge.
//
// 1.7: the former 800-line main.rs is split by responsibility (see docs/ARCHITECTURE.md, "Rust 外壳模块"):
//   util     error mapping, mtime, atomic replace, hidden child processes      textio   text / binary I/O + encoding detection
//   fsops    list / kind / mkdir / remove / rename / temp files                appdata  data directory, key-value store, MCP state + pointer
//   system   opener, web windows, dialogs                                      watch    file watcher (path-component filter)
//   search   scan / bulk read / full-text search                               pdf      PDF text cache
//   logs     GB-scale log index                                                office   Office -> PDF
//   mcp      Python detection, MCP self-test, AI-client config paths
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appdata;
mod fsops;
mod logs;
mod mcp;
mod office;
mod pdf;
mod search;
mod system;
mod textio;
mod util;
mod watch;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
        .manage(watch::WatchState(Mutex::new(None)))
        .manage(pdf::PdfCache(Mutex::new(Vec::new())))
        .manage(logs::LogCache(Mutex::new(Vec::new())))
        .setup(|app| {
            // Ctrl+Alt+Space → quick capture (ignored if another program already owns the key)
            let sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
            let _ = app.global_shortcut().register(sc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            textio::read_text, textio::read_bytes, textio::read_b64, textio::write_text, textio::write_b64,
            fsops::list_dir, fsops::path_kind, fsops::make_dir, fsops::remove_path, fsops::rename_path, fsops::file_mtime, fsops::file_size, fsops::launch_args, fsops::write_temp,
            appdata::app_dir, appdata::kv_get, appdata::kv_set, appdata::set_state, appdata::mcp_script_path, appdata::data_dir_get, appdata::data_dir_set,
            system::open_path, system::open_url, system::reveal, system::open_web, system::pick_files, system::pick_any, system::pick_folder, system::save_dialog,
            watch::watch_set,
            search::scan_dir, search::read_many, search::search_dir,
            pdf::pdf_text, pdf::pdf_page_count,
            logs::log_index, logs::log_lines, logs::log_grep,
            office::office_to_pdf,
            mcp::detect_python, mcp::mcp_selftest, mcp::mcp_clients
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChipBench");
}
