#![allow(clippy::single_match)]

use std::path::Path;

use raw_window_handle::HasRawWindowHandle;
use simple_logger::SimpleLogger;
use winit::{
    event::{Event, WindowEvent},
    event_loop::EventLoop,
    window::{Icon, WindowBuilder},
};

#[path = "util/fill.rs"]
mod fill;

#[no_mangle]
pub extern "C" fn spawn_window(setup_func: extern "C" fn(), draw_func: extern "C" fn()) {
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
        // At present, this only does anything on Windows and X11, so if you want to save load
        // time, you can put icon loading behind a function that returns `None` on other platforms.
        .with_window_icon(Some(icon))
        .build(&event_loop)
        .unwrap();

    match window.raw_window_handle() {
        raw_window_handle::RawWindowHandle::Win32(handle) => {
            println!("Win32: {:?}", handle);
            setup_func();
        }
        _ => (),
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
                    fill::fill_window(&window);
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
