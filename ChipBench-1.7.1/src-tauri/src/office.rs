//! Word / PowerPoint -> PDF through Office COM (PowerShell) with a LibreOffice fallback; results are cached.
use crate::appdata::app_dir;
use crate::util::{err, mtime_ms, silent};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[tauri::command(async)]
pub fn office_to_pdf(path: String) -> Result<String, String> {
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
