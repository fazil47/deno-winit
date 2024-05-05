#![allow(clippy::single_match)]

use std::{ffi, path::Path, ptr::null};

use raw_window_handle::{HasRawDisplayHandle, HasRawWindowHandle};
use simple_logger::SimpleLogger;
use winit::{
    dpi::{PhysicalSize, Size},
    event::{Event, WindowEvent},
    event_loop::EventLoop,
    window::{Icon, WindowBuilder},
};

#[no_mangle]
pub extern "C" fn spawn_window(
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
    SimpleLogger::new().init().unwrap();

    // You'll have to choose an icon size at your own discretion. On X11, the desired size varies
    // by WM, and on Windows, you still have to account for screen scaling. Here we use 32px,
    // since it seems to work well enough in most cases. Be careful about going too high, or
    // you'll be bitten by the low-quality downscaling built into the WM.
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/icon.png");

    let icon = load_icon(Path::new(path));

    let event_loop = EventLoop::new().unwrap();

    let window = WindowBuilder::new()
        .with_title("An iconic window!")
        .with_inner_size(Size::Physical(PhysicalSize::new(width, height)))
        // At present, this only does anything on Windows and X11, so if you want to save load
        // time, you can put icon loading behind a function that returns `None` on other platforms.
        .with_window_icon(Some(icon))
        .build(&event_loop)
        .unwrap();

    match window.raw_window_handle() {
        raw_window_handle::RawWindowHandle::Win32(handle) => setup_func(
            handle.hwnd,
            handle.hinstance,
            window.inner_size().width,
            window.inner_size().height,
        ),
        raw_window_handle::RawWindowHandle::AppKit(handle) => setup_func(
            handle.ns_view,
            null::<ffi::c_void>() as *mut ffi::c_void,
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
                WindowEvent::DroppedFile(path) => {
                    window.set_window_icon(Some(load_icon(&path)));
                }
                WindowEvent::RedrawRequested => {
                    draw_func();
                }
                WindowEvent::Resized(size) => {
                    resize_func(size.width, size.height);
                }
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
