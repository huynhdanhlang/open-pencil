use serde::Deserialize;
use std::io::{Cursor, Write};
use std::sync::OnceLock;

static FIG_BUILD_LOCK: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
const FIG_COMPRESSION_WORKERS: u32 = 4;
const FIG_PARALLEL_COMPRESSION_MIN_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
pub struct ImageEntry {
    name: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryFigHeader {
    sizes: Vec<usize>,
    images: Vec<String>,
    meta_json: String,
    fig_kiwi_version: Option<u32>,
}

struct BinaryFigPayload {
    schema: Vec<u8>,
    kiwi: Vec<u8>,
    thumbnail: Vec<u8>,
    header: BinaryFigHeader,
    images: Vec<ImageEntry>,
}

fn decode_fig_payload(bytes: &[u8]) -> Result<BinaryFigPayload, String> {
    if bytes.len() < 8 || bytes.len() > 512 * 1024 * 1024 || &bytes[..4] != b"OPF1" {
        return Err("Invalid native FIG binary envelope".into());
    }
    let header_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if header_len > 1024 * 1024 || header_len > bytes.len() - 8 {
        return Err("Invalid native FIG metadata length".into());
    }
    let header: BinaryFigHeader = serde_json::from_slice(&bytes[8..8 + header_len])
        .map_err(|error| format!("Invalid native FIG metadata: {error}"))?;
    if header.sizes.len() != header.images.len() + 3 || header.sizes.len() > 65536 {
        return Err("Invalid native FIG section count".into());
    }
    for name in &header.images {
        let Some(filename) = name.strip_prefix("images/") else {
            return Err("Invalid FIG image entry name".into());
        };
        if filename.is_empty() || filename == "." || filename == ".." || filename.contains(['/', '\\']) {
            return Err("Invalid FIG image entry name".into());
        }
    }
    let mut offset = 8 + header_len;
    let mut sections = Vec::with_capacity(header.sizes.len());
    // Validate every range before copying any section.
    for &size in &header.sizes {
        let end = offset.checked_add(size).filter(|&end| end <= bytes.len())
            .ok_or("Truncated native FIG section")?;
        sections.push(&bytes[offset..end]);
        offset = end;
    }
    if offset != bytes.len() { return Err("Trailing native FIG bytes".into()); }
    let images = header.images.iter().zip(&sections[3..]).map(|(name, data)| ImageEntry {
        name: name.clone(), data: data.to_vec(),
    }).collect();
    Ok(BinaryFigPayload {
        schema: sections[0].to_vec(), kiwi: sections[1].to_vec(),
        thumbnail: sections[2].to_vec(), header, images,
    })
}

#[tauri::command]
pub async fn build_fig_file_binary(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Native FIG export requires a binary IPC payload".into());
    };
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("Native FIG binary payload exceeds the transfer limit".into());
    }
    let guard = FIG_BUILD_LOCK
        .get_or_init(|| tauri::async_runtime::Mutex::new(()))
        .try_lock()
        .map_err(|_| "Another FIG export is in progress. Try again after it finishes.".to_string())?;
    // Acquire before copying or decoding; rejected concurrent requests never
    // amplify their raw body into another set of section buffers.
    let bytes = bytes.to_vec();
    let archive = tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let payload = decode_fig_payload(&bytes)?;
        build_fig_archive(payload.schema, payload.kiwi, payload.thumbnail,
            payload.header.meta_json, Some(payload.images), payload.header.fig_kiwi_version)
    }).await.map_err(|error| format!("FIG export worker failed: {error}"))??;
    Ok(tauri::ipc::Response::new(archive))
}

#[tauri::command]
pub async fn build_fig_file(
    schema_deflated: Vec<u8>,
    kiwi_data: Vec<u8>,
    thumbnail_png: Vec<u8>,
    meta_json: String,
    images: Option<Vec<ImageEntry>>,
    fig_kiwi_version: Option<u32>,
) -> Result<tauri::ipc::Response, String> {
    let guard = FIG_BUILD_LOCK
        .get_or_init(|| tauri::async_runtime::Mutex::new(()))
        .try_lock()
        .map_err(|_| "Another FIG export is in progress. Try again after it finishes.".to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        // Keep the permit in the worker even if the requesting window closes or disconnects.
        let _guard = guard;
        build_fig_archive(
            schema_deflated,
            kiwi_data,
            thumbnail_png,
            meta_json,
            images,
            fig_kiwi_version,
        )
    })
    .await
    .map_err(|error| format!("FIG export worker failed: {error}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn build_fig_archive(
    schema_deflated: Vec<u8>,
    kiwi_data: Vec<u8>,
    thumbnail_png: Vec<u8>,
    meta_json: String,
    images: Option<Vec<ImageEntry>>,
    fig_kiwi_version: Option<u32>,
) -> Result<Vec<u8>, String> {
    let mut encoder = zstd::Encoder::new(Vec::new(), 3).map_err(|e| e.to_string())?;
    // Small payloads spend more time starting compression workers than compressing.
    if kiwi_data.len() >= FIG_PARALLEL_COMPRESSION_MIN_BYTES {
        encoder
            .multithread(FIG_COMPRESSION_WORKERS)
            .map_err(|e| e.to_string())?;
    }
    encoder
        .include_contentsize(true)
        .map_err(|e| e.to_string())?;
    encoder
        .set_pledged_src_size(Some(kiwi_data.len() as u64))
        .map_err(|e| e.to_string())?;
    encoder.write_all(&kiwi_data).map_err(|e| e.to_string())?;
    let zstd_data = encoder.finish().map_err(|e| e.to_string())?;

    let version: u32 = fig_kiwi_version.unwrap_or(101);
    let fig_kiwi_len = 8 + 4 + 4 + schema_deflated.len() + 4 + zstd_data.len();
    let mut fig_kiwi = Vec::with_capacity(fig_kiwi_len);
    fig_kiwi.extend_from_slice(b"fig-kiwi");
    fig_kiwi.extend_from_slice(&version.to_le_bytes());
    fig_kiwi.extend_from_slice(&(schema_deflated.len() as u32).to_le_bytes());
    fig_kiwi.extend_from_slice(&schema_deflated);
    fig_kiwi.extend_from_slice(&(zstd_data.len() as u32).to_le_bytes());
    fig_kiwi.extend_from_slice(&zstd_data);

    let buf = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(buf);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file("canvas.fig", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&fig_kiwi).map_err(|e| e.to_string())?;

    zip.start_file("thumbnail.png", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&thumbnail_png).map_err(|e| e.to_string())?;

    zip.start_file("meta.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(meta_json.as_bytes())
        .map_err(|e| e.to_string())?;

    if let Some(image_entries) = images {
        for entry in image_entries {
            zip.start_file(&entry.name, options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&entry.data).map_err(|e| e.to_string())?;
        }
    }

    let result = zip.finish().map_err(|e| e.to_string())?;
    Ok(result.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn binary_packet(header: serde_json::Value, data: &[u8]) -> Vec<u8> {
        let metadata = serde_json::to_vec(&header).unwrap();
        let mut bytes = b"OPF1".to_vec();
        bytes.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&metadata);
        bytes.extend_from_slice(data);
        bytes
    }

    #[test]
    fn binary_payload_preserves_all_sections_through_archive() {
        let packet = binary_packet(serde_json::json!({
            "sizes": [2, 3, 1, 3], "images": ["images/test"],
            "metaJson": "{\"name\":\"Thiết kế\"}", "figKiwiVersion": 106
        }), &[1, 255, 2, 0, 254, 3, 0, 123, 255]);
        let payload = decode_fig_payload(&packet).unwrap();
        assert_eq!(payload.schema, [1, 255]);
        assert_eq!(payload.kiwi, [2, 0, 254]);
        assert_eq!(payload.thumbnail, [3]);
        assert_eq!(payload.images[0].data, [0, 123, 255]);
        let bytes = build_fig_archive(payload.schema, payload.kiwi, payload.thumbnail,
            payload.header.meta_json, Some(payload.images), payload.header.fig_kiwi_version).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut image = Vec::new();
        archive.by_name("images/test").unwrap().read_to_end(&mut image).unwrap();
        assert_eq!(image, [0, 123, 255]);
        let mut meta = String::new();
        archive.by_name("meta.json").unwrap().read_to_string(&mut meta).unwrap();
        assert_eq!(meta, "{\"name\":\"Thiết kế\"}");
    }

    #[test]
    fn binary_payload_rejects_corrupt_lengths_sections_and_names() {
        assert!(decode_fig_payload(b"OPF1").is_err());
        assert!(decode_fig_payload(b"OPF1\xff\xff\xff\xff").is_err());
        for header in [
            serde_json::json!({"sizes": [1, 2], "images": [], "metaJson": "{}"}),
            serde_json::json!({"sizes": [1, 2, 3], "images": [], "metaJson": "{}"}),
            serde_json::json!({"sizes": [0, 0, 0], "images": [], "metaJson": "{}"}),
            serde_json::json!({"sizes": [0, 0, 0, 1], "images": ["images/../bad"], "metaJson": "{}"}),
            serde_json::json!({"sizes": [0, 0, 0, 1], "images": ["canvas.fig"], "metaJson": "{}"})
        ] {
            assert!(decode_fig_payload(&binary_packet(header, &[1])).is_err());
        }
    }

    #[test]
    fn archive_preserves_version_payload_thumbnail_metadata_and_images() {
        for payload in [
            b"editable design data".to_vec(),
            b"editable design data".repeat(500_000),
        ] {
            let bytes = build_fig_archive(
                vec![1, 2, 3],
                payload.clone(),
                vec![4, 5],
                "{\"name\":\"Design\"}".to_string(),
                Some(vec![ImageEntry {
                    name: "images/test".to_string(),
                    data: vec![6, 7],
                }]),
                Some(106),
            )
            .unwrap();
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
            let mut canvas = Vec::new();
            archive
                .by_name("canvas.fig")
                .unwrap()
                .read_to_end(&mut canvas)
                .unwrap();
            assert_eq!(&canvas[..8], b"fig-kiwi");
            assert_eq!(u32::from_le_bytes(canvas[8..12].try_into().unwrap()), 106);
            assert_eq!(&canvas[16..19], &[1, 2, 3]);
            assert_eq!(zstd::decode_all(Cursor::new(&canvas[23..])).unwrap(), payload);
            for (name, expected) in [
                ("thumbnail.png", vec![4, 5]),
                ("meta.json", b"{\"name\":\"Design\"}".to_vec()),
                ("images/test", vec![6, 7]),
            ] {
                let mut actual = Vec::new();
                archive
                    .by_name(name)
                    .unwrap()
                    .read_to_end(&mut actual)
                    .unwrap();
                assert_eq!(actual, expected);
            }
        }
    }
}
