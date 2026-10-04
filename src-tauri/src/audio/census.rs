//! Read-only audio census: which render endpoints exist, how loud they are, and
//! which applications currently hold audio sessions on them.
//!
//! Enumerated on demand (never cached), mirroring OBS: device lists and session
//! tables go stale the moment a driver resets, and a fresh scan of a handful of
//! endpoints costs single-digit milliseconds. Levels come from
//! `IAudioMeterInformation`, which reports the peak of the *previous* device
//! period (about 10 ms in shared mode), so callers poll at low frequency.

use serde::Serialize;

/// One render endpoint and its current peak level (0.0..=1.0).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EndpointCensus {
    pub id: String,
    pub name: String,
    pub level: f32,
}

/// One application audio session, grouped under the endpoint it plays to.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SessionCensus {
    pub endpoint_id: String,
    pub pid: u32,
    pub name: String,
    /// `true` while the session state is `AudioSessionStateActive`, i.e. the
    /// application is rendering audio (it may still be silent).
    pub active: bool,
    pub level: f32,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct AudioCensus {
    pub endpoints: Vec<EndpointCensus>,
    pub sessions: Vec<SessionCensus>,
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{AudioCensus, EndpointCensus, SessionCensus};
    use crate::audio::windows::{com_endpoint_id, with_com};
    use windows::core::Interface;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{
        eRender, IAudioSessionControl2, IAudioSessionEnumerator, IAudioSessionManager2, IMMDevice,
        IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL, STGM_READ};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    pub fn census() -> AudioCensus {
        with_com(|| unsafe {
            let mut result = AudioCensus::default();
            let Ok(enumerator): Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return result;
            };
            let Ok(collection) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else {
                return result;
            };
            let Ok(count) = collection.GetCount() else {
                return result;
            };
            for index in 0..count {
                let Ok(device) = collection.Item(index) else {
                    continue;
                };
                let Some(id) = com_endpoint_id(&device) else {
                    continue;
                };
                let level = meter_of(&device)
                    .and_then(|meter| meter.GetPeakValue().ok())
                    .unwrap_or(0.0);
                result.endpoints.push(EndpointCensus {
                    name: friendly_name(&device).unwrap_or_else(|| id.clone()),
                    id: id.clone(),
                    level,
                });
                collect_sessions(&device, &id, &mut result.sessions);
            }
            result
        })
    }

    unsafe fn friendly_name(device: &IMMDevice) -> Option<String> {
        let store: IPropertyStore = device.OpenPropertyStore(STGM_READ).ok()?;
        let mut value = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME).ok()?;
        let name = if value.Anonymous.Anonymous.vt == VT_LPWSTR {
            let wide = value.Anonymous.Anonymous.Anonymous.pwszVal;
            if wide.is_null() {
                None
            } else {
                wide.to_string().ok()
            }
        } else {
            None
        };
        let _ = PropVariantClear(&mut value);
        name
    }

    unsafe fn meter_of(device: &IMMDevice) -> Option<IAudioMeterInformation> {
        device
            .Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)
            .ok()
    }

    unsafe fn collect_sessions(
        device: &IMMDevice,
        endpoint_id: &str,
        out: &mut Vec<SessionCensus>,
    ) {
        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
            return;
        };
        let Ok(enumerator): Result<IAudioSessionEnumerator, _> = manager.GetSessionEnumerator()
        else {
            return;
        };
        let Ok(count) = enumerator.GetCount() else {
            return;
        };
        for index in 0..count {
            let Ok(control) = enumerator.GetSession(index) else {
                continue;
            };
            // `GetSession` hands back the base interface; process id and state
            // live on `IAudioSessionControl2`.
            let Ok(control) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(pid) = control.GetProcessId() else {
                continue;
            };
            let active = control.GetState().is_ok_and(|state| state.0 == 1);
            let level = control
                .cast::<IAudioMeterInformation>()
                .ok()
                .and_then(|meter| meter.GetPeakValue().ok())
                .unwrap_or(0.0);
            out.push(SessionCensus {
                endpoint_id: endpoint_id.to_string(),
                pid,
                name: process_name(pid).unwrap_or_else(|| pid.to_string()),
                active,
                level,
            });
        }
    }

    unsafe fn process_name(pid: u32) -> Option<String> {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = vec![0u16; 260];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        ok.ok()?;
        buffer.truncate(length as usize);
        let path = String::from_utf16_lossy(&buffer);
        Some(path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string())
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::AudioCensus;

    /// Only Windows exposes loopback levels and session tables today; the other
    /// platforms keep their existing single-source capture and report nothing.
    pub fn census() -> AudioCensus {
        AudioCensus::default()
    }
}

pub use platform::census;

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn census_reports_render_endpoints_with_bounded_levels() {
        let census = census();
        // When CPAL can see render devices the census must see them too; a
        // headless CI machine is allowed to report none.
        let cpal_devices = cpal::traits::HostTrait::output_devices(&cpal::default_host())
            .map(|devices| devices.count())
            .unwrap_or(0);
        if cpal_devices > 0 {
            assert!(
                !census.endpoints.is_empty(),
                "census missed {cpal_devices} render endpoints"
            );
        }
        for endpoint in &census.endpoints {
            assert!(!endpoint.id.is_empty());
            assert!(!endpoint.name.is_empty());
            assert!(
                (0.0..=1.0).contains(&endpoint.level),
                "level {}",
                endpoint.level
            );
        }
        for session in &census.sessions {
            assert!(
                (0.0..=1.0).contains(&session.level),
                "level {}",
                session.level
            );
            assert!(!session.name.is_empty());
        }
    }
}
