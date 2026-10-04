//! One-shot localhost listener for OAuth redirects. Providers such as OpenRouter accept a
//! `http://localhost:<port>` callback, which the system browser can reach while the app waits.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Authorization codes expire after ten minutes, so waiting longer is pointless.
const WAIT_LIMIT: Duration = Duration::from_secs(10 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const CALLBACK_PATH: &str = "/callback";

#[derive(Default)]
pub struct OAuthLoopbacks {
    listeners: Mutex<HashMap<u16, TcpListener>>,
    cancelled: Mutex<HashMap<u16, Arc<AtomicBool>>>,
}

#[derive(serde::Deserialize)]
pub struct OAuthLoopbackPage {
    title: String,
    message: String,
}

/// Returns the query string of a `GET /callback?...` request line, or `None` for anything else.
fn callback_query(request: &str) -> Option<String> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    (path == CALLBACK_PATH).then(|| query.to_string())
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn page(content: &OAuthLoopbackPage) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><body style=\"font:14px system-ui;margin:3rem auto;max-width:28rem;text-align:center\"><h1 style=\"font-size:18px\">{title}</h1><p>{message}</p></body>",
        title = escape_html(&content.title),
        message = escape_html(&content.message)
    )
}

#[tauri::command]
pub fn oauth_loopback_start(state: tauri::State<'_, OAuthLoopbacks>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    state
        .listeners
        .lock()
        .map_err(|e| e.to_string())?
        .insert(port, listener);
    state
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .insert(port, Arc::new(AtomicBool::new(false)));
    Ok(port)
}

/// Waits for the redirect and returns its query string; errors on cancel or timeout.
#[tauri::command]
pub async fn oauth_loopback_wait(
    state: tauri::State<'_, OAuthLoopbacks>,
    port: u16,
    page_content: OAuthLoopbackPage,
) -> Result<String, String> {
    let listener = state
        .listeners
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&port)
        .ok_or_else(|| "No sign-in is waiting on this port".to_string())?;
    let cancelled = state
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .get(&port)
        .cloned()
        .unwrap_or_default();
    let body = page(&page_content);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + WAIT_LIMIT;
        while Instant::now() < deadline {
            if cancelled.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
                    let mut buffer = [0u8; 8192];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    match callback_query(&request) {
                        Some(query) => {
                            respond(&mut stream, "200 OK", &body);
                            return Ok(query);
                        }
                        None => respond(&mut stream, "404 Not Found", ""),
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(POLL_INTERVAL);
                }
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("timeout".to_string())
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Ok(mut flags) = state.cancelled.lock() {
        flags.remove(&port);
    }
    result
}

#[tauri::command]
pub fn oauth_loopback_cancel(state: tauri::State<'_, OAuthLoopbacks>, port: u16) {
    if let Ok(flags) = state.cancelled.lock() {
        if let Some(flag) = flags.get(&port) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    if let Ok(mut listeners) = state.listeners.lock() {
        listeners.remove(&port);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_query_of_a_callback_request() {
        let request = "GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n";
        assert_eq!(
            callback_query(request).as_deref(),
            Some("code=abc&state=xyz")
        );
    }

    #[test]
    fn ignores_other_paths_and_methods() {
        assert_eq!(callback_query("GET /favicon.ico HTTP/1.1\r\n\r\n"), None);
        assert_eq!(
            callback_query("POST /callback?code=abc HTTP/1.1\r\n\r\n"),
            None
        );
        assert_eq!(callback_query(""), None);
    }

    #[test]
    fn keeps_an_empty_query_for_a_bare_callback() {
        assert_eq!(
            callback_query("GET /callback HTTP/1.1\r\n\r\n").as_deref(),
            Some("")
        );
    }

    #[test]
    fn escapes_page_text() {
        assert_eq!(escape_html("<a & \"b\">"), "&lt;a &amp; &quot;b&quot;&gt;");
    }
}
