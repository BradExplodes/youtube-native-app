//! WebView2 memory hints.
//!
//! `MemoryUsageTargetLevel::Low` tells WebView2 nobody is looking at a webview, so it
//! can drop caches and GPU resources and page memory out. Scripts and audio keep
//! running. Used for the always-hidden player, and for our UI while it's minimized.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    ICoreWebView2_19,
};
use windows_core::Interface;

pub fn set_low_memory(window: &WebviewWindow, low: bool) {
    let label = window.label().to_string();
    let result = window.with_webview(move |webview| {
        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: plain COM calls on the webview's own controller, made on the UI
        // thread by `with_webview`.
        let set = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_19>())
                .and_then(|core| core.SetMemoryUsageTargetLevel(level))
        };
        if let Err(e) = set {
            // Older WebView2 runtimes lack the API; it's only an optimization.
            log::warn!("[webview] memory level for {label}: {e}");
        }
    });
    if let Err(e) = result {
        log::warn!("[webview] {e}");
    }
}
