#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    panic::{self, AssertUnwindSafe},
    process,
};

fn main() {
    // Ensure panics are logged with context instead of silently aborting.
    panic::set_hook(Box::new(|panic_info| {
        eprintln!("fatal panic in DawnChat desktop runtime: {panic_info}");
    }));

    let run_result = panic::catch_unwind(AssertUnwindSafe(|| {
        tauri::Builder::default()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .run(tauri::generate_context!())
    }));

    match run_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            eprintln!("desktop runtime stopped due to tauri error: {error}");
            process::exit(1);
        }
        Err(_) => {
            eprintln!("desktop runtime stopped due to an unrecoverable panic");
            process::exit(1);
        }
    }
}
