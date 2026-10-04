use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use super::PlaybackState;

#[cfg(windows)]
const MAX_ARTWORK_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SystemMediaState {
    pub(super) source_app_id: Option<String>,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) playback_state: PlaybackState,
    pub(super) position_ms: Option<u64>,
    pub(super) duration_ms: Option<u64>,
    pub(super) artwork_data_url: Option<String>,
    pub(super) volume_percent: Option<u8>,
    /// Whether the current player accepts seek requests.
    pub(super) can_seek: bool,
    /// Playback speed while playing; 0 while a browser buffers. Missing means normal speed.
    pub(super) playback_rate: Option<f64>,
}

impl SystemMediaState {
    pub(super) fn unavailable() -> Self {
        Self {
            source_app_id: None,
            title: None,
            artist: None,
            album: None,
            playback_state: PlaybackState::Unavailable,
            position_ms: None,
            duration_ms: None,
            artwork_data_url: None,
            volume_percent: read_system_volume(),
            can_seek: false,
            playback_rate: None,
        }
    }

    pub(super) fn same_content(&self, other: &Self) -> bool {
        self.source_app_id == other.source_app_id
            && self.title == other.title
            && self.artist == other.artist
            && self.album == other.album
            && self.artwork_data_url == other.artwork_data_url
            && self.can_seek == other.can_seek
    }
}

/// Polls the system media session once a second, and every 150 ms for 2 s after `refresh` fires
/// (a control was just sent), so play/pause and track changes show up quickly.
pub(super) fn spawn_system_media_monitor(
    updates: watch::Sender<SystemMediaState>,
    refresh: std::sync::Arc<tokio::sync::Notify>,
    app: AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        #[cfg(windows)]
        let mut manager = None;
        #[cfg(windows)]
        let mut artwork_track_key = None;
        #[cfg(windows)]
        let mut artwork_cache = None;
        #[cfg(windows)]
        let mut last_artwork_attempt = None;
        let mut last_media_content: Option<SystemMediaState> = None;
        let mut fast_until = std::time::Instant::now();

        loop {
            let snapshot = read_system_media_state(
                #[cfg(windows)]
                &mut manager,
                #[cfg(windows)]
                &mut artwork_track_key,
                #[cfg(windows)]
                &mut artwork_cache,
                #[cfg(windows)]
                &mut last_artwork_attempt,
            )
            .await;
            let updated = updates.send_if_modified(|current| {
                if *current == snapshot {
                    false
                } else {
                    *current = snapshot.clone();
                    true
                }
            });
            if updated {
                if last_media_content
                    .as_ref()
                    .is_none_or(|previous| !previous.same_content(&snapshot))
                {
                    last_media_content = Some(snapshot.clone());
                    let _ = app.emit("system-media-state", &snapshot);
                } else {
                    let _ = app.emit(
                        "system-media-progress",
                        serde_json::json!({
                            "playbackState": snapshot.playback_state,
                            "positionMs": snapshot.position_ms,
                            "durationMs": snapshot.duration_ms,
                            "volumePercent": snapshot.volume_percent,
                            "playbackRate": snapshot.playback_rate,
                        }),
                    );
                }
            }
            let wait = if std::time::Instant::now() < fast_until {
                std::time::Duration::from_millis(150)
            } else {
                std::time::Duration::from_secs(1)
            };
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = refresh.notified() => {
                    fast_until = std::time::Instant::now() + std::time::Duration::from_secs(2);
                }
            }
        }
    });
}

#[cfg(windows)]
async fn read_system_media_state(
    manager: &mut Option<windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager>,
    artwork_track_key: &mut Option<(String, std::time::Instant)>,
    artwork_cache: &mut Option<String>,
    last_artwork_attempt: &mut Option<std::time::Instant>,
) -> SystemMediaState {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    if manager.is_none() {
        let Ok(operation) = SessionManager::RequestAsync() else {
            return SystemMediaState::unavailable();
        };
        let Ok(requested) = operation.await else {
            return SystemMediaState::unavailable();
        };
        *manager = Some(requested);
    }

    let Some(manager) = manager.as_ref() else {
        return SystemMediaState::unavailable();
    };
    let Ok(session) = manager.GetCurrentSession() else {
        return SystemMediaState::unavailable();
    };
    let Ok(properties_operation) = session.TryGetMediaPropertiesAsync() else {
        return SystemMediaState::unavailable();
    };
    let Ok(properties) = properties_operation.await else {
        return SystemMediaState::unavailable();
    };

    let source_app_id = session
        .SourceAppUserModelId()
        .ok()
        .and_then(|value| bounded_text(value.to_string(), 256));
    let title = properties
        .Title()
        .ok()
        .and_then(|value| bounded_text(value.to_string(), 512));
    let artist = properties
        .Artist()
        .ok()
        .and_then(|value| bounded_text(value.to_string(), 512));
    let album = properties
        .AlbumTitle()
        .ok()
        .and_then(|value| bounded_text(value.to_string(), 512));

    // Artwork first: reading it can take a moment, and the position read below should be as fresh
    // as possible when it goes out, so the phone's clock starts from the right place.
    let track_key = format!(
        "{}\0{}\0{}\0{}",
        source_app_id.as_deref().unwrap_or_default(),
        title.as_deref().unwrap_or_default(),
        artist.as_deref().unwrap_or_default(),
        album.as_deref().unwrap_or_default()
    );
    let track_changed = artwork_track_key.as_ref().map(|(key, _)| key.as_str()) != Some(track_key.as_str());
    if track_changed {
        *artwork_track_key = Some((track_key, std::time::Instant::now()));
    }
    // Browsers often publish their own app icon first and swap in the real artwork later without
    // changing the title, so the thumbnail is re-read for the same track too: every poll for the
    // first 15 s, then every 3 s while there is none, else every 10 s.
    let track_age = artwork_track_key
        .as_ref()
        .map(|(_, started)| started.elapsed())
        .unwrap_or_default();
    let refresh_every = if track_age < std::time::Duration::from_secs(15) {
        std::time::Duration::ZERO
    } else if artwork_cache.is_none() {
        std::time::Duration::from_secs(3)
    } else {
        std::time::Duration::from_secs(10)
    };
    let refresh_due = last_artwork_attempt
        .is_none_or(|last_attempt| last_attempt.elapsed() >= refresh_every);
    if track_changed || refresh_due {
        let artwork = read_artwork(&properties);
        // A failed re-read keeps the artwork already shown; a new track never keeps the old one.
        if track_changed || artwork.is_some() {
            *artwork_cache = artwork;
        }
        *last_artwork_attempt = Some(std::time::Instant::now());
    }
    let playback_state = session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| match status {
            Status::Playing => PlaybackState::Playing,
            Status::Paused | Status::Opened | Status::Changing => PlaybackState::Paused,
            Status::Closed | Status::Stopped => PlaybackState::Stopped,
            _ => PlaybackState::Unavailable,
        })
        .unwrap_or(PlaybackState::Unavailable);

    let can_seek = session
        .GetPlaybackInfo()
        .and_then(|info| info.Controls())
        .and_then(|controls| controls.IsPlaybackPositionEnabled())
        .unwrap_or(false);

    // Browsers stay "playing" at rate 0 while they buffer or show an ad. Players that publish no
    // rate are taken to play at normal speed.
    let playback_rate = session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackRate())
        .and_then(|rate| rate.Value())
        .ok()
        .filter(|rate| rate.is_finite())
        .map(|rate| rate.clamp(0.0, 16.0));

    let (position_ms, duration_ms) = session
        .GetTimelineProperties()
        .ok()
        .and_then(|timeline| {
            let start = timeline.StartTime().ok()?.Duration.max(0);
            let end = timeline.EndTime().ok()?.Duration;
            let mut position = timeline.Position().ok()?.Duration;
            let duration = end.saturating_sub(start);
            // Many players (Spotify, browsers) only refresh Position on events, so add the
            // time played since it was last reported, at the current rate. Synced lyrics depend on this.
            if playback_state == PlaybackState::Playing {
                if let Ok(updated) = timeline.LastUpdatedTime() {
                    let elapsed = windows_now_ticks().saturating_sub(updated.UniversalTime);
                    if updated.UniversalTime > 0 && (0..=duration).contains(&elapsed) {
                        let played = (elapsed as f64 * playback_rate.unwrap_or(1.0)) as i64;
                        position = position.saturating_add(played);
                    }
                }
            }
            (duration > 0).then(|| {
                (
                    Some(position.saturating_sub(start).clamp(0, duration) as u64 / 10_000),
                    Some(duration as u64 / 10_000),
                )
            })
        })
        .unwrap_or((None, None));

    SystemMediaState {
        source_app_id,
        title,
        artist,
        album,
        playback_state,
        position_ms,
        duration_ms,
        artwork_data_url: artwork_cache.clone(),
        volume_percent: read_system_volume(),
        can_seek,
        playback_rate: (playback_state == PlaybackState::Playing).then_some(playback_rate).flatten(),
    }
}

#[cfg(windows)]
pub(super) fn read_system_volume() -> Option<u8> {
    use windows::Win32::{
        Media::Audio::{
            eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    };

    unsafe {
        let initialized_here = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| {
            let devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let endpoint = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            let volume: IAudioEndpointVolume = endpoint.Activate(CLSCTX_ALL, None).ok()?;
            let level = volume.GetMasterVolumeLevelScalar().ok()?;
            Some((level.clamp(0.0, 1.0) * 100.0).round() as u8)
        })();
        if initialized_here {
            CoUninitialize();
        }
        result
    }
}

#[cfg(target_os = "macos")]
pub(super) fn read_system_volume() -> Option<u8> {
    let output = std::process::Command::new("osascript")
        .args(["-e", "output volume of (get volume settings)"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()?
        .trim()
        .parse::<u8>()
        .ok()
        .map(|value| value.min(100))
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(super) fn read_system_volume() -> Option<u8> {
    None
}

pub(super) fn set_system_volume(percent: u8) -> Result<(), String> {
    let percent = percent.min(100);
    #[cfg(windows)]
    {
        use windows::Win32::{
            Media::Audio::{
                eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
                MMDeviceEnumerator,
            },
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
            },
        };
        unsafe {
            let initialized_here = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let result = (|| {
                let devices: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                        .map_err(|error| error.to_string())?;
                let endpoint = devices
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|error| error.to_string())?;
                let volume: IAudioEndpointVolume = endpoint
                    .Activate(CLSCTX_ALL, None)
                    .map_err(|error| error.to_string())?;
                volume
                    .SetMasterVolumeLevelScalar(percent as f32 / 100.0, std::ptr::null())
                    .map_err(|error| error.to_string())
            })();
            if initialized_here {
                CoUninitialize();
            }
            return result;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let result = std::process::Command::new("osascript")
            .args(["-e", &format!("set volume output volume {percent}")])
            .status()
            .map_err(|error| error.to_string())?;
        if result.success() {
            Ok(())
        } else {
            Err("Could not set system output volume".into())
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = percent;
        Err("System volume control is not supported on this platform".into())
    }
}

/// Moves the current player to `position_ms` from the start of the track.
#[cfg(windows)]
pub(super) async fn seek(position_ms: u64) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as SessionManager;

    let manager = SessionManager::RequestAsync()
        .map_err(|error| error.to_string())?
        .await
        .map_err(|error| error.to_string())?;
    let session = manager.GetCurrentSession().map_err(|error| error.to_string())?;
    let start = session
        .GetTimelineProperties()
        .and_then(|timeline| timeline.StartTime())
        .map(|time| time.Duration.max(0))
        .unwrap_or(0);
    let ticks = i64::try_from(position_ms)
        .ok()
        .and_then(|ms| ms.checked_mul(10_000))
        .and_then(|offset| offset.checked_add(start))
        .ok_or("Seek position is out of range")?;
    let accepted = session
        .TryChangePlaybackPositionAsync(ticks)
        .map_err(|error| error.to_string())?
        .await
        .map_err(|error| error.to_string())?;
    if accepted {
        Ok(())
    } else {
        Err("The player refused the seek".into())
    }
}

#[cfg(not(windows))]
pub(super) async fn seek(_position_ms: u64) -> Result<(), String> {
    Err("Seeking is not supported on this platform".into())
}

/// Current time as a Windows DateTime: 100 ns ticks since 1601-01-01 UTC.
#[cfg(windows)]
fn windows_now_ticks() -> i64 {
    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
    let since_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    UNIX_EPOCH_TICKS.saturating_add((since_unix.as_nanos() / 100) as i64)
}

#[cfg(windows)]
fn bounded_text(value: String, max_chars: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(max_chars).collect())
    }
}

#[cfg(windows)]
fn read_artwork(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    use base64::Engine;
    use windows::Storage::Streams::DataReader;

    let reference = properties.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_ARTWORK_BYTES {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size as u32).ok()?.join().ok()?;
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = artwork_mime(&bytes)?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(windows)]
fn artwork_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    }
}

#[cfg(not(windows))]
async fn read_system_media_state() -> SystemMediaState {
    SystemMediaState {
        volume_percent: read_system_volume(),
        ..SystemMediaState::unavailable()
    }
}
