use tauri::Manager;

#[cfg(target_os = "linux")]
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(target_os = "linux")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(target_os = "linux")]
use webkit2gtk::{LoadEvent, WebProcessTerminationReason, WebViewExt};

#[cfg(target_os = "linux")]
#[derive(Default)]
struct RendererHealth {
    stopped: AtomicBool,
    dialog_open: AtomicBool,
    generation: AtomicU64,
    recovery_load_generation: AtomicU64,
}

#[cfg(target_os = "linux")]
impl RendererHealth {
    fn terminated(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.recovery_load_generation.store(0, Ordering::SeqCst);
        self.stopped.store(true, Ordering::SeqCst);
    }

    fn loading(&self, event: LoadEvent) {
        if !self.stopped.load(Ordering::SeqCst) {
            return;
        }
        let generation = self.generation.load(Ordering::SeqCst);
        if event == LoadEvent::Started {
            self.recovery_load_generation.store(generation, Ordering::SeqCst);
        } else if event == LoadEvent::Finished
            && self.recovery_load_generation.load(Ordering::SeqCst) == generation
        {
            self.stopped.store(false, Ordering::SeqCst);
        }
    }

    fn accepts_recovery(&self, generation: u64) -> bool {
        self.stopped.load(Ordering::SeqCst)
            && self.generation.load(Ordering::SeqCst) == generation
    }
}

/// Native signals remain available after the editor's JavaScript process exits.
pub fn install_renderer_recovery<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        app.manage(RendererHealth::default());
        let window = app
            .get_webview_window("main")
            .ok_or(tauri::Error::WebviewNotFound)?;
        let handle = app.clone();
        window.with_webview(move |platform| {
            let load_handle = handle.clone();
            platform.inner().connect_load_changed(move |_, event| {
                load_handle.state::<RendererHealth>().loading(event);
            });
            platform.inner().connect_web_process_terminated(move |_, reason| {
                // Normal native teardown can deliberately terminate a web process.
                if reason == WebProcessTerminationReason::TerminatedByApi {
                    return;
                }
                handle.state::<RendererHealth>().terminated();
                let cause = match reason {
                    WebProcessTerminationReason::ExceededMemoryLimit => "The editor exceeded its memory limit.",
                    WebProcessTerminationReason::Crashed => "The editor process crashed.",
                    _ => "The editor process stopped unexpectedly.",
                };
                eprintln!("[OpenPencil WebKit] renderer_terminated reason={reason:?}");
                show_renderer_recovery(&handle, cause, false);
            });
        })?;
    }
    Ok(())
}

/// A dead renderer cannot execute the frontend's Quit/unsaved-document prompt.
pub fn handle_stopped_renderer_exit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    #[cfg(target_os = "linux")]
    if app.try_state::<RendererHealth>().is_some_and(|health| health.stopped.load(Ordering::SeqCst)) {
        show_renderer_recovery(app, "The editor process is no longer running.", true);
        return true;
    }
    false
}

#[cfg(target_os = "linux")]
fn show_renderer_recovery<R: tauri::Runtime>(app: &tauri::AppHandle<R>, cause: &str, exit: bool) {
    if app.state::<RendererHealth>().dialog_open.swap(true, Ordering::SeqCst) {
        return;
    }
    let action = if exit { "Close OpenPencil" } else { "Reload editor" };
    let generation = app.state::<RendererHealth>().generation.load(Ordering::SeqCst);
    let handle = app.clone();
    app.dialog()
        .message(format!("{cause}\n\nSaved files and durable recovery snapshots remain available. Changes after the last save or recovery snapshot may be lost.\n\n{action}?"))
        .title("OpenPencil — editor stopped")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCancelCustom(action.into(), "Keep window".into()))
        .show(move |accepted| {
            handle.state::<RendererHealth>().dialog_open.store(false, Ordering::SeqCst);
            if !accepted {
                return;
            }
            let action_handle = handle.clone();
            if let Err(error) = handle.run_on_main_thread(move || {
                // Dialogs complete asynchronously. A newer/live renderer owns its
                // unsaved state; stale consent must never bypass frontend guards.
                if !action_handle.state::<RendererHealth>().accepts_recovery(generation) {
                    return;
                }
                if exit {
                    action_handle.exit(0);
                } else if let Some(window) = action_handle.get_webview_window("main") {
                    if let Err(error) = window.reload() {
                        eprintln!("[OpenPencil WebKit] renderer_reload_failed error={error}");
                    }
                }
            }) {
                eprintln!("[OpenPencil WebKit] renderer_recovery_dispatch_failed error={error}");
            }
        });
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn stale_load_and_dialog_cannot_recover_a_new_or_live_renderer() {
        let health = RendererHealth::default();
        health.terminated();
        let first = health.generation.load(Ordering::SeqCst);
        health.loading(LoadEvent::Finished);
        assert!(health.accepts_recovery(first));
        health.loading(LoadEvent::Started);
        health.terminated();
        let second = health.generation.load(Ordering::SeqCst);
        health.loading(LoadEvent::Finished);
        assert!(!health.accepts_recovery(first));
        assert!(health.accepts_recovery(second));
        health.loading(LoadEvent::Started);
        health.loading(LoadEvent::Finished);
        assert!(!health.accepts_recovery(second));
    }
}

pub fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
