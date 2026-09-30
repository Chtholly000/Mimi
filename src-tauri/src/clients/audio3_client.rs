//! Audio 3.0 high-quality ASR WebSocket client.

use crate::clients::provider_events::ProviderEventSender;
use crate::core::models::SourceLanguage;
use crate::core::protocols::audio3::{
    Audio3ASREndpoint, Audio3ASRRequestEncoder, Audio3ASRServerEvent, Audio3ASRServerEventDecoder,
};
use crate::core::protocols::live_translate::LiveTranslateServerEvent;
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::sync::{Mutex, Notify};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const SEND_TIMEOUT: Duration = Duration::from_secs(5);
const CLOSE_TIMEOUT: Duration = Duration::from_millis(250);
const GENERIC_TRANSPORT_ERROR: &str = "The speech recognition connection closed.";
const GENERIC_PROTOCOL_ERROR: &str = "The speech recognition service returned invalid data.";
const SILENCE_INTERVAL: Duration = Duration::from_millis(100);
const SILENCE_PCM: [u8; 3200] = [0; 3200]; // 100 ms of 16 kHz mono PCM16.

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum Audio3ASRClientError {
    #[error("Add an Alibaba Cloud Model Studio API key in Settings.")]
    MissingAPIKey,
    #[error("The speech recognition session is not connected.")]
    NotConnected,
    #[error("The speech recognition connection stopped responding.")]
    HealthCheckTimedOut,
    #[error("{0}")]
    Task(String),
    #[error("The speech recognition connection could not be established in time.")]
    ConnectionTimedOut,
    #[error("audio3_error.setup.timeout.LOCAL_TIMEOUT")]
    TaskSetupTimedOut,
    #[error("The speech recognition transport failed.")]
    TransportFailure,
}

type Sink = futures_util::stream::SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

struct Inner {
    sink: Mutex<Option<Sink>>,
    task_started: AtomicBool,
    task_finished: AtomicBool,
    finishing: AtomicBool,
    last_audio_sent: Mutex<tokio::time::Instant>,
    terminal_error: Mutex<Option<String>>,
    pong_notify: Notify,
    receive_task: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Clone)]
pub struct Audio3ASRClient {
    inner: Arc<Inner>,
    endpoint: Audio3ASREndpoint,
    api_key: String,
    source_language: SourceLanguage,
    events: Arc<Mutex<Option<ProviderEventSender>>>,
    task_id: Arc<Mutex<Option<String>>>,
}

impl Audio3ASRClient {
    pub fn new(
        api_key: &str,
        source_language: SourceLanguage,
    ) -> Result<Self, Audio3ASRClientError> {
        let trimmed_key = api_key.trim();
        if trimmed_key.is_empty() {
            return Err(Audio3ASRClientError::MissingAPIKey);
        }
        Ok(Self {
            inner: Arc::new(Inner {
                sink: Mutex::new(None),
                task_started: AtomicBool::new(false),
                task_finished: AtomicBool::new(false),
                finishing: AtomicBool::new(false),
                last_audio_sent: Mutex::new(tokio::time::Instant::now()),
                terminal_error: Mutex::new(None),
                pong_notify: Notify::new(),
                receive_task: Mutex::new(None),
            }),
            endpoint: Audio3ASREndpoint::new().map_err(|_| Audio3ASRClientError::MissingAPIKey)?,
            api_key: trimmed_key.to_string(),
            source_language,
            events: Arc::new(Mutex::new(None)),
            task_id: Arc::new(Mutex::new(None)),
        })
    }

    /// Sets the channel the receive loop emits decoded events onto.
    pub async fn set_event_sender(&self, sender: ProviderEventSender) {
        *self.events.lock().await = Some(sender);
    }

    /// Opens the socket, sends `run-task`, and waits for `task-started`.
    pub async fn connect(&self, task_id: &str) -> Result<(), Audio3ASRClientError> {
        self.disconnect().await;
        let events = self
            .events
            .lock()
            .await
            .clone()
            .ok_or(Audio3ASRClientError::NotConnected)?;
        let run_task = Audio3ASRRequestEncoder::run_task(
            task_id,
            self.source_language,
            Some(
                crate::core::protocols::audio3::Audio3ASRContext::audiovisual_dialogue(
                    self.source_language,
                ),
            ),
        )
        .map_err(|_| Audio3ASRClientError::NotConnected)?;
        *self.task_id.lock().await = Some(task_id.to_string());

        let mut request = self
            .endpoint
            .url
            .clone()
            .into_client_request()
            .map_err(|_| Audio3ASRClientError::NotConnected)?;
        let auth = format!("Bearer {}", self.api_key);
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&auth).map_err(|_| Audio3ASRClientError::MissingAPIKey)?,
        );
        request
            .headers_mut()
            .insert("User-Agent", HeaderValue::from_static("mimi-tauri"));

        let (socket, _response) = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(request))
            .await
            .map_err(|_| Audio3ASRClientError::ConnectionTimedOut)?
            .map_err(|error| match error {
                tokio_tungstenite::tungstenite::Error::Http(response)
                    if matches!(response.status().as_u16(), 401 | 403) =>
                {
                    Audio3ASRClientError::Task(
                        "audio3_error.connection.authentication.HTTP_AUTH".into(),
                    )
                }
                _ => Audio3ASRClientError::TransportFailure,
            })?;
        let (sink, mut stream) = socket.split();
        *self.inner.sink.lock().await = Some(sink);
        self.inner.task_started.store(false, Ordering::SeqCst);
        self.inner.task_finished.store(false, Ordering::SeqCst);
        self.inner.finishing.store(false, Ordering::SeqCst);
        *self.inner.last_audio_sent.lock().await = tokio::time::Instant::now();
        *self.inner.terminal_error.lock().await = None;

        let inner = self.inner.clone();
        let source_language = self.source_language;
        let task = tokio::spawn(async move {
            let mut heartbeat = tokio::time::interval(SILENCE_INTERVAL);
            heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                let message = tokio::select! {
                    message = stream.next() => message,
                    _ = heartbeat.tick(), if inner.task_started.load(Ordering::SeqCst)
                        && !inner.task_finished.load(Ordering::SeqCst)
                        && !inner.finishing.load(Ordering::SeqCst) => {
                        if send_silence_if_idle(&inner).await.is_err() {
                            fail_transport(&inner, &events).await;
                            return;
                        }
                        continue;
                    }
                };
                let Some(message) = message else {
                    if should_report_transport_end(inner.task_finished.load(Ordering::SeqCst)) {
                        fail_transport(&inner, &events).await;
                    }
                    return;
                };
                let text = match message {
                    Ok(Message::Text(text)) => text.to_string(),
                    Ok(Message::Binary(data)) => String::from_utf8_lossy(&data).to_string(),
                    Ok(Message::Pong(_)) => {
                        inner.pong_notify.notify_waiters();
                        continue;
                    }
                    Ok(Message::Ping(_)) | Ok(Message::Frame(_)) => {
                        continue;
                    }
                    Ok(Message::Close(_)) => {
                        if should_report_transport_end(inner.task_finished.load(Ordering::SeqCst)) {
                            fail_transport(&inner, &events).await;
                        }
                        return;
                    }
                    Err(_) => {
                        if should_report_transport_end(inner.task_finished.load(Ordering::SeqCst)) {
                            fail_transport(&inner, &events).await;
                        }
                        return;
                    }
                };
                {
                    let event = match Audio3ASRServerEventDecoder::decode(&text) {
                        Ok(event) => event,
                        Err(_) => {
                            *inner.terminal_error.lock().await =
                                Some(GENERIC_PROTOCOL_ERROR.into());
                            let _ = events.send(LiveTranslateServerEvent::Error {
                                code: "audio3_protocol_error".into(),
                                message: GENERIC_PROTOCOL_ERROR.into(),
                            });
                            return;
                        }
                    };
                    let is_task_finished = matches!(&event, Audio3ASRServerEvent::TaskFinished);
                    match &event {
                        Audio3ASRServerEvent::TaskStarted => {
                            inner.task_started.store(true, Ordering::SeqCst);
                        }
                        Audio3ASRServerEvent::TaskFinished => {}
                        Audio3ASRServerEvent::TaskFailed { code, message } => {
                            crate::pipeline_log!(
                                "audio3 task failed phase={} category={} code={}",
                                if inner.task_started.load(Ordering::SeqCst) {
                                    "recognition"
                                } else {
                                    "setup"
                                },
                                message,
                                code
                            );
                            *inner.terminal_error.lock().await = Some(task_failure_token(
                                code,
                                message,
                                inner.task_started.load(Ordering::SeqCst),
                            ));
                        }
                        _ => {}
                    }
                    let subtitle_event = match &event {
                        Audio3ASRServerEvent::TaskFailed { .. } => {
                            let token = inner.terminal_error.lock().await.clone().unwrap();
                            LiveTranslateServerEvent::Error {
                                code: token.clone(),
                                message: token,
                            }
                        }
                        _ => event.subtitle_event(source_language),
                    };
                    let is_task_failed =
                        matches!(subtitle_event, LiveTranslateServerEvent::Error { .. });
                    let send_result = events.send(subtitle_event);
                    // `finish` disconnects the socket as soon as this flag is
                    // visible. Publish SessionFinished first so that cleanup
                    // cannot abort the receive task between provider ack and
                    // the bridge event needed to drain an authoritative tail.
                    if is_task_finished {
                        inner.task_finished.store(true, Ordering::SeqCst);
                    }
                    if send_result.is_err() {
                        break;
                    }
                    if is_task_failed {
                        return;
                    }
                }
            }
        });
        *self.inner.receive_task.lock().await = Some(task);

        let result = async {
            self.send_text(run_task.to_string()).await?;
            self.wait_for_task_start(Duration::from_secs(10)).await
        }
        .await;
        if result.is_err() {
            self.disconnect().await;
        }
        result
    }

    pub async fn send_audio(&self, pcm_data: &[u8]) -> Result<(), Audio3ASRClientError> {
        if pcm_data.is_empty() {
            return Ok(());
        }
        // The reliable provider-error event owns teardown. Avoid a secondary
        // pipeline transport failure racing it and masking authentication.
        if self.inner.terminal_error.lock().await.is_some() {
            return Ok(());
        }
        if !self.inner.task_started.load(Ordering::SeqCst)
            || self.inner.finishing.load(Ordering::SeqCst)
        {
            return Err(Audio3ASRClientError::NotConnected);
        }
        let operation = async {
            let mut sink = self.inner.sink.lock().await;
            let Some(sink) = sink.as_mut() else {
                return Err(Audio3ASRClientError::NotConnected);
            };
            sink.send(Message::Binary(pcm_data.to_vec().into()))
                .await
                .map_err(|_| Audio3ASRClientError::TransportFailure)?;
            *self.inner.last_audio_sent.lock().await = tokio::time::Instant::now();
            Ok(())
        };
        tokio::time::timeout(SEND_TIMEOUT, operation)
            .await
            .map_err(|_| Audio3ASRClientError::TransportFailure)?
    }

    pub async fn ping(&self, timeout: Duration) -> Result<(), Audio3ASRClientError> {
        let operation = async {
            let pong = self.inner.pong_notify.notified();
            tokio::pin!(pong);
            pong.as_mut().enable();
            {
                let mut sink = self.inner.sink.lock().await;
                let Some(sink) = sink.as_mut() else {
                    return Err(Audio3ASRClientError::NotConnected);
                };
                sink.send(Message::Ping(tokio_tungstenite::tungstenite::Bytes::new()))
                    .await
                    .map_err(|_| Audio3ASRClientError::TransportFailure)?;
            }
            pong.await;
            Ok(())
        };
        tokio::time::timeout(timeout, operation)
            .await
            .map_err(|_| Audio3ASRClientError::HealthCheckTimedOut)?
    }

    /// Sends `finish-task`, waits briefly for `task-finished`, then
    /// disconnects.
    pub async fn finish(&self, timeout: Duration) {
        if self.inner.sink.lock().await.is_none() {
            return;
        }
        self.inner.finishing.store(true, Ordering::SeqCst);
        let task_id = self.task_id.lock().await.clone().unwrap_or_default();
        if let Ok(command) = Audio3ASRRequestEncoder::finish_task(&task_id) {
            let _ = self.send_text(command.to_string()).await;
        }
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.inner.task_finished.load(Ordering::SeqCst) {
                break;
            }
            if self.inner.terminal_error.lock().await.is_some() {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        self.disconnect().await;
    }

    pub async fn disconnect(&self) {
        self.inner.finishing.store(true, Ordering::SeqCst);
        if let Some(task) = self.inner.receive_task.lock().await.take() {
            task.abort();
        }
        let sink = self.inner.sink.lock().await.take();
        if let Some(mut sink) = sink {
            let _ = tokio::time::timeout(CLOSE_TIMEOUT, sink.close()).await;
        }
        self.inner.task_started.store(false, Ordering::SeqCst);
        self.inner.task_finished.store(false, Ordering::SeqCst);
        *self.inner.terminal_error.lock().await = None;
    }

    async fn wait_for_task_start(&self, timeout: Duration) -> Result<(), Audio3ASRClientError> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.inner.task_started.load(Ordering::SeqCst) {
                return Ok(());
            }
            if let Some(error) = self.inner.terminal_error.lock().await.clone() {
                return Err(Audio3ASRClientError::Task(error));
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(Audio3ASRClientError::TaskSetupTimedOut);
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    async fn send_text(&self, text: String) -> Result<(), Audio3ASRClientError> {
        let operation = async {
            let mut sink = self.inner.sink.lock().await;
            let Some(sink) = sink.as_mut() else {
                return Err(Audio3ASRClientError::NotConnected);
            };
            sink.send(Message::Text(text.into()))
                .await
                .map_err(|_| Audio3ASRClientError::TransportFailure)
        };
        tokio::time::timeout(SEND_TIMEOUT, operation)
            .await
            .map_err(|_| Audio3ASRClientError::TransportFailure)?
    }
}

async fn fail_transport(inner: &Inner, events: &ProviderEventSender) {
    *inner.terminal_error.lock().await = Some(GENERIC_TRANSPORT_ERROR.into());
    let _ = events.send(LiveTranslateServerEvent::Error {
        code: "transport_error".into(),
        message: GENERIC_TRANSPORT_ERROR.into(),
    });
}

fn should_report_transport_end(task_finished: bool) -> bool {
    !task_finished
}

fn task_failure_token(code: &str, category: &str, started: bool) -> String {
    let phase = if started { "recognition" } else { "setup" };
    // Inputs have already passed the protocol decoder's exact allowlists.
    format!("audio3_error.{phase}.{category}.{code}")
}

async fn send_silence_if_idle(inner: &Inner) -> Result<(), Audio3ASRClientError> {
    let operation = async {
        let mut sink = inner.sink.lock().await;
        if inner.finishing.load(Ordering::SeqCst)
            || inner.terminal_error.lock().await.is_some()
            || inner.last_audio_sent.lock().await.elapsed() < SILENCE_INTERVAL
        {
            return Ok(());
        }
        let Some(sink) = sink.as_mut() else {
            return Err(Audio3ASRClientError::NotConnected);
        };
        sink.send(Message::Binary(SILENCE_PCM.to_vec().into()))
            .await
            .map_err(|_| Audio3ASRClientError::TransportFailure)?;
        *inner.last_audio_sent.lock().await = tokio::time::Instant::now();
        Ok(())
    };
    tokio::time::timeout(SEND_TIMEOUT, operation)
        .await
        .map_err(|_| Audio3ASRClientError::TransportFailure)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_end_is_failure_only_before_task_finished() {
        assert!(should_report_transport_end(false));
        assert!(!should_report_transport_end(true));
    }

    #[test]
    fn failures_preserve_setup_or_recognition_stage() {
        assert_eq!(
            task_failure_token("CLIENT_ERROR", "timeout", false),
            "audio3_error.setup.timeout.CLIENT_ERROR"
        );
        assert_eq!(
            task_failure_token("SERVER_ERROR", "service", true),
            "audio3_error.recognition.service.SERVER_ERROR"
        );
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    use crate::clients::provider_events::provider_event_channel;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    #[tokio::test]
    async fn idle_audio_sends_silence_and_finish_stops_heartbeat() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (silence_ready_tx, silence_ready_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let run = socket.next().await.unwrap().unwrap().into_text().unwrap();
            let run: serde_json::Value = serde_json::from_str(&run).unwrap();
            assert_eq!(run["payload"]["parameters"]["heartbeat"], true);
            socket
                .send(Message::Text(
                    r#"{"header":{"event":"task-started"}}"#.into(),
                ))
                .await
                .unwrap();
            for _ in 0..2 {
                let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                assert!(
                    matches!(frame, Message::Binary(ref bytes) if bytes.len() == SILENCE_PCM.len() && bytes.iter().all(|byte| *byte == 0))
                );
            }
            silence_ready_tx.send(()).unwrap();
            loop {
                let frame = socket.next().await.unwrap().unwrap();
                if let Message::Text(text) = frame {
                    assert!(text.contains("finish-task"));
                    socket
                        .send(Message::Text(
                            r#"{"header":{"event":"task-finished"}}"#.into(),
                        ))
                        .await
                        .unwrap();
                    break;
                }
            }
            let next = tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .unwrap();
            assert!(matches!(next, None | Some(Ok(Message::Close(_)))));
        });
        let mut client =
            Audio3ASRClient::new("synthetic-test-key", SourceLanguage::English).unwrap();
        client.endpoint.url = url::Url::parse(&format!("ws://{address}")).unwrap();
        let (sender, mut events) = provider_event_channel();
        client.set_event_sender(sender).await;
        client.connect("synthetic-task").await.unwrap();
        assert_eq!(
            events.recv().await,
            Some(LiveTranslateServerEvent::SessionCreated)
        );
        tokio::time::timeout(Duration::from_secs(2), silence_ready_rx)
            .await
            .unwrap()
            .unwrap();
        client.finish(Duration::from_secs(1)).await;
        assert_eq!(
            events.recv().await,
            Some(LiveTranslateServerEvent::SessionFinished)
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn setup_authentication_failure_remains_terminal_and_safe() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let _run = socket.next().await.unwrap().unwrap();
            socket.send(Message::Text(r#"{"header":{"event":"task-failed","error_code":"INVALID_API_KEY","error_message":"synthetic-private-response"}}"#.into())).await.unwrap();
            let next = tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .unwrap();
            assert!(matches!(next, None | Some(Ok(Message::Close(_)))));
        });
        let mut client =
            Audio3ASRClient::new("synthetic-test-key", SourceLanguage::English).unwrap();
        client.endpoint.url = url::Url::parse(&format!("ws://{address}")).unwrap();
        let (sender, mut events) = provider_event_channel();
        client.set_event_sender(sender).await;
        let error = client.connect("synthetic-task").await.unwrap_err();
        assert_eq!(
            error.to_string(),
            "audio3_error.setup.authentication.INVALID_API_KEY"
        );
        assert_eq!(
            events.recv().await,
            Some(LiveTranslateServerEvent::Error {
                code: "audio3_error.setup.authentication.INVALID_API_KEY".into(),
                message: "audio3_error.setup.authentication.INVALID_API_KEY".into()
            })
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn real_pcm_is_preserved_and_terminal_error_does_not_become_transport_recovery() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let _run = socket.next().await.unwrap().unwrap();
            socket
                .send(Message::Text(
                    r#"{"header":{"event":"task-started"}}"#.into(),
                ))
                .await
                .unwrap();
            let frame = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let frame = socket.next().await.unwrap().unwrap();
                    if matches!(&frame, Message::Binary(bytes) if bytes.iter().all(|byte| *byte == 0)) { continue; }
                    break frame;
                }
            }).await.unwrap();
            assert!(matches!(frame, Message::Binary(ref bytes) if bytes.as_ref() == [1, 2, 3, 4]));
            socket.send(Message::Text(r#"{"header":{"event":"task-failed","error_code":"CLIENT_ERROR","error_message":"request timeout after 23 seconds."}}"#.into())).await.unwrap();
            let next = tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .unwrap();
            assert!(matches!(next, None | Some(Ok(Message::Close(_)))));
        });
        let mut client =
            Audio3ASRClient::new("synthetic-test-key", SourceLanguage::English).unwrap();
        client.endpoint.url = url::Url::parse(&format!("ws://{address}")).unwrap();
        let (sender, mut events) = provider_event_channel();
        client.set_event_sender(sender).await;
        client.connect("synthetic-task").await.unwrap();
        let _ready = events.recv().await;
        client.send_audio(&[1, 2, 3, 4]).await.unwrap();
        assert_eq!(
            events.recv().await,
            Some(LiveTranslateServerEvent::Error {
                code: "audio3_error.recognition.timeout.CLIENT_ERROR".into(),
                message: "audio3_error.recognition.timeout.CLIENT_ERROR".into()
            })
        );
        client.send_audio(&[1, 2]).await.unwrap();
        client.disconnect().await;
        server.await.unwrap();
    }
}
