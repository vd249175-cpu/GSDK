//! Local, versioned JSON-lines transport for the business-agnostic rule space.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use graphvideo_kernel_daemon::{Session, Space};
use serde_json::{json, Value};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_POLL_WAIT_MS: u64 = 30_000;
type SharedSpace = Arc<(Mutex<Space>, Condvar)>;

fn read_frame(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "unterminated frame",
                ))
            };
        }
        let count = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(available.len());
        if frame.len() + count > MAX_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "frame exceeds limit",
            ));
        }
        let complete = available[count - 1] == b'\n';
        frame.extend_from_slice(&available[..count]);
        reader.consume(count);
        if complete {
            return Ok(Some(frame));
        }
    }
}

/// Analysis runs off the scheduling lock: clone the immutable facts snapshot
/// in a short critical section, then execute centrality/community algorithms
/// without blocking mailbox progress. Oversize responses are protocol errors
/// and never affect the daemon.
const MAX_ANALYSIS_RESPONSE_BYTES: usize = 512 * 1024;

fn handle_analyze(
    shared: &SharedSpace,
    session: &mut Session,
    request: &Value,
    token: &str,
) -> Value {
    let job = {
        let (lock, _) = &**shared;
        let mut space = lock.lock().unwrap_or_else(|poison| poison.into_inner());
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            space.prepare_analyze(session, request, token)
        })) {
            Ok(Ok(job)) => job,
            Ok(Err(error)) => {
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                return json!({"id":id,"ok":false,"error":error});
            }
            Err(_) => {
                let (lock, _) = &**shared;
                let mut space = lock.lock().unwrap_or_else(|poison| poison.into_inner());
                session.disconnect(&mut space);
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                return json!({"id":id,"ok":false,"error":"internal request failure"});
            }
        }
    };
    if let Some(hit) = job.cached {
        return json!({"id":job.id,"ok":true,"result":hit});
    }
    match graphvideo_analysis::analyze_json(&job.request, &job.facts, &job.context) {
        Ok(result) if result.to_string().len() <= MAX_ANALYSIS_RESPONSE_BYTES => {
            let (lock, _) = &**shared;
            let mut space = lock.lock().unwrap_or_else(|poison| poison.into_inner());
            space.store_analysis(&job.request, result.clone());
            json!({"id":job.id,"ok":true,"result":result})
        }
        Ok(_) => json!({"id":job.id,"ok":false,"error":"analysis response exceeds size limit"}),
        Err(error) => json!({"id":job.id,"ok":false,"error":error}),
    }
}

fn handle_request(
    shared: &SharedSpace,
    session: &mut Session,
    request: &Value,
    token: &str,
) -> Value {
    if request.get("op").and_then(Value::as_str) == Some("analyze") {
        return handle_analyze(shared, session, request, token);
    }
    let wait_ms = request
        .get("waitMs")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(MAX_POLL_WAIT_MS);
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    loop {
        let (lock, changed) = &**shared;
        let mut space = lock.lock().unwrap_or_else(|poison| poison.into_inner());
        let response = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            space.handle(session, request, token)
        })) {
            Ok(response) => response,
            Err(_) => {
                session.disconnect(&mut space);
                return json!({"id":request.get("id"),"ok":false,"error":"internal request failure"});
            }
        };
        let waitable = matches!(
            request.get("op").and_then(Value::as_str),
            Some("poll" | "pollEffect" | "awaitEffect")
        );
        let should_wait = waitable
            && response.get("ok") == Some(&Value::Bool(true))
            && response.get("result") == Some(&Value::Null)
            && wait_ms > 0
            && Instant::now() < deadline;
        if !should_wait {
            if !waitable {
                changed.notify_all();
            }
            return response;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let (next, timeout) = changed
            .wait_timeout(space, remaining)
            .unwrap_or_else(|poison| poison.into_inner());
        drop(next);
        if timeout.timed_out() {
            return response;
        }
    }
}

fn serve_client(stream: TcpStream, shared: SharedSpace, token: Arc<String>, session_id: u64) {
    let _ = stream.set_nodelay(true);
    let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
    let mut writer = stream;
    let mut session = Session::new(session_id);
    while let Ok(Some(frame)) = read_frame(&mut reader) {
        let response = match serde_json::from_slice::<Value>(&frame) {
            Ok(request) => handle_request(&shared, &mut session, &request, &token),
            Err(_) => json!({"id":null,"ok":false,"error":"invalid JSON frame"}),
        };
        if writeln!(writer, "{response}").is_err() {
            break;
        }
    }
    let (lock, changed) = &*shared;
    let mut space = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    session.disconnect(&mut space);
    changed.notify_all();
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = std::env::var("GRAPHVIDEO_DAEMON_TOKEN")?;
    if token.len() < 16 {
        return Err("GRAPHVIDEO_DAEMON_TOKEN must have at least 16 bytes".into());
    }
    let bind: SocketAddr = std::env::var("GRAPHVIDEO_DAEMON_BIND")
        .unwrap_or_else(|_| "127.0.0.1:0".to_owned())
        .parse()?;
    if !bind.ip().is_loopback() {
        return Err("daemon only accepts loopback connections".into());
    }
    let listener = TcpListener::bind(bind)?;
    println!(
        "{}",
        json!({"version":1,"address":listener.local_addr()?.to_string(),"pid":std::process::id()})
    );
    io::stdout().flush()?;
    let shared = Arc::new((Mutex::new(Space::default()), Condvar::new()));
    let token = Arc::new(token);
    let next_session_id = AtomicU64::new(1);
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let shared = Arc::clone(&shared);
                let token = Arc::clone(&token);
                let session_id = next_session_id.fetch_add(1, Ordering::Relaxed);
                thread::spawn(move || serve_client(stream, shared, token, session_id));
            }
            Err(error) => eprintln!("[kernel-daemon] accept error: {error}"),
        }
    }
    Ok(())
}
