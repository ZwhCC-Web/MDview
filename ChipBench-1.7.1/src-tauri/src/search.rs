//! Folder scan, bulk read and full-text search feeding the JS index.
use crate::textio::decode;
use crate::util::{err, mtime_ms};
use std::fs;
use walkdir::WalkDir;

/* ---------------------------------------------------------------- folder scan / search / index feed */

pub fn skip_name(n: &str, extra: &[String]) -> bool {
    n.starts_with('.') || n == "node_modules" || n == "target" || n == "__pycache__" || extra.iter().any(|e| e == n)
}

#[derive(serde::Serialize)]
pub struct Scanned {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

/// All files under root whose extension is in `exts` (lower-case, no dot) — feeds the JS search index.
#[tauri::command(async)]
pub fn scan_dir(root: String, exts: Vec<String>, exclude: Option<Vec<String>>) -> Result<Vec<Scanned>, String> {
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
pub struct Doc {
    pub path: String,
    pub text: String,
}

/// Read many text files at once (decoded, size-capped) for indexing.
#[tauri::command(async)]
pub fn read_many(paths: Vec<String>, max_bytes: Option<u64>) -> Vec<Doc> {
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
pub struct Hit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[tauri::command(async)]
pub fn search_dir(roots: Vec<String>, pattern: String, is_regex: bool, case_sensitive: bool, max: usize, exts: Option<Vec<String>>) -> Result<Vec<Hit>, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_name_rules() {
        assert!(skip_name(".git", &[]));
        assert!(skip_name("node_modules", &[]));
        assert!(!skip_name("docs", &[]));
    }
}
