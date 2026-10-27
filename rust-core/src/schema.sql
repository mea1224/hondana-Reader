PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS books(
 id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL DEFAULT '',
 file_path TEXT NOT NULL UNIQUE,file_type TEXT NOT NULL CHECK(file_type IN ('epub','pdf','md')),
 cover_path TEXT,category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS reading_progress(
 book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,progress_loc TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS notes(
 id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
 range_loc TEXT NOT NULL,selected_text TEXT NOT NULL,color TEXT NOT NULL,content TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS notes_book ON notes(book_id);
CREATE VIRTUAL TABLE IF NOT EXISTS library_search USING fts5(book_id UNINDEXED,title,author);
CREATE TRIGGER IF NOT EXISTS books_insert AFTER INSERT ON books BEGIN
 INSERT INTO library_search(book_id,title,author) VALUES (new.id,new.title,new.author);
END;
CREATE TRIGGER IF NOT EXISTS books_update AFTER UPDATE OF title,author ON books BEGIN
 DELETE FROM library_search WHERE book_id=old.id;
 INSERT INTO library_search(book_id,title,author) VALUES (new.id,new.title,new.author);
END;
CREATE TRIGGER IF NOT EXISTS books_delete AFTER DELETE ON books BEGIN
 DELETE FROM library_search WHERE book_id=old.id;
END;
PRAGMA user_version=1;
