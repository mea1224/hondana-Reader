mod epub;
mod html_entities;
mod storage;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use pdfium_render::prelude::*;
use serde_json::{json, Value};
use std::{io::Cursor, path::Path};

pub(crate) type CoreResult<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn pdfium(directory: &str) -> CoreResult<Pdfium> {
    let bindings = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(directory))
        .or_else(|_| Pdfium::bind_to_system_library())
        .map_err(|e| {
            format!("PDFium 未就绪。请将本平台的 PDFium 动态库放入 resources/pdfium：{e}")
        })?;
    Ok(Pdfium::new(bindings))
}

fn execute(db_path: &str, operation: &str, payload: Value) -> CoreResult<Value> {
    let db = storage::open(db_path)?;
    match operation {
        "library" => storage::library(&db, payload["query"].as_str().unwrap_or("")),
        "import" => storage::import(&db, payload["paths"].as_array().ok_or("缺少导入路径")?),
        "category:create" => storage::create_category(&db, payload["name"].as_str().unwrap_or("")),
        "category:update" => storage::update_category(&db, &payload),
        "category:delete" => storage::delete_category(&db, required(&payload, "id")?),
        "book:update" => storage::update_book(&db, &payload),
        "book:remove" => storage::remove_book(&db, required(&payload, "id")?),
        "progress:save" => storage::save_progress(&db, &payload),
        "notes:list" => storage::notes(&db, required(&payload, "bookId")?),
        "note:save" => storage::save_note(&db, &payload),
        "note:delete" => storage::delete_note(&db, required(&payload, "id")?),
        "book:open" => {
            let book = storage::get_book(&db, required(&payload, "id")?)?;
            let path = required(&book, "filePath")?;
            match required(&book, "fileType")? {
                "md" => {
                    let metadata = std::fs::metadata(path)?;
                    if metadata.len() > 32 * 1024 * 1024 {
                        return Err("Markdown 文件超过首版 32 MB 限制".into());
                    }
                    Ok(
                        json!({"kind":"md", "markdown":std::fs::read_to_string(path)?, "toc":[], "chapters":[], "pageCount":1}),
                    )
                }
                "epub" => epub::open(path),
                "pdf" => {
                    let pdf = pdfium(payload["pdfiumDir"].as_str().unwrap_or(""))?;
                    let document = pdf.load_pdf_from_file(path, None)?;
                    Ok(
                        json!({"kind":"pdf","toc":[],"chapters":[],"pageCount":document.pages().len()}),
                    )
                }
                _ => Err("不支持的文件类型".into()),
            }
        }
        "chapter" => {
            let book = storage::get_book(&db, required(&payload, "id")?)?;
            epub::chapter(required(&book, "filePath")?, required(&payload, "path")?)
        }
        _ => Err(format!("未知操作：{operation}").into()),
    }
}

pub(crate) fn required<'a>(payload: &'a Value, key: &str) -> CoreResult<&'a str> {
    payload[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("缺少字段：{key}").into())
}

#[napi]
pub fn dispatch(db_path: String, operation: String, payload: String) -> Result<String> {
    let result = (|| {
        let value = serde_json::from_str(&payload)?;
        execute(&db_path, &operation, value)
    })();
    result
        .and_then(|v| Ok(serde_json::to_string(&v)?))
        .map_err(|e| Error::from_reason(e.to_string()))
}

// Rust Vec 的所有权交给 Node Buffer；Worker -> 主进程仍有消息传输成本。
#[napi]
pub fn read_resource(db_path: String, book_id: String, resource_path: String) -> Result<Buffer> {
    (|| -> CoreResult<Vec<u8>> {
        let db = storage::open(&db_path)?;
        let book = storage::get_book(&db, &book_id)?;
        if required(&book, "fileType")? != "epub" {
            return Err("该图书不包含 EPUB 资源".into());
        }
        epub::resource(
            required(&book, "filePath")?,
            &resource_path,
            32 * 1024 * 1024,
        )
    })()
    .map(Buffer::from)
    .map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn render_pdf(
    db_path: String,
    book_id: String,
    page: u32,
    width: u32,
    pdfium_dir: String,
) -> Result<Buffer> {
    (|| -> CoreResult<Vec<u8>> {
        let db = storage::open(&db_path)?;
        let book = storage::get_book(&db, &book_id)?;
        if required(&book, "fileType")? != "pdf" {
            return Err("不是 PDF 文件".into());
        }
        let pdf = pdfium(&pdfium_dir)?;
        let document = pdf.load_pdf_from_file(Path::new(required(&book, "filePath")?), None)?;
        if page >= document.pages().len() as u32 {
            return Err("PDF 页码超出范围".into());
        }
        let page = document.pages().get(page as u16)?;
        let render_config = PdfRenderConfig::new()
            .set_target_width(width.clamp(200, 1800) as i32)
            .set_maximum_height(2600);
        let bitmap = page.render_with_config(&render_config)?;
        let mut output = Cursor::new(Vec::new());
        bitmap
            .as_image()
            .write_to(&mut output, image::ImageFormat::Png)?;
        Ok(output.into_inner())
    })()
    .map(Buffer::from)
    .map_err(|e| Error::from_reason(e.to_string()))
}
