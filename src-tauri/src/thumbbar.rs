//! Taskbar thumbnail buttons: Previous, Play/Pause and Next under the app's preview when
//! you hover its taskbar button.
//!
//! Windows sends "TaskbarButtonCreated" to the window once its taskbar button exists
//! (and again if Explorer restarts); only then can the buttons be added. Clicks arrive
//! as WM_COMMAND, so the main window is subclassed to see both. COM objects live on
//! the window's own (UI) thread: playback updates from elsewhere are posted to it.

use std::{
    cell::RefCell,
    sync::{
        OnceLock,
        atomic::{AtomicI8, AtomicIsize, Ordering},
    },
};

use serde_json::{Value, json};
use tauri::{AppHandle, WebviewWindow};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{
            BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateBitmap, CreateDIBSection, DIB_RGB_COLORS,
            DeleteObject,
        },
        System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{
                DefSubclassProc, ITaskbarList3, SetWindowSubclass, THB_FLAGS, THB_ICON, THB_TOOLTIP,
                THBF_ENABLED, THBN_CLICKED, THUMBBUTTON, TaskbarList,
            },
            WindowsAndMessaging::{
                CreateIconIndirect, DestroyIcon, HICON, ICONINFO, PostMessageW,
                RegisterWindowMessageW, WM_APP, WM_COMMAND,
            },
        },
    },
    core::{BOOL, w},
};

use crate::player::send_command;

const SUBCLASS_ID: usize = 0x7974_6d6e; // "ytmn"
/// Posted to the window when play/pause changes: wParam 1 = playing.
const WM_PLAYING: u32 = WM_APP + 0x31;

const ID_PREV: u32 = 1;
const ID_TOGGLE: u32 = 2;
const ID_NEXT: u32 = 3;

static APP: OnceLock<AppHandle> = OnceLock::new();
static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();
/// Last play state sent to the window: -1 unknown, 0 paused, 1 playing.
static PLAYING: AtomicI8 = AtomicI8::new(-1);

#[derive(Clone, Copy)]
enum Glyph {
    Prev,
    Play,
    Pause,
    Next,
}

/// UI-thread only.
struct Buttons {
    taskbar: ITaskbarList3,
    prev: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
    playing: bool,
}

impl Drop for Buttons {
    fn drop(&mut self) {
        unsafe {
            for icon in [self.prev, self.play, self.pause, self.next] {
                let _ = DestroyIcon(icon);
            }
        }
    }
}

thread_local! {
    static BUTTONS: RefCell<Option<Buttons>> = const { RefCell::new(None) };
}

/// Hook the main window. Call before it is first shown, so the
/// "TaskbarButtonCreated" message isn't missed.
pub fn init(app: &AppHandle, window: &WebviewWindow) {
    let _ = APP.set(app.clone());
    let Ok(hwnd) = window.hwnd() else {
        log::warn!("[thumbbar] no window handle");
        return;
    };
    HWND_RAW.store(hwnd.0 as isize, Ordering::Relaxed);
    let result = window.run_on_main_thread(move || unsafe {
        let hwnd = HWND(HWND_RAW.load(Ordering::Relaxed) as *mut _);
        let msg = RegisterWindowMessageW(w!("TaskbarButtonCreated"));
        let _ = TASKBAR_CREATED.set(msg);
        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0).as_bool() {
            log::warn!("[thumbbar] couldn't hook the window");
        }
    });
    if let Err(e) = result {
        log::warn!("[thumbbar] {e}");
    }
}

/// Called with every playback update: switch the middle button between Play and Pause.
pub fn update(p: &Value) {
    let playing = p.get("playing").and_then(Value::as_bool).unwrap_or(false) as i8;
    if PLAYING.swap(playing, Ordering::Relaxed) == playing {
        return;
    }
    let raw = HWND_RAW.load(Ordering::Relaxed);
    if raw == 0 {
        return;
    }
    unsafe {
        let _ = PostMessageW(Some(HWND(raw as *mut _)), WM_PLAYING, WPARAM(playing as usize), LPARAM(0));
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if Some(&msg) == TASKBAR_CREATED.get() {
        add_buttons(hwnd);
    } else if msg == WM_PLAYING {
        set_playing(hwnd, wparam.0 == 1);
        return LRESULT(0);
    } else if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
        let action = match (wparam.0 & 0xffff) as u32 {
            ID_PREV => "previous",
            ID_TOGGLE => "toggle",
            ID_NEXT => "next",
            _ => return unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) },
        };
        if let Some(app) = APP.get() {
            let _ = send_command(app, json!({ "action": action }));
        }
        return LRESULT(0);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn tooltip(text: &str) -> [u16; 260] {
    let mut out = [0u16; 260];
    for (slot, c) in out.iter_mut().zip(text.encode_utf16().take(259)) {
        *slot = c;
    }
    out
}

fn button(id: u32, icon: HICON, tip: &str) -> THUMBBUTTON {
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: tooltip(tip),
        dwFlags: THBF_ENABLED,
    }
}

fn toggle_button(b: &Buttons) -> THUMBBUTTON {
    if b.playing {
        button(ID_TOGGLE, b.pause, "Pause")
    } else {
        button(ID_TOGGLE, b.play, "Play")
    }
}

fn add_buttons(hwnd: HWND) {
    let created = (|| -> windows::core::Result<Buttons> {
        let taskbar: ITaskbarList3 = unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)? };
        unsafe { taskbar.HrInit()? };
        // Thumbnail button icons are small icons: 16 px at 100% scaling.
        let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
        let size = (16 * dpi / 96) as i32;
        let b = Buttons {
            taskbar,
            prev: make_icon(Glyph::Prev, size)?,
            play: make_icon(Glyph::Play, size)?,
            pause: make_icon(Glyph::Pause, size)?,
            next: make_icon(Glyph::Next, size)?,
            playing: PLAYING.load(Ordering::Relaxed) == 1,
        };
        let buttons = [
            button(ID_PREV, b.prev, "Previous"),
            toggle_button(&b),
            button(ID_NEXT, b.next, "Next"),
        ];
        unsafe { b.taskbar.ThumbBarAddButtons(hwnd, &buttons)? };
        Ok(b)
    })();
    match created {
        Ok(b) => {
            log::info!("[thumbbar] taskbar buttons added");
            BUTTONS.with(|cell| *cell.borrow_mut() = Some(b));
        }
        Err(e) => log::warn!("[thumbbar] couldn't add taskbar buttons: {e}"),
    }
}

fn set_playing(hwnd: HWND, playing: bool) {
    BUTTONS.with(|cell| {
        if let Some(b) = cell.borrow_mut().as_mut() {
            b.playing = playing;
            let _ = unsafe { b.taskbar.ThumbBarUpdateButtons(hwnd, &[toggle_button(b)]) };
        }
    });
}

// ------------------------------------------------------------------ icons

/// Coverage (0..1) of the glyph at a point, in a 16×16 design grid.
fn inside(glyph: Glyph, x: f32, y: f32) -> bool {
    // A triangle pointing right with its left edge at `x0`, tip at `x1`, rows 3..13.
    let tri_right = |x0: f32, x1: f32| x >= x0 && x <= x1 && (y - 8.0).abs() <= 5.0 * (x1 - x) / (x1 - x0);
    let tri_left = |x0: f32, x1: f32| x >= x0 && x <= x1 && (y - 8.0).abs() <= 5.0 * (x - x0) / (x1 - x0);
    let bar = |x0: f32, x1: f32| x >= x0 && x <= x1 && (3.0..=13.0).contains(&y);
    match glyph {
        Glyph::Play => tri_right(4.0, 13.0),
        Glyph::Pause => bar(4.0, 6.75) || bar(9.25, 12.0),
        Glyph::Prev => bar(3.0, 5.0) || tri_left(5.5, 13.0),
        Glyph::Next => tri_right(3.0, 10.5) || bar(11.0, 13.0),
    }
}

/// A white glyph on transparent, antialiased by 4×4 supersampling.
fn make_icon(glyph: Glyph, size: i32) -> windows::core::Result<HICON> {
    const SS: i32 = 4;
    let mut bgra = vec![0u8; (size * size * 4) as usize];
    for py in 0..size {
        for px in 0..size {
            let mut hits = 0;
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = (px as f32 + (sx as f32 + 0.5) / SS as f32) * 16.0 / size as f32;
                    let y = (py as f32 + (sy as f32 + 0.5) / SS as f32) * 16.0 / size as f32;
                    hits += inside(glyph, x, y) as i32;
                }
            }
            let a = (hits * 255 / (SS * SS)) as u8;
            let i = ((py * size + px) * 4) as usize;
            bgra[i..i + 4].copy_from_slice(&[255, 255, 255, a]);
        }
    }

    unsafe {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let color = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
        // With a 32-bit colour bitmap the alpha channel decides; the mask is unused.
        let mask = CreateBitmap(size, size, 1, 1, None);
        let icon = CreateIconIndirect(&ICONINFO {
            fIcon: BOOL(1),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask,
            hbmColor: color,
        });
        let _ = DeleteObject(color.into());
        let _ = DeleteObject(mask.into());
        icon
    }
}
