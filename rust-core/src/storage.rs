use crate::{epub, required, CoreResult};
use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

pub fn open(path: &str) -> CoreResult<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch(include_str!("schema.sql"))?;
    Ok(db)
}
const BOOK_QUERY: &str = "SELECT b.id,b.title,b.author,b.file_path,b.file_type,b.cover_path,b.category_id,b.created_at,p.progress_loc,p.updated_at FROM books b LEFT JOIN reading_progress p ON p.book_id=b.id";
fn book_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let progress: Option<String> = row.get(8)?;
    Ok(
        json!({"id":row.get::<_,String>(0)?,"title":row.get::<_,String>(1)?,"author":row.get::<_,String>(2)?,"filePath":row.get::<_,String>(3)?,"fileType":row.get::<_,String>(4)?,"coverPath":row.get::<_,Option<String>>(5)?,"categoryId":row.get::<_,Option<String>>(6)?,"createdAt":row.get::<_,String>(7)?,"progress":progress.and_then(|s| serde_json::from_str::<Value>(&s).ok()),"updatedAt":row.get::<_,Option<String>>(9)?}),
    )
}
pub fn get_book(db: &Connection, id: &str) -> CoreResult<Value> {
    db.query_row(&format!("{BOOK_QUERY} WHERE b.id=?1"), [id], book_row)
        .map_err(Into::into)
}
pub fn library(db: &Connection, query: &str) -> CoreResult<Value> {
    // FTS5 tokenisation is language dependent and treats punctuation as syntax.
    // Library search is a small local catalogue, so a parameterised substring
    // match gives predictable results for Chinese, Latin text, and filenames.
    let mut statement = db.prepare(&format!("{BOOK_QUERY} WHERE ?1='' OR b.title LIKE ?2 ESCAPE '!' OR b.author LIKE ?2 ESCAPE '!' ORDER BY COALESCE(p.updated_at,b.created_at) DESC,b.id"))?;
    let query = query.trim();
    let literal = format!(
        "%{}%",
        query.replace('!', "!!").replace('%', "!%").replace('_', "!_")
    );
    let books = statement
        .query_map(params![query, literal], book_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut categories =
        db.prepare("SELECT id,name FROM categories ORDER BY name COLLATE NOCASE")?;
    let categories = categories
        .query_map([], |r| {
            Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?}))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({"books":books,"categories":categories}))
}
pub fn import(db: &Connection, paths: &[Value]) -> CoreResult<Value> {
    // 仅元数据解析并行；所有 SQLite 写入在串行事务中完成。
    let parsed: Vec<_> = paths.par_iter().map(|value| -> CoreResult<Value> {
        let source = value.as_str().ok_or("无效文件路径")?;
        let path = std::fs::canonicalize(source)?;
        if !path.is_file() { return Err("请选择文件".into()); }
        let kind = match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase().as_str() { "epub" => "epub", "pdf" => "pdf", "md" | "markdown" => "md", _ => return Err("仅支持 EPUB、PDF 和 Markdown".into()) };
        let mut title = path.file_stem().and_then(|s| s.to_str()).unwrap_or("未命名图书").to_owned();
        let mut author = String::new();
        let mut cover: Option<String> = None;
        if kind == "epub" { let meta = epub::metadata(path.to_str().ok_or("无效路径编码")?)?; if !meta.title.is_empty() { title = meta.title; } author = meta.author; cover = meta.cover; }
        Ok(json!({"id":Uuid::new_v4().to_string(),"title":title,"author":author,"filePath":path.to_string_lossy(),"fileType":kind,"coverPath":cover}))
    }).collect();
    let transaction = db.unchecked_transaction()?;
    let mut ids = Vec::new();
    let mut errors = Vec::new();
    for (source, result) in paths.iter().zip(parsed) {
        match result {
            Ok(book) => {
                transaction.execute("INSERT INTO books(id,title,author,file_path,file_type,cover_path) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(file_path) DO NOTHING", params![book["id"].as_str(),book["title"].as_str(),book["author"].as_str(),book["filePath"].as_str(),book["fileType"].as_str(),book["coverPath"].as_str()])?;
                let id: String = transaction.query_row(
                    "SELECT id FROM books WHERE file_path=?1",
                    [book["filePath"].as_str()],
                    |r| r.get(0),
                )?;
                ids.push(id);
            }
            Err(e) => errors.push(json!({"path":source,"message":e.to_string()})),
        }
    }
    transaction.commit()?;
    Ok(json!({"ids":ids,"errors":errors}))
}
pub fn create_category(db: &Connection, name: &str) -> CoreResult<Value> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("分类名须为 1–80 个字符".into());
    }
    let duplicate = db.query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1)", [name], |row| row.get::<_, bool>(0))?;
    if duplicate { return Err("分类已存在".into()); }
    let id = Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO categories(id,name) VALUES (?1,?2)",
        params![id, name],
    )?;
    Ok(json!({"id":id,"name":name}))
}
pub fn update_category(db: &Connection, p: &Value) -> CoreResult<Value> {
    let id = required(p, "id")?;
    let name = p["name"].as_str().ok_or("分类名称须为 1–80 个字符")?.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("分类名称须为 1–80 个字符".into());
    }
    let duplicate = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1 AND id<>?2)",
        params![name, id],
        |row| row.get::<_, bool>(0),
    )?;
    if duplicate { return Err("分类已存在".into()); }
    let changed = db.execute("UPDATE categories SET name=?1 WHERE id=?2", params![name, id])?;
    if changed == 0 { return Err("找不到分类".into()); }
    Ok(json!({"id":id,"name":name}))
}
pub fn delete_category(db: &Connection, id: &str) -> CoreResult<Value> {
    let changed = db.execute("DELETE FROM categories WHERE id=?1", [id])?;
    if changed == 0 { return Err("找不到分类".into()); }
    Ok(json!({"ok":true}))
}
pub fn update_book(db: &Connection, p: &Value) -> CoreResult<Value> {
    let id = required(p, "id")?;
    if let Some(title) = p["title"].as_str() {
        if title.trim().is_empty() {
            return Err("书名不能为空".into());
        }
        db.execute(
            "UPDATE books SET title=?1 WHERE id=?2",
            params![title.trim(), id],
        )?;
    }
    if p.get("categoryId").is_some() {
        db.execute(
            "UPDATE books SET category_id=?1 WHERE id=?2",
            params![p["categoryId"].as_str(), id],
        )?;
    }
    get_book(db, id)
}
pub fn remove_book(db: &Connection, id: &str) -> CoreResult<Value> {
    db.execute("DELETE FROM books WHERE id=?1", [id])?;
    Ok(json!({"ok":true}))
}
pub fn save_progress(db: &Connection, p: &Value) -> CoreResult<Value> {
    let id = required(p, "bookId")?;
    let location = p
        .get("location")
        .filter(|l| l.is_object())
        .ok_or("无效阅读位置")?;
    db.execute("INSERT INTO reading_progress(book_id,progress_loc) VALUES (?1,?2) ON CONFLICT(book_id) DO UPDATE SET progress_loc=excluded.progress_loc,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![id,location.to_string()])?;
    Ok(json!({"ok":true}))
}
pub fn notes(db: &Connection, book_id: &str) -> CoreResult<Value> {
    let mut q = db.prepare("SELECT id,book_id,range_loc,selected_text,color,content,updated_at FROM notes WHERE book_id=?1 ORDER BY updated_at DESC,id")?;
    let result = q.query_map([book_id], |r| Ok(json!({"id":r.get::<_,String>(0)?,"bookId":r.get::<_,String>(1)?,"rangeLoc":r.get::<_,String>(2)?,"selectedText":r.get::<_,String>(3)?,"color":r.get::<_,String>(4)?,"content":r.get::<_,String>(5)?,"updatedAt":r.get::<_,String>(6)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!(result))
}
pub fn save_note(db: &Connection, p: &Value) -> CoreResult<Value> {
    let color = required(p, "color")?;
    if !["coral", "yellow", "blue", "green"].contains(&color) {
        return Err("无效标记颜色".into());
    }
    let id = required(p, "id")?;
    let book_id = required(p, "bookId")?;
    if let Some(owner) = db
        .query_row("SELECT book_id FROM notes WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        })
        .optional()?
    {
        if owner != book_id {
            return Err("笔记不属于此图书".into());
        }
    }
    db.execute("INSERT INTO notes(id,book_id,range_loc,selected_text,color,content) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET range_loc=excluded.range_loc,selected_text=excluded.selected_text,color=excluded.color,content=excluded.content,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')", params![id,book_id,p["rangeLoc"].as_str().unwrap_or(""),p["selectedText"].as_str().unwrap_or(""),color,p["content"].as_str().unwrap_or("")])?;
    Ok(json!({"ok":true}))
}
pub fn delete_note(db: &Connection, id: &str) -> CoreResult<Value> {
    db.execute("DELETE FROM notes WHERE id=?1", [id])?;
    Ok(json!({"ok":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("hondana-db-{}-{stamp}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn persists_search_progress_notes_and_cascades_deletes() {
        let dir = TempDir::new();
        let db = open(dir.path().join("library.sqlite3").to_str().unwrap()).unwrap();
        db.execute("INSERT INTO books(id,title,author,file_path,file_type) VALUES ('book-1','山海拾遗','林青','/books/a.md','md')", []).unwrap();
        db.execute("INSERT INTO books(id,title,author,file_path,file_type) VALUES ('book-2','100% Match','writer_1','/books/b.md','md'),('book-3','under_score','Writer','/books/c.md','md')", []).unwrap();
        let initial = library(&db, "山海").unwrap();
        assert_eq!(initial["books"].as_array().unwrap().len(), 1);
        assert_eq!(initial["books"][0]["title"], "山海拾遗");
        assert_eq!(library(&db, "%").unwrap()["books"].as_array().unwrap().len(), 1);
        assert_eq!(library(&db, "_").unwrap()["books"].as_array().unwrap().len(), 2);
        assert_eq!(library(&db, "writer").unwrap()["books"].as_array().unwrap().len(), 2);
        assert_eq!(library(&db, "  ").unwrap()["books"].as_array().unwrap().len(), 3);

        update_book(&db, &json!({"id":"book-1","title":"海边札记"})).unwrap();
        assert!(library(&db, "山海").unwrap()["books"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(
            library(&db, "海边").unwrap()["books"][0]["title"],
            "海边札记"
        );

        save_progress(
            &db,
            &json!({"bookId":"book-1","location":{"scope":"document","ratio":0.5,"percent":50}}),
        )
        .unwrap();
        let image_range = json!({"scope":"chapter.xhtml","imageMarks":[{"scope":"chapter.xhtml","imageKey":"24:OPS/images/cover.png","strokes":[{"width":0.018,"points":[{"x":0.12,"y":0.3},{"x":0.78,"y":0.66}]}]}]}).to_string();
        save_note(&db, &json!({"id":"note-1","bookId":"book-1","rangeLoc":image_range,"selectedText":"海边","color":"blue","content":"## 札记"})).unwrap();
        assert_eq!(notes(&db, "book-1").unwrap()[0]["content"], "## 札记");
        assert_eq!(notes(&db, "book-1").unwrap()[0]["rangeLoc"], image_range);
        assert!(save_note(
            &db,
            &json!({"id":"note-1","bookId":"other-book","color":"blue"})
        )
        .is_err());
        assert!(save_note(
            &db,
            &json!({"id":"note-2","bookId":"book-1","color":"orange"})
        )
        .is_err());

        remove_book(&db, "book-1").unwrap();
        assert!(notes(&db, "book-1").unwrap().as_array().unwrap().is_empty());
        assert!(library(&db, "海边").unwrap()["books"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM reading_progress", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn category_rename_and_delete_preserve_books_as_uncategorized() {
        let dir = TempDir::new();
        let db = open(dir.path().join("library.sqlite3").to_str().unwrap()).unwrap();
        db.execute("INSERT INTO books(id,title,author,file_path,file_type) VALUES ('book-1','Book','Writer','/books/a.md','md')", []).unwrap();
        let category = create_category(&db, "Reading").unwrap();
        let id = category["id"].as_str().unwrap();
        assert!(create_category(&db, "Reading").is_err());
        update_book(&db, &json!({"id":"book-1","categoryId":id})).unwrap();
        assert_eq!(update_category(&db, &json!({"id":id,"name":" Favorites "})).unwrap()["name"], "Favorites");
        assert!(update_category(&db, &json!({"id":id,"name":"   "})).is_err());
        let other = create_category(&db, "Other").unwrap();
        assert!(update_category(&db, &json!({"id":id,"name":other["name"]})).is_err());
        assert!(update_category(&db, &json!({"id":"missing","name":"Missing"})).is_err());
        save_note(&db, &json!({"id":"note-1","bookId":"book-1","color":"blue","content":"Keep me"})).unwrap();
        save_progress(&db, &json!({"bookId":"book-1","location":{"scope":"document","ratio":0.4,"percent":40}})).unwrap();
        assert_eq!(library(&db, "").unwrap()["books"][0]["categoryId"], id);
        delete_category(&db, id).unwrap();
        assert_eq!(library(&db, "").unwrap()["categories"][0], other);
        assert_eq!(library(&db, "").unwrap()["categories"].as_array().unwrap().len(), 1);
        assert!(library(&db, "").unwrap()["books"][0]["categoryId"].is_null());
        assert_eq!(library(&db, "").unwrap()["books"][0]["progress"]["percent"], 40);
        assert_eq!(notes(&db, "book-1").unwrap()[0]["content"], "Keep me");
        assert!(delete_category(&db, id).is_err());
    }

    #[test]
    fn imports_deduplicate_valid_paths_and_report_bad_files() {
        let dir = TempDir::new();
        let db = open(dir.path().join("library.sqlite3").to_str().unwrap()).unwrap();
        let markdown = dir.path().join("local.md");
        let unsupported = dir.path().join("data.txt");
        std::fs::write(&markdown, "# Hello").unwrap();
        std::fs::write(&unsupported, "text").unwrap();
        let paths = vec![
            json!(markdown.to_string_lossy()),
            json!(markdown.to_string_lossy()),
            json!(unsupported.to_string_lossy()),
        ];
        let result = import(&db, &paths).unwrap();
        assert_eq!(result["ids"].as_array().unwrap().len(), 2);
        assert_eq!(result["ids"][0], result["ids"][1]);
        assert_eq!(result["errors"].as_array().unwrap().len(), 1);
        assert_eq!(
            library(&db, "local").unwrap()["books"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
