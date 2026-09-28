//! Local opt-in transcript history. Files contain user content and are never logged.
use crate::core::models::SubtitlePair;
use crate::core::session_archive::{
    AudioRecording, SavedTranscript, TranscriptPage, AUDIO_BYTE_LIMIT,
};
use serde::Serialize;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const MAX_TRANSCRIPT_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone)]
pub struct SessionHistory {
    directory: PathBuf,
    disabled: bool,
    io: Arc<Mutex<()>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub count: usize,
    pub limited: bool,
    pub has_audio: bool,
}

impl SessionHistory {
    pub fn new(directory: PathBuf, disabled: bool) -> Self {
        Self {
            directory,
            disabled,
            io: Arc::new(Mutex::new(())),
        }
    }

    fn path(&self, id: &str, extension: &str) -> io::Result<PathBuf> {
        uuid::Uuid::parse_str(id)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid history id"))?;
        Ok(self.directory.join(format!("{id}.{extension}")))
    }

    fn read(&self, id: &str) -> io::Result<SavedTranscript> {
        if self.disabled {
            return Err(io::Error::new(io::ErrorKind::NotFound, "history disabled"));
        }
        let _io = self.io.lock().unwrap();
        let final_path = self.path(id, "json")?;
        let path = if final_path.is_file() {
            final_path
        } else {
            self.path(id, "jsonl")?
        };
        let file = fs::File::open(path)?;
        if file.metadata()?.len() > MAX_TRANSCRIPT_FILE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "history file too large",
            ));
        }
        let mut lines = io::BufReader::new(file).lines();
        let first = lines
            .next()
            .transpose()?
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "empty history"))?;
        let mut saved: SavedTranscript = serde_json::from_str(&first)?;
        for line in lines {
            let line = line?;
            if line.is_empty() {
                continue;
            }
            let Ok(pair) = serde_json::from_str::<SubtitlePair>(&line) else {
                continue;
            };
            if saved.entries.len() >= crate::core::session_archive::TRANSCRIPT_COUNT_LIMIT {
                break;
            }
            saved.ended_at_ms = saved.ended_at_ms.max(pair.created_at_ms);
            saved.entries.push(pair);
        }
        if saved.version != 1 || saved.id != id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid history file",
            ));
        }
        Ok(saved)
    }

    pub fn begin(&self, id: &str, started_at_ms: u64) -> io::Result<()> {
        if self.disabled {
            return Ok(());
        }
        fs::create_dir_all(&self.directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))?;
        }
        let _io = self.io.lock().unwrap();
        let path = self.path(id, "jsonl")?;
        let mut file = tempfile::NamedTempFile::new_in(&self.directory)?;
        let header = SavedTranscript {
            version: 1,
            id: id.to_owned(),
            started_at_ms,
            ended_at_ms: started_at_ms,
            limited: false,
            entries: Vec::new(),
        };
        serde_json::to_writer(&mut file, &header).map_err(io::Error::other)?;
        file.write_all(b"\n")?;
        file.as_file().sync_all()?;
        file.persist_noclobber(path).map_err(|error| error.error)?;
        Ok(())
    }

    pub fn append_pair(&self, id: &str, pair: &SubtitlePair) -> io::Result<()> {
        if self.disabled {
            return Ok(());
        }
        let _io = self.io.lock().unwrap();
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(self.path(id, "jsonl")?)?;
        serde_json::to_writer(&mut file, pair).map_err(io::Error::other)?;
        file.write_all(b"\n")
    }

    pub fn append_pcm(&self, id: &str, sample_rate: u32, data: &[u8]) -> io::Result<()> {
        if self.disabled || data.is_empty() {
            return Ok(());
        }
        let _io = self.io.lock().unwrap();
        let path = self.path(id, "pcm")?;
        if !path.exists() {
            let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
            temporary.write_all(&sample_rate.to_le_bytes())?;
            temporary.write_all(data)?;
            temporary.as_file().sync_all()?;
            temporary
                .persist_noclobber(path)
                .map_err(|error| error.error)?;
            return Ok(());
        }
        let mut file = fs::OpenOptions::new().append(true).open(path)?;
        file.write_all(data)
    }

    pub fn clear_text(&self, id: &str) -> io::Result<()> {
        if self.disabled {
            return Ok(());
        }
        let _io = self.io.lock().unwrap();
        let path = self.path(id, "jsonl")?;
        let file = fs::File::open(&path)?;
        let header = io::BufReader::new(file)
            .lines()
            .next()
            .transpose()?
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "empty history"))?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        temporary.write_all(header.as_bytes())?;
        temporary.write_all(b"\n")?;
        temporary.as_file().sync_all()?;
        temporary.persist(path).map_err(|error| error.error)?;
        Ok(())
    }

    pub fn clear_audio(&self, id: &str) -> io::Result<()> {
        if self.disabled {
            return Ok(());
        }
        let _io = self.io.lock().unwrap();
        let path = self.path(id, "pcm")?;
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn save(&self, saved: &SavedTranscript, audio: Option<&[u8]>) -> io::Result<()> {
        if self.disabled {
            return Ok(());
        }
        fs::create_dir_all(&self.directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))?;
        }
        let _io = self.io.lock().unwrap();
        let transcript_path = self.path(&saved.id, "json")?;
        let audio_path = self.path(&saved.id, "wav")?;
        if !transcript_path.exists() && audio_path.exists() {
            fs::remove_file(&audio_path)?;
        }
        if let Some(audio) = audio {
            let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
            temporary.write_all(audio)?;
            temporary.as_file().sync_all()?;
            temporary
                .persist_noclobber(&audio_path)
                .map_err(|error| error.error)?;
        }
        let result: io::Result<()> = (|| {
            let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
            serde_json::to_writer(&mut temporary, saved).map_err(io::Error::other)?;
            temporary.as_file().sync_all()?;
            temporary
                .persist_noclobber(&transcript_path)
                .map_err(|error| error.error)?;
            Ok(())
        })();
        if result.is_err() && audio.is_some() {
            let _ = fs::remove_file(audio_path);
        }
        result?;
        let _ = fs::remove_file(self.path(&saved.id, "jsonl")?);
        let _ = fs::remove_file(self.path(&saved.id, "pcm")?);
        Ok(())
    }

    pub fn list(&self) -> io::Result<Vec<HistoryItem>> {
        if self.disabled || !self.directory.exists() {
            return Ok(Vec::new());
        }
        let mut items = Vec::new();
        let mut ids = std::collections::HashSet::new();
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            if !matches!(
                entry.path().extension().and_then(|value| value.to_str()),
                Some("json" | "jsonl")
            ) {
                continue;
            }
            let Some(id) = entry
                .path()
                .file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_owned)
            else {
                continue;
            };
            if !ids.insert(id.clone()) {
                continue;
            }
            let Ok(saved) = self.read(&id) else {
                continue;
            };
            let has_audio = self.path(&id, "wav")?.is_file()
                || self
                    .path(&id, "pcm")?
                    .metadata()
                    .is_ok_and(|meta| meta.len() > 4);
            if saved.entries.is_empty() && !has_audio {
                continue;
            }
            items.push(HistoryItem {
                has_audio,
                count: saved.entries.len(),
                id,
                started_at_ms: saved.started_at_ms,
                ended_at_ms: saved.ended_at_ms,
                limited: saved.limited,
            });
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.started_at_ms));
        Ok(items)
    }

    pub fn page(&self, id: &str, query: &str, page: usize) -> io::Result<TranscriptPage> {
        Ok(self.read(id)?.page(query, page))
    }

    pub fn export_transcript(&self, id: &str) -> io::Result<Vec<u8>> {
        self.read(id)?
            .export()
            .map(String::into_bytes)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no transcript"))
    }

    pub fn audio(&self, id: &str) -> io::Result<Vec<u8>> {
        self.read(id)?;
        if self.disabled {
            return Err(io::Error::new(io::ErrorKind::NotFound, "history disabled"));
        }
        let wav_path = self.path(id, "wav")?;
        if !wav_path.is_file() {
            let mut file = fs::File::open(self.path(id, "pcm")?)?;
            if file.metadata()?.len() > AUDIO_BYTE_LIMIT as u64 + 4 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "audio file too large",
                ));
            }
            let mut rate = [0_u8; 4];
            file.read_exact(&mut rate)?;
            let mut pcm = Vec::new();
            file.read_to_end(&mut pcm)?;
            let mut recording = AudioRecording::default();
            recording.begin(true);
            recording.append(u32::from_le_bytes(rate), &pcm);
            return recording
                .export()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid audio"));
        }
        let mut file = fs::File::open(wav_path)?;
        if file.metadata()?.len() > crate::core::session_archive::AUDIO_BYTE_LIMIT as u64 + 44 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "audio file too large",
            ));
        }
        let mut audio = Vec::new();
        file.read_to_end(&mut audio)?;
        Ok(audio)
    }

    pub fn delete(&self, id: &str) -> io::Result<()> {
        let _io = self.io.lock().unwrap();
        let final_path = self.path(id, "json")?;
        let journal_path = self.path(id, "jsonl")?;
        let path = if final_path.is_file() {
            final_path
        } else {
            journal_path
        };
        if self.disabled {
            return Err(io::Error::new(io::ErrorKind::NotFound, "history disabled"));
        }
        if !path.is_file() {
            return Err(io::Error::new(io::ErrorKind::NotFound, "session missing"));
        }
        for extension in ["wav", "pcm", "jsonl"] {
            let other = self.path(id, extension)?;
            if other.exists() && other != path {
                fs::remove_file(other)?;
            }
        }
        fs::remove_file(path)
    }

    pub fn discard(&self, id: &str) -> io::Result<()> {
        if self.disabled {
            return Ok(());
        }
        let _io = self.io.lock().unwrap();
        for extension in ["jsonl", "pcm"] {
            let path = self.path(id, extension)?;
            if path.exists() {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::SubtitlePair;

    #[test]
    fn saves_lists_reads_and_deletes_one_session_without_path_escape() {
        let directory = tempfile::tempdir().unwrap();
        let history = SessionHistory::new(directory.path().join("history"), false);
        let id = uuid::Uuid::new_v4().to_string();
        let saved = SavedTranscript {
            version: 1,
            id: id.clone(),
            started_at_ms: 100,
            ended_at_ms: 200,
            limited: false,
            entries: vec![SubtitlePair::new("source".into(), "译文".into(), 150)],
        };
        history.save(&saved, Some(b"synthetic wav")).unwrap();
        assert_eq!(history.list().unwrap()[0].count, 1);
        assert!(history.list().unwrap()[0].has_audio);
        assert_eq!(history.page(&id, "译文", 0).unwrap().total, 1);
        assert_eq!(history.audio(&id).unwrap(), b"synthetic wav");
        assert!(history.delete("../escape").is_err());
        history.delete(&id).unwrap();
        assert!(history.list().unwrap().is_empty());
    }

    #[test]
    fn interrupted_session_is_readable_from_incremental_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history");
        let history = SessionHistory::new(path.clone(), false);
        let id = uuid::Uuid::new_v4().to_string();
        history.begin(&id, 100).unwrap();
        history
            .append_pair(&id, &SubtitlePair::new("spoken".into(), "译文".into(), 150))
            .unwrap();
        history.append_pcm(&id, 16_000, &[1, 0, 2, 0]).unwrap();
        drop(history);

        let restored = SessionHistory::new(path, false);
        let item = &restored.list().unwrap()[0];
        assert_eq!((item.count, item.has_audio), (1, true));
        assert_eq!(restored.page(&id, "spoken", 0).unwrap().total, 1);
        let wav = restored.audio(&id).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[44..], &[1, 0, 2, 0]);
        restored.clear_text(&id).unwrap();
        assert_eq!(restored.list().unwrap()[0].count, 0);
        restored.delete(&id).unwrap();
        assert!(restored.list().unwrap().is_empty());
    }
}
