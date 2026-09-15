//! One supervised native job. Executable/configuration are host-controlled.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const MAX_REQUEST: usize = 2 * 1024 * 1024;
const MAX_EVENT: u64 = 64 * 1024;
pub type Sink = Arc<dyn Fn(Value) + Send + Sync>;

#[derive(Clone)]
pub struct WorkerConfig {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub timeout: Duration,
}
struct Active {
    id: String,
    cancel: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct Bridge {
    active: Arc<Mutex<Option<Active>>>,
}

impl Bridge {
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(|_| "Worker state unavailable")?;
        if let Some(job) = active.as_ref().filter(|j| j.id == id) {
            job.cancel.store(true, Ordering::SeqCst);
            Ok(())
        } else {
            Err("No matching active job".into())
        }
    }
    pub fn release(&self) {
        if let Ok(active) = self.active.lock() {
            if let Some(job) = active.as_ref() {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
    }
    pub fn start(&self, config: WorkerConfig, request: Value, sink: Sink) -> Result<(), String> {
        let id = request["jobId"]
            .as_str()
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            })
            .ok_or("Invalid job ID")?
            .to_owned();
        if request["schemaVersion"] != 1
            || !matches!(request["type"].as_str(), Some("qualify" | "generate"))
        {
            return Err("Unsupported native request".into());
        }
        if request["type"] == "qualify"
            && !request["attemptId"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 128)
        {
            return Err("Missing qualification attempt".into());
        }
        let bytes = serde_json::to_vec(&request).map_err(|_| "Invalid JSON")?;
        if bytes.len() > MAX_REQUEST {
            return Err("Native request is too large".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut active = self.active.lock().map_err(|_| "Worker state unavailable")?;
            if active.is_some() {
                return Err("A native job is already running".into());
            }
            *active = Some(Active {
                id: id.clone(),
                cancel: cancel.clone(),
            });
        }
        let state = self.active.clone();
        thread::spawn(move || {
            let result = run(config, &bytes, &id, cancel.clone(), sink.clone());
            // Clear before publishing terminal event so the next job can start.
            if let Ok(mut active) = state.lock() {
                *active = None;
            }
            let event = match result {
                _ if cancel.load(Ordering::SeqCst) => json!({"type":"cancelled"}),
                Ok(event) => event,
                Err(reason) => json!({"type":"failed","reason":reason}),
            };
            let mut event = event;
            event["schemaVersion"] = json!(1);
            event["jobId"] = json!(id);
            sink(event);
        });
        Ok(())
    }
}

fn run(
    config: WorkerConfig,
    request: &[u8],
    id: &str,
    cancel: Arc<AtomicBool>,
    sink: Sink,
) -> Result<Value, String> {
    let request_value: Value =
        serde_json::from_slice(request).map_err(|_| "Invalid native request")?;
    let success_type = if request_value["type"] == "qualify" {
        "qualified"
    } else {
        "completed"
    };
    let mut child = Command::new(config.executable)
        .args(config.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(
            if std::env::var("CHECKFACE_NATIVE_DIAGNOSTICS").as_deref() == Ok("1") {
                Stdio::inherit()
            } else {
                Stdio::null()
            },
        )
        .spawn()
        .map_err(|_| "Could not start native worker")?;
    let mut input = child.stdin.take().ok_or("Missing worker input")?;
    let request = request.to_vec();
    // Writing can block if a defective worker never reads. Supervisor still kills it.
    let writer = thread::spawn(move || {
        input
            .write_all(&request)
            .and_then(|_| input.write_all(b"\n"))
    });
    let output = child.stdout.take().ok_or("Missing worker output")?;
    let (tx, rx) = std::sync::mpsc::sync_channel(8);
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            let mut line = Vec::new();
            let read = reader
                .by_ref()
                .take(MAX_EVENT + 1)
                .read_until(b'\n', &mut line);
            match read {
                Ok(0) => break,
                Ok(_) if line.len() as u64 <= MAX_EVENT => {
                    if tx
                        .send(
                            serde_json::from_slice::<Value>(&line)
                                .map_err(|_| "Malformed worker JSON".to_string()),
                        )
                        .is_err()
                    {
                        break;
                    }
                }
                _ => {
                    let _ = tx.send(Err("Worker event exceeds limit or cannot be read".into()));
                    break;
                }
            }
        }
    });
    let start = Instant::now();
    let mut terminal = None;
    let result;
    loop {
        if cancel.load(Ordering::SeqCst) {
            result = Err("Cancelled".into());
            break;
        }
        if start.elapsed() > config.timeout {
            result = Err("Native worker timed out".into());
            break;
        }
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(Ok(event)) => {
                if event["schemaVersion"] != 1 || event["jobId"] != id || terminal.is_some() {
                    result = Err("Worker protocol mismatch".into());
                    break;
                }
                match event["type"].as_str() {
                    Some("progress")
                        if event["fraction"]
                            .as_f64()
                            .is_some_and(|n| (0.0..=1.0).contains(&n)) =>
                    {
                        sink(event)
                    }
                    Some(kind) if kind == success_type || kind == "failed" => {
                        if kind == "qualified" && event["attemptId"] != request_value["attemptId"] {
                            result = Err("Stale qualification attempt".into());
                            break;
                        }
                        terminal = Some(event)
                    }
                    _ => {
                        result = Err("Unknown worker event".into());
                        break;
                    }
                }
            }
            Ok(Err(error)) => {
                result = Err(error);
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    result = terminal.ok_or("Native worker exited without a result".into());
                    break;
                }
                Ok(Some(_)) => {
                    result = Err("Native worker exited unsuccessfully".into());
                    break;
                }
                Err(_) => {
                    result = Err("Could not supervise native worker".into());
                    break;
                }
                _ => thread::sleep(Duration::from_millis(20)),
            },
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    drop(rx); // unblock a reader waiting on a full bounded channel
    let _ = writer.join();
    let _ = reader.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Value {
        json!({"schemaVersion":1,"jobId":"job-1","type":"generate"})
    }
    fn config(code: &str) -> WorkerConfig {
        WorkerConfig {
            executable: std::env::var_os("CHECKFACE_TEST_PYTHON")
                .unwrap_or("python3".into())
                .into(),
            args: vec!["-c".into(), code.into()],
            timeout: Duration::from_secs(3),
        }
    }
    fn exercise(code: &str) -> Value {
        let bridge = Bridge::default();
        let (tx, rx) = std::sync::mpsc::channel();
        bridge
            .start(
                config(code),
                request(),
                Arc::new(move |e| {
                    tx.send(e).unwrap();
                }),
            )
            .unwrap();
        loop {
            let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
            if event["type"] != "progress" {
                return event;
            }
        }
    }
    #[test]
    fn accepts_success_only_after_clean_exit() {
        let event = exercise("import json; print(json.dumps({'schemaVersion':1,'jobId':'job-1','type':'completed','localArtifactId':'abc'}))");
        assert_eq!(event["type"], "completed");
        let event = exercise("import json; print(json.dumps({'schemaVersion':1,'jobId':'job-1','type':'completed'})); raise SystemExit(2)");
        assert_eq!(event["type"], "failed");
    }
    #[test]
    fn rejects_stale_malformed_oversized_and_duplicate_events() {
        for code in [
            "print('not json')",
            "print('x'*70000)",
            "import json; print(json.dumps({'schemaVersion':1,'jobId':'stale','type':'completed'}))",
            "import json; s=json.dumps({'schemaVersion':1,'jobId':'job-1','type':'completed'}); print(s); print(s)",
            "import json; print(json.dumps({'schemaVersion':1,'jobId':'job-1','type':'progress','fraction':2}))",
        ] { assert_eq!(exercise(code)["type"], "failed"); }
    }
    #[test]
    fn cancels_busy_worker_and_allows_next_job() {
        let bridge = Bridge::default();
        let (tx, rx) = std::sync::mpsc::channel();
        bridge
            .start(
                config("import time; time.sleep(30)"),
                request(),
                Arc::new(move |e| {
                    tx.send(e).unwrap();
                }),
            )
            .unwrap();
        assert!(bridge
            .start(config(""), request(), Arc::new(|_| {}))
            .is_err());
        assert!(bridge.cancel("wrong-id").is_err());
        bridge.cancel("job-1").unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(3)).unwrap()["type"],
            "cancelled"
        );
        bridge
            .start(config(""), request(), Arc::new(|_| {}))
            .unwrap();
        bridge.release();
    }
    #[test]
    fn times_out_even_when_worker_never_reads_input() {
        let mut cfg = config("import time; time.sleep(30)");
        cfg.timeout = Duration::from_millis(100);
        let bridge = Bridge::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let mut value = request();
        value["padding"] = json!("x".repeat(500_000));
        bridge
            .start(
                cfg,
                value,
                Arc::new(move |e| {
                    tx.send(e).unwrap();
                }),
            )
            .unwrap();
        let event = rx.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(event["type"], "failed");
        assert_eq!(event["reason"], "Native worker timed out");
    }
    #[test]
    fn rejects_stale_qualification_attempt() {
        let bridge = Bridge::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let request =
            json!({"schemaVersion":1,"jobId":"job-1","type":"qualify","attemptId":"current"});
        bridge.start(config("import json; print(json.dumps({'schemaVersion':1,'jobId':'job-1','type':'qualified','attemptId':'stale'}))"), request, Arc::new(move |event| { let _ = tx.send(event); })).unwrap();
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event["type"], "failed");
        assert_eq!(event["reason"], "Stale qualification attempt");
    }
    #[test]
    fn bounds_request_and_handles_missing_worker() {
        let bridge = Bridge::default();
        let mut huge = request();
        huge["padding"] = json!("x".repeat(MAX_REQUEST));
        assert!(bridge.start(config(""), huge, Arc::new(|_| {})).is_err());
        let (tx, rx) = std::sync::mpsc::channel();
        let mut cfg = config("");
        cfg.executable = PathBuf::from("/nonexistent/checkface-worker");
        bridge
            .start(
                cfg,
                request(),
                Arc::new(move |e| {
                    tx.send(e).unwrap();
                }),
            )
            .unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(3)).unwrap()["type"],
            "failed"
        );
    }
}
