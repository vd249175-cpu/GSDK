//! Local, versioned JSON-lines transport for the business-agnostic rule space.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use graphvideo_kernel_daemon::{Session, Space};
use serde_json::{json, Value};

const MAX_FRAME_BYTES: usize = 1024 * 1024;

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

fn serve_client(stream: TcpStream, shared: Arc<Mutex<Space>>, token: Arc<String>) {
    let _ = stream.set_nodelay(true);
    let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
    let mut writer = stream;
    let mut session = Session::default();
    while let Ok(Some(frame)) = read_frame(&mut reader) {
        let response = match serde_json::from_slice::<Value>(&frame) {
            Ok(request) => {
                let mut space = shared.lock().unwrap_or_else(|poison| poison.into_inner());
                match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    space.handle(&mut session, &request, &token)
                })) {
                    Ok(response) => response,
                    Err(_) => {
                        session.abandon(&mut space);
                        json!({"id":request.get("id"),"ok":false,"error":"internal request failure"})
                    }
                }
            }
            Err(_) => json!({"id":null,"ok":false,"error":"invalid JSON frame"}),
        };
        if writeln!(writer, "{response}").is_err() {
            break;
        }
    }
    let mut space = shared.lock().unwrap_or_else(|poison| poison.into_inner());
    session.abandon(&mut space);
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
    let shared = Arc::new(Mutex::new(Space::default()));
    let token = Arc::new(token);
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let shared = Arc::clone(&shared);
                let token = Arc::clone(&token);
                thread::spawn(move || serve_client(stream, shared, token));
            }
            Err(error) => eprintln!("[kernel-daemon] accept error: {error}"),
        }
    }
    Ok(())
}
