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
