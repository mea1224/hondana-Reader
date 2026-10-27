use crate::CoreResult;
use roxmltree::{Document, Node, ParsingOptions};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
};
use zip::ZipArchive;

pub struct Metadata {
    pub title: String,
    pub author: String,
    pub cover: Option<String>,
}
#[derive(Clone)]
struct Item {
    href: String,
    media: String,
    properties: String,
}
struct Package {
    metadata: Metadata,
    items: HashMap<String, Item>,
    spine: Vec<String>,
    ncx: Option<String>,
}

// EPUB 常见的 XHTML/OPF 会带外部 DOCTYPE。roxmltree 不会加载外部实体；打开 DTD
// 支持声明及内部实体，并限制节点数量，避免拒绝标准书籍。
fn parse_xml<'a>(source: &'a str) -> CoreResult<Document<'a>> {
    Ok(Document::parse_with_options(
        source,
        ParsingOptions {
            allow_dtd: true,
            nodes_limit: 500_000,
        },
    )?)
}

fn decode_uri_path(value: &str) -> CoreResult<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("EPUB 资源路径编码无效".into());
            }
            let high = (bytes[i + 1] as char).to_digit(16);
            let low = (bytes[i + 2] as char).to_digit(16);
            match (high, low) {
                (Some(high), Some(low)) => output.push((high * 16 + low) as u8),
                _ => return Err("EPUB 资源路径编码无效".into()),
            }
            i += 3;
        } else {
            output.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(output)?;
    if decoded.contains('\0') || decoded.contains('\\') || decoded.contains(':') {
        return Err("EPUB 资源路径无效".into());
    }
    Ok(decoded)
}

fn expand_xhtml_entities(source: &str) -> String {
    let declared_entities: HashSet<String> = source
        .match_indices("<!ENTITY")
        .filter_map(|(start, _)| {
            let rest = &source[start + "<!ENTITY".len()..];
            let mut words = rest.split_whitespace();
            let first = words.next()?;
            let name = if first == "%" { words.next()? } else { first };
            let name = name.trim_matches(|ch: char| {
                !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-' && ch != ':'
            });
            (!name.is_empty()).then(|| name.to_owned())
        })
        .collect();

    fn replace_refs(value: &str, declared_entities: &HashSet<String>) -> String {
        let mut output = String::with_capacity(value.len());
        let mut cursor = 0;
        while cursor < value.len() {
            let Some(relative) = value[cursor..].find('&') else {
                output.push_str(&value[cursor..]);
                break;
            };
            let start = cursor + relative;
            output.push_str(&value[cursor..start]);
            let Some(end_relative) = value[start..].find(';') else {
                output.push_str(&value[start..]);
                break;
            };
            let end = start + end_relative;
            let name = &value[start + 1..end];
            if declared_entities.contains(name) {
                output.push_str(&value[start..=end]);
            } else if let Ok(index) = crate::html_entities::XHTML_ENTITIES
                .binary_search_by_key(&name, |(entity, _)| *entity)
            {
                output.push_str(crate::html_entities::XHTML_ENTITIES[index].1);
            } else if name.starts_with('#') || matches!(name, "amp" | "lt" | "gt" | "apos" | "quot")
            {
                output.push_str(&value[start..=end]);
            } else {
                // An external XHTML DTD is not fetched. Preserve unknown
                // references as visible text so they cannot abort the chapter.
                output.push_str("&amp;");
                output.push_str(name);
                output.push(';');
            }
            cursor = end + 1;
        }
        output
    }

    let mut output = String::with_capacity(source.len());
    let mut cursor = 0;
    while cursor < source.len() {
        let rest = &source[cursor..];
        if rest.starts_with("<!--") || rest.starts_with("<![CDATA[") || rest.starts_with("<?") {
            let end_marker = if rest.starts_with("<!--") {
                "-->"
            } else if rest.starts_with("<![CDATA[") {
                concat!("]]", ">")
            } else {
                "?>"
            };
            if let Some(end) = rest.find(end_marker) {
                let end = cursor + end + end_marker.len();
                output.push_str(&source[cursor..end]);
                cursor = end;
                continue;
            }
            output.push_str(rest);
            break;
        }
        if rest.starts_with("<!DOCTYPE") {
            let mut quote = None;
            let mut subset_depth = 0usize;
            let mut end = None;
            for (offset, ch) in rest.char_indices().skip("<!DOCTYPE".len()) {
                if let Some(q) = quote {
                    if ch == q {
                        quote = None;
                    }
                    continue;
                }
                match ch {
                    '\'' | '"' => quote = Some(ch),
                    '[' => subset_depth += 1,
                    ']' => subset_depth = subset_depth.saturating_sub(1),
                    '>' if subset_depth == 0 => {
                        end = Some(offset + ch.len_utf8());
                        break;
                    }
                    _ => {}
                }
            }
            if let Some(length) = end {
                let end = cursor + length;
                output.push_str(&source[cursor..end]);
                cursor = end;
                continue;
            }
            output.push_str(rest);
            break;
        }
        if rest.starts_with('<') {
            let mut quote = None;
            let mut end = None;
            for (offset, ch) in rest.char_indices().skip(1) {
                if let Some(q) = quote {
                    if ch == q {
                        quote = None;
                    }
                    continue;
                }
                match ch {
                    '\'' | '"' => quote = Some(ch),
                    '>' => {
                        end = Some(offset + ch.len_utf8());
                        break;
                    }
                    _ => {}
                }
            }
            if let Some(length) = end {
                let end = cursor + length;
                output.push_str(&replace_refs(&source[cursor..end], &declared_entities));
                cursor = end;
                continue;
            }
        }
        let end = rest
            .find('<')
            .map(|offset| cursor + offset.max(1))
            .unwrap_or(source.len());
        output.push_str(&replace_refs(&source[cursor..end], &declared_entities));
        cursor = end;
    }
    output
}

// 不向文件系统解压；拒绝越过归档根目录及异常压缩包。
pub fn resolve(base: &str, href: &str) -> CoreResult<String> {
    if href.contains('\\') || href.contains('\0') || href.contains(':') || href.starts_with('/') {
        return Err("EPUB 资源路径无效".into());
    }
    let mut parts: Vec<&str> = base
        .rsplit_once('/')
        .map(|(d, _)| d.split('/').collect())
        .unwrap_or_default();
    for p in href.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop().ok_or("EPUB 资源路径超出归档范围")?;
            }
            _ => parts.push(p),
        }
    }
    Ok(parts.join("/"))
}
// Resolve an EPUB URI exactly once. ZIP entry names and already resolved chapter
// paths must go through resolve(), so a literal '%' in a filename stays intact.
fn resolve_uri(base: &str, uri: &str) -> CoreResult<String> {
    resolve(base, &decode_uri_path(uri)?)
}
fn encode_uri_path(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            output.push(byte as char);
        } else {
            output.push('%');
            output.push_str(&format!("{byte:02X}"));
        }
    }
    output
}
pub fn resource(path: &str, name: &str, limit: u64) -> CoreResult<Vec<u8>> {
    let name = resolve("", name)?;
    let mut zip = ZipArchive::new(File::open(path)?)?;
    if zip.len() > 100_000 {
        return Err("EPUB 包含过多文件".into());
    }
    let file = zip.by_name(&name)?;
    if file.size() > limit {
        return Err("EPUB 单资源超过大小限制".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err("EPUB 资源超过大小限制".into());
    }
    Ok(bytes)
}
fn text(path: &str, name: &str) -> CoreResult<String> {
    Ok(expand_xhtml_entities(&String::from_utf8(resource(
        path,
        name,
        8 * 1024 * 1024,
    )?)?))
}
fn package(path: &str) -> CoreResult<Package> {
    let container = text(path, "META-INF/container.xml")?;
    let doc = parse_xml(&container)?;
    let root = doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or("EPUB 缺少 OPF 路径")?;
    let root = resolve_uri("", root)?;
    let opf = text(path, &root)?;
    let doc = parse_xml(&opf)?;
    let title = doc
        .descendants()
        .find(|n| n.has_tag_name("title"))
        .and_then(|n| n.text())
        .unwrap_or("")
        .trim()
        .to_owned();
    let author = doc
        .descendants()
        .filter(|n| n.has_tag_name("creator"))
        .filter_map(|n| n.text())
        .collect::<Vec<_>>()
        .join(" / ");
    let mut items = HashMap::new();
    for n in doc.descendants().filter(|n| n.has_tag_name("item")) {
        if let (Some(id), Some(href)) = (n.attribute("id"), n.attribute("href")) {
            items.insert(
                id.to_owned(),
                Item {
                    href: resolve_uri(&root, href)?,
                    media: n.attribute("media-type").unwrap_or("").to_owned(),
                    properties: n.attribute("properties").unwrap_or("").to_owned(),
                },
            );
        }
    }
    let cover_id = doc
        .descendants()
        .find(|n| n.has_tag_name("meta") && n.attribute("name") == Some("cover"))
        .and_then(|n| n.attribute("content"));
    let cover = items
        .values()
        .find(|i| i.properties.split_whitespace().any(|p| p == "cover-image"))
        .or_else(|| cover_id.and_then(|id| items.get(id)))
        .filter(|i| i.media.starts_with("image/"))
        .map(|i| i.href.clone());
    let spine = doc
        .descendants()
        .filter(|n| n.has_tag_name("itemref") && n.attribute("linear") != Some("no"))
        .filter_map(|n| n.attribute("idref").map(str::to_owned))
        .collect();
    let ncx = doc
        .descendants()
        .find(|n| n.has_tag_name("spine"))
        .and_then(|n| n.attribute("toc"))
        .and_then(|id| items.get(id))
        .map(|i| i.href.clone());
    Ok(Package {
        metadata: Metadata {
            title,
            author,
            cover,
        },
        items,
        spine,
        ncx,
    })
}
pub fn metadata(path: &str) -> CoreResult<Metadata> {
    Ok(package(path)?.metadata)
}
fn node_text(n: Node<'_, '_>) -> String {
    n.descendants()
        .filter_map(|n| if n.is_text() { n.text() } else { None })
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_owned()
}

// Keep ruby text out of the ordinary Markdown stream.  A ruby annotation is
// represented by a private, hex-encoded marker and reconstructed as semantic
// HTML in the renderer.  Hex encoding keeps arbitrary EPUB Unicode text and
// Markdown punctuation from changing the marker's structure.
fn ruby_hex(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn ruby_marker(base: &str, reading: &str) -> String {
    format!("\u{27e6}r:{}:{}\u{27e7}", ruby_hex(base), ruby_hex(reading))
}

fn ruby_plain_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter_map(|child| {
            if !child.is_text() {
                return None;
            }
            let inside_annotation = child.ancestors().any(|ancestor| {
                ancestor != node
                    && ancestor.is_element()
                    && matches!(ancestor.tag_name().name(), "rt" | "rtc" | "rp")
            });
            (!inside_annotation).then(|| child.text().unwrap_or(""))
        })
        .collect::<Vec<_>>()
        .join("")
}

fn inline_ruby(node: Node<'_, '_>) -> String {
    let mut output = String::new();
    let mut base = String::new();

    for child in node.children() {
        if child.is_text() {
            base.push_str(child.text().unwrap_or(""));
            continue;
        }
        if !child.is_element() {
            continue;
        }
        match child.tag_name().name() {
            // Parentheses supplied by EPUBs are only a fallback for browsers
            // without ruby support; the reader provides native ruby layout.
            "rp" => {}
            "rt" | "rtc" => {
                let reading = if child.tag_name().name() == "rtc" {
                    child
                        .descendants()
                        .filter(|annotation| annotation.has_tag_name("rt"))
                        .map(node_text)
                        .filter(|part| !part.trim().is_empty())
                        .collect::<Vec<_>>()
                        .join("・")
                } else {
                    ruby_plain_text(child)
                };
                let base_text = base.trim();
                let reading = reading.trim();
                if !base_text.is_empty() && !reading.is_empty() {
                    output.push_str(&ruby_marker(base_text, reading));
                    base.clear();
                } else {
                    output.push_str(reading);
                }
            }
            "rb" => base.push_str(&ruby_plain_text(child)),
            _ => base.push_str(&ruby_plain_text(child)),
        }
    }

    output.push_str(&base);
    output
}

fn markdown_image(base: &str, node: Node<'_, '_>) -> String {
    let source = node
        .attributes()
        .find(|attribute| attribute.name() == "src" || attribute.name() == "href")
        .map(|attribute| attribute.value());
    let Some(source) = source.filter(|value| !value.trim().is_empty()) else {
        return String::new();
    };
    // Remote and data URLs are deliberately ignored. EPUB images must stay inside
    // the archive so the renderer cannot turn an EPUB into a network fetcher.
    if source.starts_with("data:") || source.starts_with("#") || source.contains("://") {
        return String::new();
    }
    let source = source.split(['?', '#']).next().unwrap_or(source);
    let Ok(path) = resolve_uri(base, source) else {
        return String::new();
    };
    let alt = node
        .attribute("alt")
        .or_else(|| node.attribute("title"))
        .unwrap_or("图片")
        .replace('\\', "\\\\")
        .replace('[', "(")
        .replace(']', ")")
        .replace(['\n', '\r'], " ")
        .trim()
        .to_owned();
    format!("![{alt}](<epub-resource:{}>)", encode_uri_path(&path))
}

fn inline_markdown(node: Node<'_, '_>, base: &str) -> String {
    if node.is_text() {
        return node.text().unwrap_or("").to_owned();
    }
    if !node.is_element() {
        return String::new();
    }
    if node.tag_name().name() == "ruby" {
        return inline_ruby(node);
    }
    if matches!(node.tag_name().name(), "img" | "image") {
        return markdown_image(base, node);
    }
    if node.tag_name().name() == "br" {
        return "\n".to_owned();
    }
    node.children()
        .map(|child| inline_markdown(child, base))
        .collect::<Vec<_>>()
        .join("")
}

fn block_markdown(node: Node<'_, '_>, base: &str) -> String {
    if node.tag_name().name() == "figure" {
        return node
            .children()
            .map(|child| inline_markdown(child, base).trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
    }
    inline_markdown(node, base).trim().to_owned()
}
fn href(base: &str, target: &str) -> CoreResult<String> {
    let (file, fragment) = target.split_once('#').unwrap_or((target, ""));
    let file = file.split('?').next().unwrap_or(file);
    let result = if file.is_empty() {
        base.to_owned()
    } else {
        resolve_uri(base, file)?
    };
    Ok(if fragment.is_empty() {
        result
    } else {
        format!("{result}#{fragment}")
    })
}
fn nav_list(list: Node<'_, '_>, base: &str) -> Vec<Value> {
    list.children().filter(|n| n.has_tag_name("li")).filter_map(|li| {
        let anchor = li.children().find(|n|n.has_tag_name("a") || n.has_tag_name("span"))?;
        let children = li.children().find(|n|n.has_tag_name("ol")).map(|n|nav_list(n,base)).unwrap_or_default();
        Some(json!({"label":node_text(anchor),"href":href(base,anchor.attribute("href").unwrap_or("")).ok()?,"children":children}))
    }).collect()
}
fn ncx_list(parent: Node<'_, '_>, base: &str) -> Vec<Value> {
    parent
        .children()
        .filter(|n| n.has_tag_name("navPoint"))
        .filter_map(|point| {
            let label = point
                .children()
                .find(|n| n.has_tag_name("navLabel"))
                .map(node_text)?;
            let src = point
                .children()
                .find(|n| n.has_tag_name("content"))?
                .attribute("src")?;
            Some(json!({"label":label,"href":href(base,src).ok()?,"children":ncx_list(point,base)}))
        })
        .collect()
}
pub fn open(path: &str) -> CoreResult<Value> {
    let package = package(path)?;
    let chapters: Vec<_> = package
        .spine
        .iter()
        .filter_map(|id| package.items.get(id))
        .filter(|i| {
            i.media == "application/xhtml+xml"
                || i.media == "text/html"
                || i.media == "image/svg+xml"
        })
        .enumerate()
        .map(|(i, item)| json!({"path":item.href,"label":format!("第 {} 节",i+1)}))
        .collect();
    if chapters.is_empty() {
        return Err("EPUB 缺少可阅读的 spine 内容".into());
    }
    let mut toc = Vec::new();
    if let Some(nav) = package
        .items
        .values()
        .find(|i| i.properties.split_whitespace().any(|p| p == "nav"))
    {
        if let Ok(xml) = text(path, &nav.href) {
            if let Ok(doc) = parse_xml(&xml) {
                if let Some(list) = doc
                    .descendants()
                    .find(|n| {
                        n.has_tag_name("nav")
                            && n.attributes().any(|a| {
                                (a.name() == "type" || a.name().ends_with(":type"))
                                    && a.value().split_whitespace().any(|v| v == "toc")
                            })
                    })
                    .and_then(|n| n.children().find(|c| c.has_tag_name("ol")))
                {
                    toc = nav_list(list, &nav.href);
                }
            }
        }
    }
    if toc.is_empty() {
        if let Some(ncx) = package.ncx {
            if let Ok(xml) = text(path, &ncx) {
                if let Ok(doc) = parse_xml(&xml) {
                    if let Some(map) = doc.descendants().find(|n| n.has_tag_name("navMap")) {
                        toc = ncx_list(map, &ncx);
                    }
                }
            }
        }
    }
    if toc.is_empty() {
        toc = chapters
            .iter()
            .map(|c| json!({"label":c["label"],"href":c["path"],"children":[]}))
            .collect();
    }
    Ok(json!({"kind":"epub","toc":toc,"pageCount":chapters.len(),"chapters":chapters}))
}

pub fn chapter(path: &str, name: &str) -> CoreResult<Value> {
    let name = resolve("", name)?;
    let source = text(path, &name)?;
    let document = parse_xml(&source)?;
    if document.root_element().tag_name().name() == "svg" {
        return Ok(json!({
            "path": name,
            "text": format!("![图片](<epub-resource:{}>)", encode_uri_path(&name)),
            "anchors": []
        }));
    }
    let root = document
        .descendants()
        .find(|n| n.has_tag_name("body"))
        .unwrap_or_else(|| document.root());
    let mut blocks = Vec::new();
    let mut anchors = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut block_index = 0;
    let mut line = 1;
    for node in root.descendants().filter(|n| n.is_element()) {
        let tag = node.tag_name().name();
        let is_block = matches!(
            tag,
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "li" | "blockquote" | "pre" | "figure"
        );
        let is_standalone_image = matches!(tag, "img" | "image")
            && !node.ancestors().any(|parent| {
                parent.is_element()
                    && matches!(
                        parent.tag_name().name(),
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "li" | "blockquote" | "pre" | "figure"
                    )
            });
        if !is_block && !is_standalone_image {
            continue;
        }
        if node.ancestors().skip(1).any(|parent| {
            parent != root
                && parent.is_element()
                && matches!(parent.tag_name().name(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "li" | "blockquote" | "pre" | "figure")
        }) {
            continue;
        }
        let body = if is_standalone_image {
            markdown_image(name.as_str(), node)
        } else {
            block_markdown(node, name.as_str())
        };
        if body.is_empty() {
            continue;
        }
        let block = match tag {
            "h1" => format!("# {body}"),
            "h2" => format!("## {body}"),
            "h3" => format!("### {body}"),
            "h4" => format!("#### {body}"),
            "h5" => format!("##### {body}"),
            "h6" => format!("###### {body}"),
            "blockquote" => format!("> {body}"),
            "pre" => format!("```\n{body}\n```"),
            _ => body,
        };
        // Keep IDs on headings, paragraph children and enclosing chapter sections.
        // The generated Markdown is block based, so expose the target block rather
        // than leaking source HTML into the reader.
        for target in node
            .ancestors()
            .chain(node.descendants())
            .filter(|n| n.is_element())
        {
            if let Some(id) = target.attribute("id").or_else(|| target.attribute("name")) {
                if seen_ids.insert(id.to_owned()) {
                    anchors.push(json!({"id":id,"block":block_index,"line":line}));
                }
            }
        }
        block_index += 1;
        line += block.bytes().filter(|byte| *byte == b'\n').count() + 2;
        blocks.push(block);
        if blocks.len() > 100_000 {
            return Err("EPUB 章节包含过多段落".into());
        }
    }
    if blocks.is_empty() {
        return Err(
            "EPUB 章节没有可显示的内容，可能是空白页或不支持的排版；请尝试其他章节。"
                .into(),
        );
    }
    Ok(json!({"path":name,"text":blocks.join("\n\n"),"anchors":anchors}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture() -> (std::path::PathBuf, tempfile_dir::TempDir) {
        fixture_with(&[])
    }

    fn fixture_with(changes: &[(&str, &str)]) -> (std::path::PathBuf, tempfile_dir::TempDir) {
        let dir = tempfile_dir::TempDir::new();
        let path = dir.path().join("book.epub");
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let entries = [
            ("mimetype", "application/epub+zip"),
            (
                "META-INF/container.xml",
                r#"<?xml version="1.0"?><!DOCTYPE container SYSTEM "http://example.invalid/container.dtd"><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
            ),
            (
                "OPS/book.opf",
                r#"<?xml version="1.0"?><!DOCTYPE package PUBLIC "-//IDPF//DTD OEBPS PACKAGE 2.0//EN" "http://example.invalid/package.dtd"><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>小小的书</dc:title><dc:creator>作者甲</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine><itemref idref="chapter"/></spine></package>"#,
            ),
            (
                "OPS/nav.xhtml",
                r#"<!DOCTYPE html SYSTEM "http://example.invalid/xhtml.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="chapter.xhtml#start">第一章</a><ol><li><a href="chapter.xhtml#part">小节</a></li></ol></li></ol></nav></body></html>"#,
            ),
            (
                "OPS/chapter.xhtml",
                r#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://example.invalid/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="start">第一章</h1><p id="part">这里&nbsp;是正文。</p><blockquote><p>引用内容</p></blockquote><p><a href="https://example.org">外部链接</a></p></body></html>"#,
            ),
            ("OPS/cover.jpg", "cover bytes"),
        ];
        for (name, contents) in entries {
            zip.start_file(name, options).unwrap();
            let contents = changes
                .iter()
                .find(|(entry, _)| *entry == name)
                .map(|(_, contents)| *contents)
                .unwrap_or(contents);
            zip.write_all(contents.as_bytes()).unwrap();
        }
        for (name, contents) in changes.iter().filter(|(name, _)| {
            !entries.iter().any(|(entry, _)| entry == name)
        }) {
            zip.start_file(name, options).unwrap();
            zip.write_all(contents.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        (path, dir)
    }

    mod tempfile_dir {
        pub struct TempDir(std::path::PathBuf);
        impl TempDir {
            pub fn new() -> Self {
                let path =
                    std::env::temp_dir().join(format!("hondana-epub-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir(&path).unwrap();
                Self(path)
            }
            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }
        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn paths_stay_in_archive() {
        assert_eq!(
            resolve("OPS/book.opf", "../images/cover.png").unwrap(),
            "images/cover.png"
        );
        for path in ["../../secret", "/etc/passwd", "file:///x", "..\\x"] {
            assert!(resolve("OPS/book.opf", path).is_err());
        }
        assert_eq!(
            resolve_uri("OPS/nav/toc.xhtml", "../chapter%20one.xhtml").unwrap(),
            "OPS/chapter one.xhtml"
        );
        assert!(resolve_uri("OPS/nav/toc.xhtml", "%2e%2e/%2e%2e/%2e%2e/secret.xhtml").is_err());
        assert!(resolve_uri("OPS/nav/toc.xhtml", "bad%2Gpath.xhtml").is_err());
    }

    #[test]
    fn reads_namespaced_epub_metadata_navigation_and_chapter() {
        let (path, _dir) = fixture();
        let metadata = metadata(path.to_str().unwrap()).unwrap();
        assert_eq!(metadata.title, "小小的书");
        assert_eq!(metadata.author, "作者甲");
        assert_eq!(metadata.cover.as_deref(), Some("OPS/cover.jpg"));
        assert_eq!(
            resource(
                path.to_str().unwrap(),
                metadata.cover.as_deref().unwrap(),
                100
            )
            .unwrap(),
            b"cover bytes"
        );

        let xml = text(path.to_str().unwrap(), "OPS/nav.xhtml").unwrap();
        let doc = parse_xml(&xml).unwrap();
        assert!(doc.descendants().any(|n| n.has_tag_name("nav")));
        let opened = open(path.to_str().unwrap()).unwrap();
        assert_eq!(opened["chapters"][0]["path"], "OPS/chapter.xhtml");
        assert_eq!(opened["toc"][0]["label"], "第一章");
        assert_eq!(opened["toc"][0]["href"], "OPS/chapter.xhtml#start");
        assert_eq!(opened["toc"][0]["children"][0]["label"], "小节");
        let chapter = chapter(path.to_str().unwrap(), "OPS/chapter.xhtml").unwrap();
        assert!(chapter["text"].as_str().unwrap().contains("# 第一章"));
        assert!(chapter["text"]
            .as_str()
            .unwrap()
            .contains("这里\u{00a0}是正文。"));
        assert!(chapter["text"].as_str().unwrap().contains("> 引用内容"));
        assert_eq!(chapter["anchors"][0]["id"], "start");
        assert_eq!(chapter["anchors"][0]["block"], 0);
        assert_eq!(chapter["anchors"][1]["id"], "part");
        assert_eq!(chapter["anchors"][1]["block"], 1);
    }

    #[test]
    fn ruby_annotations_stay_separate_from_epub_base_text() {
        let xhtml = r#"<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>我喜欢<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>，以及<ruby><rb>東京</rb><rtc><rt>とう</rt><rt>きょう</rt></rtc></ruby>。</p></body></html>"#;
        let (path, _dir) = fixture_with(&[("OPS/chapter.xhtml", xhtml)]);
        let chapter = chapter(path.to_str().unwrap(), "OPS/chapter.xhtml").unwrap();
        let text = chapter["text"].as_str().unwrap();
        assert!(text.contains(&ruby_marker("漢字", "かんじ")));
        assert!(text.contains(&ruby_marker("東京", "とう・きょう")));
        assert!(!text.contains("漢字かんじ"));
        assert!(!text.contains("とうきょう"));
    }

    #[test]
    fn imports_and_opens_a_dtd_book_through_the_storage_dispatch_path() {
        let (path, dir) = fixture();
        let db_path = dir.path().join("library.sqlite3");
        let db = crate::storage::open(db_path.to_str().unwrap()).unwrap();
        let imported = crate::storage::import(&db, &[json!(path.to_str().unwrap())]).unwrap();
        let id = imported["ids"][0].as_str().unwrap();
        drop(db);

        let book = crate::execute(
            db_path.to_str().unwrap(),
            "book:open",
            json!({"id":id}),
        )
        .unwrap();
        assert_eq!(book["kind"], "epub");
        assert_eq!(book["toc"][0]["href"], "OPS/chapter.xhtml#start");
        let chapter = crate::execute(
            db_path.to_str().unwrap(),
            "chapter",
            json!({"id":id,"path":book["chapters"][0]["path"]}),
        )
        .unwrap();
        assert!(chapter["text"].as_str().unwrap().contains("第一章"));
        assert!(chapter["text"].as_str().unwrap().contains("这里\u{00a0}是正文。"));
    }

    #[test]
    fn rejects_broken_and_oversized_resources() {
        let (path, _dir) = fixture();
        assert!(open(path.to_str().unwrap()).is_ok());
        assert!(resource(path.to_str().unwrap(), "OPS/cover.jpg", 2).is_err());
        assert!(resource(path.to_str().unwrap(), "../../secret", 100).is_err());
    }

    #[test]
    fn resolves_navigation_uris_once_and_preserves_fragments() {
        assert_eq!(
            href(
                "OPS/nav/toc.xhtml",
                "../chapter%20one.xhtml?mode=read#%E5%B0%8F%E8%8A%82"
            )
            .unwrap(),
            "OPS/chapter one.xhtml#%E5%B0%8F%E8%8A%82"
        );
        assert_eq!(
            href("OPS/nav.xhtml", "#start").unwrap(),
            "OPS/nav.xhtml#start"
        );
        assert_eq!(
            href("OPS/nav.xhtml", "100%25.xhtml#part").unwrap(),
            "OPS/100%.xhtml#part"
        );
        assert_eq!(resolve("", "OPS/100%.xhtml").unwrap(), "OPS/100%.xhtml");
        assert!(href("OPS/nav.xhtml", "%2fetc/passwd").is_err());
    }

    #[test]
    fn reads_ncx_navigation_with_external_dtd() {
        let (path, _dir) = fixture_with(&[
            (
                "OPS/book.opf",
                r#"<!DOCTYPE package SYSTEM "http://example.invalid/package.dtd"><package><manifest><item id="ncx" href="nav.xhtml" media-type="application/x-dtbncx+xml"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>"#,
            ),
            (
                "OPS/nav.xhtml",
                r#"<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://example.invalid/ncx.dtd"><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml#start"/><navPoint><navLabel><text>小节</text></navLabel><content src="chapter.xhtml?read=1#part"/></navPoint></navPoint></navMap></ncx>"#,
            ),
        ]);
        let opened = open(path.to_str().unwrap()).unwrap();
        assert_eq!(opened["toc"][0]["href"], "OPS/chapter.xhtml#start");
        assert_eq!(opened["toc"][0]["children"][0]["label"], "小节");
        assert_eq!(
            opened["toc"][0]["children"][0]["href"],
            "OPS/chapter.xhtml#part"
        );
    }

    #[test]
    fn expands_entities_without_changing_literal_xml_sections() {
        let source = r#"<?xml version="1.0"?><!DOCTYPE html [<!ENTITY custom "自定义">]><html><!-- &nbsp; --><body><p title="&copy;">&custom;&nbsp;&amp;nbsp;<![CDATA[&nbsp;]]></p></body></html>"#;
        let expanded = expand_xhtml_entities(source);
        assert!(expanded.contains("<!-- &nbsp; -->"));
        assert!(expanded.contains("<![CDATA[&nbsp;]]>"));
        let doc = parse_xml(&expanded).unwrap();
        let p = doc
            .descendants()
            .find(|node| node.has_tag_name("p"))
            .unwrap();
        assert_eq!(p.attribute("title"), Some("©"));
        assert_eq!(node_text(p), "自定义\u{00a0}&nbsp;&nbsp;");
    }

    #[test]
    fn expands_the_full_xhtml_named_entity_set() {
        let source = "<html><body><p>&eacute; &trade; &bull; &hellip;</p></body></html>";
        let expanded = expand_xhtml_entities(source);
        let doc = parse_xml(&expanded).unwrap();
        let p = doc.descendants().find(|node| node.has_tag_name("p")).unwrap();
        assert_eq!(node_text(p), "é ™ • …");
    }

    #[test]
    fn keeps_unknown_external_dtd_entities_as_literal_text() {
        let source = r#"<!DOCTYPE html SYSTEM "http://example.invalid/xhtml.dtd"><html><body><p>一 &mystery; 二</p></body></html>"#;
        let expanded = expand_xhtml_entities(source);
        let doc = parse_xml(&expanded).unwrap();
        let p = doc
            .descendants()
            .find(|node| node.has_tag_name("p"))
            .unwrap();
        assert_eq!(node_text(p), "一 &mystery; 二");
    }

    #[test]
    fn image_only_chapters_are_readable_and_image_paths_are_resolved() {
        let (path, _dir) = fixture_with(&[(
            "OPS/chapter.xhtml",
            "<!DOCTYPE html><html><body><p><img alt=\"封面图\" src=\"cover.jpg?width=2#view\"/></p></body></html>",
        )]);
        let value = chapter(path.to_str().unwrap(), "OPS/chapter.xhtml").unwrap();
        assert_eq!(
            value["text"],
            "![封面图](<epub-resource:OPS/cover.jpg>)"
        );
        assert_eq!(resource(path.to_str().unwrap(), "OPS/cover.jpg", 100).unwrap(), b"cover bytes");
    }

    #[test]
    fn converts_inline_and_svg_images_to_epub_resource_links() {
        let (path, _dir) = fixture_with(&[(
            "OPS/chapter.xhtml",
            "<html><body><p>前文 <img alt=\"图示\" src=\"images/a%20b.png\"/> 后文</p><svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"images/vector.svg\"/></svg></body></html>",
        )]);
        let value = chapter(path.to_str().unwrap(), "OPS/chapter.xhtml").unwrap();
        let content = value["text"].as_str().unwrap();
        assert!(content.contains("前文 ![图示](<epub-resource:OPS/images/a%20b.png>) 后文"));
        assert!(content.contains("![图片](<epub-resource:OPS/images/vector.svg>)"));
    }

    #[test]
    fn image_figures_preserve_order_anchors_and_encoded_filenames_without_duplicates() {
        let (path, _dir) = fixture_with(&[(
            "OPS/chapter.xhtml",
            r#"<html><body><p>图前</p><figure id="picture"><p><img src="images/%E4%B8%AD%20%2520%25.png" alt="插图"/></p><figcaption>图注</figcaption></figure><p id="after">图后</p><img src="cover.jpg"/></body></html>"#,
        )]);
        let value = chapter(path.to_str().unwrap(), "OPS/chapter.xhtml").unwrap();
        let content = value["text"].as_str().unwrap();
        assert_eq!(content, "图前\n\n![插图](<epub-resource:OPS/images/%E4%B8%AD%20%2520%25.png>)\n\n图注\n\n图后\n\n![图片](<epub-resource:OPS/cover.jpg>)");
        assert_eq!(value["anchors"][0]["id"], "picture");
        assert_eq!(value["anchors"][0]["line"], 3);
        assert_eq!(value["anchors"][1]["id"], "after");
        assert_eq!(value["anchors"][1]["line"], 7);
    }

    #[test]
    fn reads_svg_spine_documents_as_images() {
        let (path, _dir) = fixture_with(&[
            ("OPS/book.opf", r#"<package><manifest><item id="image" href="chapter.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="image"/></spine></package>"#),
            ("OPS/chapter.svg", r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>"#),
        ]);
        assert_eq!(open(path.to_str().unwrap()).unwrap()["chapters"][0]["path"], "OPS/chapter.svg");
        assert_eq!(chapter(path.to_str().unwrap(), "OPS/chapter.svg").unwrap()["text"], "![图片](<epub-resource:OPS/chapter.svg>)");
    }

    #[test]
    fn genuinely_empty_chapters_still_report_an_error() {
        let (path, _dir) = fixture_with(&[("OPS/chapter.xhtml", "<html><body><p> </p></body></html>")]);
        assert!(chapter(path.to_str().unwrap(), "OPS/chapter.xhtml").unwrap_err().to_string().contains("没有可显示的内容"));
    }
}
