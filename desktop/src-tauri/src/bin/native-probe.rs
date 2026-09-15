//! CLI exercise of the same supervisor used by the WebView bridge.
#[path = "../bridge.rs"]
mod bridge;
use std::{io::Read, sync::Arc, time::Duration};
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 4 {
        eprintln!("native-probe PYTHON WORKER BUNDLE OUTPUT");
        std::process::exit(2);
    }
    let mut input = String::new();
    std::io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_string(&mut input)
        .unwrap();
    let request = serde_json::from_str(&input).unwrap();
    let worker = bridge::WorkerConfig {
        executable: args[0].clone().into(),
        args: vec![
            args[1].clone(),
            "--bundle".into(),
            args[2].clone(),
            "--output".into(),
            args[3].clone(),
        ],
        timeout: Duration::from_secs(
            std::env::var("CHECKFACE_PROBE_TIMEOUT_SECONDS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| (1..=1800).contains(value))
                .unwrap_or(180),
        ),
    };
    let (tx, rx) = std::sync::mpsc::channel();
    let supervisor = bridge::Bridge::default();
    supervisor
        .start(
            worker,
            request,
            Arc::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
    for event in rx {
        println!("{}", event);
        match event["type"].as_str() {
            Some("completed" | "qualified") => std::process::exit(0),
            Some("failed" | "cancelled") => std::process::exit(1),
            _ => (),
        }
    }
    std::process::exit(1);
}
