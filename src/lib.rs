#![allow(clippy::single_match)]

use std::{
    ffi::{self, c_char, CStr},
    path::Path,
};

use raw_window_handle::{HasRawDisplayHandle, HasRawWindowHandle};
use winit::{
    dpi::{PhysicalSize, Size},
    event::{Event, WindowEvent},
    event_loop::EventLoop,
    window::{Icon, WindowBuilder},
};

#[no_mangle]
pub extern "C" fn spawn_window(
    window_title: *mut u8,
    window_icon_path: *mut u8,
    width: u32,
    height: u32,
    setup_func: extern "C" fn(
        hwnd: *mut ffi::c_void,
        hinstance: *mut ffi::c_void,
        width: u32,
        height: u32,
    ),
    draw_func: extern "C" fn(),
    resize_func: extern "C" fn(width: u32, height: u32),
) {
    let event_loop = EventLoop::new().unwrap();

    let window = WindowBuilder::new()
        .with_title(unsafe {
            String::from_utf8(
                CStr::from_ptr(window_title as *const c_char)
                    .to_bytes()
                    .to_vec(),
            )
            .expect("Failed to convert window title to string")
        })
        .with_inner_size(Size::Physical(PhysicalSize::new(width, height)))
        .build(&event_loop)
        .unwrap();

    // Load window icon if provided
    if !window_icon_path.is_null() {
        let window_icon_path: String = unsafe {
            String::from_utf8(
                CStr::from_ptr(window_icon_path as *const c_char)
                    .to_bytes()
                    .to_vec(),
            )
            .expect("Failed to convert window icon path to string")
        };
        let window_icon_path: &Path = Path::new(window_icon_path.as_str());
        let window_icon = load_icon(window_icon_path);

        window.set_window_icon(Some(window_icon));
    }

    match window.raw_window_handle() {
        raw_window_handle::RawWindowHandle::Win32(handle) => setup_func(
            handle.hwnd,
            handle.hinstance,
            window.inner_size().width,
            window.inner_size().height,
        ),
        raw_window_handle::RawWindowHandle::AppKit(handle) => setup_func(
            handle.ns_window,
            handle.ns_view,
            window.inner_size().width,
            window.inner_size().height,
        ),
        _ => (),
    }

    if let raw_window_handle::RawWindowHandle::Wayland(window_handle) = window.raw_window_handle() {
        match window.raw_display_handle() {
            raw_window_handle::RawDisplayHandle::Wayland(display_handle) => setup_func(
                window_handle.surface,
                display_handle.display,
                window.inner_size().width,
                window.inner_size().height,
            ),
            _ => (),
        }
    } else if let raw_window_handle::RawWindowHandle::Xlib(window_handle) =
        window.raw_window_handle()
    {
        match window.raw_display_handle() {
            raw_window_handle::RawDisplayHandle::Xlib(display_handle) => {
                setup_func(
                    window_handle.window as *mut ffi::c_void,
                    display_handle.display,
                    window.inner_size().width,
                    window.inner_size().height,
                );
            }
            _ => (),
        }
    }

    _ = event_loop.run(move |event, elwt| {
        if let Event::WindowEvent { event, .. } = event {
            match event {
                WindowEvent::CloseRequested => elwt.exit(),
                WindowEvent::RedrawRequested => draw_func(),
                WindowEvent::Resized(size) => resize_func(size.width, size.height),
                _ => (),
            }
        }
    });
}

fn load_icon(path: &Path) -> Icon {
    let (icon_rgba, icon_width, icon_height) = {
        let image = image::open(path)
            .expect("Failed to open icon path")
            .into_rgba8();
        let (width, height) = image.dimensions();
        let rgba = image.into_raw();
        (rgba, width, height)
    };
    Icon::from_rgba(icon_rgba, icon_width, icon_height).expect("Failed to open icon")
}
