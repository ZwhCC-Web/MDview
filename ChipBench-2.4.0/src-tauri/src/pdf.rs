//! PDF text extraction with a memory + disk cache (search and the MCP `read_pdf_pages` tool).
use crate::appdata::app_dir;
use crate::util::{err, mtime_ms};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/* ---------------------------------------------------------------- PDF text (memory + disk cache) */

pub struct PdfCache(pub Mutex<Vec<(String, Arc<Vec<String>>)>>);

pub fn pdf_pages(app: &tauri::AppHandle, path: &str) -> Result<Arc<Vec<String>>, String> {
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
pub fn pdf_text(app: tauri::AppHandle, path: String, from: usize, to: usize) -> Result<BTreeMap<usize, String>, String> {
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
pub fn pdf_page_count(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    Ok(pdf_pages(&app, &path)?.len())
}
