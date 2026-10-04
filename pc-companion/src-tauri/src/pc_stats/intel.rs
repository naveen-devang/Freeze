//! Intel readings through the Intel Graphics Control Library (ControlLib.dll, installed with Arc and
//! Xe drivers). Gen 9 GPUs such as UHD 620/630 aren't supported by IGCL; they fall back to D3DKMT
//! and to the CPU die temperature. Layouts follow intel/drivers.gpu.control-library include/igcl_api.h.
use super::{round, windows::Adapter, VendorReadings};
use libloading::Library;
use std::{
    collections::HashMap,
    ffi::{c_char, c_void},
    time::{Duration, Instant},
};
use windows::Win32::Foundation::LUID;

const RETRY_EVERY: Duration = Duration::from_secs(60);
const CTL_RESULT_SUCCESS: u32 = 0;
// CTL_MAKE_VERSION(1, 1)
const CTL_IMPL_VERSION: u32 = (1 << 16) | 1;
const CTL_INIT_FLAG_USE_LEVEL_ZERO: u32 = 1;
const CTL_TEMP_SENSORS_GPU: u32 = 1;
const CTL_FAN_SPEED_UNITS_RPM: u32 = 0;

type Handle = *mut c_void;

#[repr(C)]
struct InitArgs {
    size: u32,
    version: u8,
    app_version: u32,
    flags: u32,
    supported_version: u32,
    application_uid: [u32; 4],
}

#[repr(C)]
struct AdapterProperties {
    size: u32,
    version: u8,
    device_id: *mut c_void,
    device_id_size: u32,
    device_type: u32,
    supported_subfunction_flags: u32,
    driver_version: u64,
    firmware_version: [u64; 3],
    pci_vendor_id: u32,
    pci_device_id: u32,
    rev_id: u32,
    num_eus_per_sub_slice: u32,
    num_sub_slices_per_slice: u32,
    num_slices: u32,
    name: [c_char; 100],
    graphics_adapter_properties: u32,
    frequency: u32,
    pci_subsys_id: u16,
    pci_subsys_vendor_id: u16,
    adapter_bdf: [u8; 3],
    num_xe_cores: u32,
    reserved: [u8; 108],
}

#[repr(C)]
struct TempProperties {
    size: u32,
    version: u8,
    kind: u32,
    max_temperature: f64,
}

#[repr(C)]
struct EnergyCounter {
    size: u32,
    version: u8,
    /// Microjoules.
    energy: u64,
    /// Microseconds.
    timestamp: u64,
}

type Enumerate = unsafe extern "C" fn(Handle, *mut u32, *mut Handle) -> u32;

struct Api {
    _library: Library,
    handle: Handle,
    enumerate_devices: Enumerate,
    get_device_properties: unsafe extern "C" fn(Handle, *mut AdapterProperties) -> u32,
    enum_temperature_sensors: Enumerate,
    temperature_get_properties: unsafe extern "C" fn(Handle, *mut TempProperties) -> u32,
    temperature_get_state: unsafe extern "C" fn(Handle, *mut f64) -> u32,
    enum_power_domains: Enumerate,
    power_get_energy_counter: unsafe extern "C" fn(Handle, *mut EnergyCounter) -> u32,
    enum_fans: Enumerate,
    fan_get_state: unsafe extern "C" fn(Handle, u32, *mut i32) -> u32,
}

/// The sensors found for one GPU.
struct Device {
    temperature: Option<Handle>,
    power: Option<Handle>,
    fan: Option<Handle>,
    /// Previous energy reading (microjoules, microseconds) for watts.
    energy: Option<(u64, u64)>,
}

pub(super) struct Intel {
    api: Option<Api>,
    failed_at: Option<Instant>,
    devices: HashMap<String, Option<Device>>,
}

impl Intel {
    pub(super) fn new() -> Self {
        Self {
            api: None,
            failed_at: None,
            devices: HashMap::new(),
        }
    }

    pub(super) fn read(&mut self, adapter: &Adapter) -> Option<(&'static str, VendorReadings)> {
        if self.api.is_none() && self.failed_at.is_none_or(|at| at.elapsed() >= RETRY_EVERY) {
            self.api = unsafe { Api::load() };
            if self.api.is_none() {
                self.failed_at = Some(Instant::now());
            }
        }
        let api = self.api.as_ref()?;
        let device = self
            .devices
            .entry(adapter.id.clone())
            .or_insert_with(|| unsafe { api.find(adapter.luid) })
            .as_mut()?;
        unsafe { api.read(device) }.map(|readings| ("igcl", readings))
    }
}

/// Calls an IGCL enumerate function the usual two-step way: count, then handles.
unsafe fn handles(enumerate: Enumerate, parent: Handle) -> Vec<Handle> {
    let mut count = 0;
    if enumerate(parent, &mut count, std::ptr::null_mut()) != CTL_RESULT_SUCCESS
        || count == 0
        || count > 64
    {
        return Vec::new();
    }
    let mut out = vec![std::ptr::null_mut(); count as usize];
    if enumerate(parent, &mut count, out.as_mut_ptr()) != CTL_RESULT_SUCCESS {
        return Vec::new();
    }
    out.truncate(count as usize);
    out
}

impl Api {
    unsafe fn load() -> Option<Self> {
        let library = super::windows::load_system_library("ControlLib.dll")?;
        let init = *library
            .get::<unsafe extern "C" fn(*mut InitArgs, *mut Handle) -> u32>(b"ctlInit\0")
            .ok()?;
        let mut args = InitArgs {
            size: size_of::<InitArgs>() as u32,
            version: 0,
            app_version: CTL_IMPL_VERSION,
            flags: CTL_INIT_FLAG_USE_LEVEL_ZERO,
            supported_version: 0,
            application_uid: [0; 4],
        };
        let mut handle = std::ptr::null_mut();
        if init(&mut args, &mut handle) != CTL_RESULT_SUCCESS || handle.is_null() {
            return None;
        }
        macro_rules! symbol {
            ($name:literal) => {
                *library.get(concat!($name, "\0").as_bytes()).ok()?
            };
        }
        Some(Self {
            enumerate_devices: symbol!("ctlEnumerateDevices"),
            get_device_properties: symbol!("ctlGetDeviceProperties"),
            enum_temperature_sensors: symbol!("ctlEnumTemperatureSensors"),
            temperature_get_properties: symbol!("ctlTemperatureGetProperties"),
            temperature_get_state: symbol!("ctlTemperatureGetState"),
            enum_power_domains: symbol!("ctlEnumPowerDomains"),
            power_get_energy_counter: symbol!("ctlPowerGetEnergyCounter"),
            enum_fans: symbol!("ctlEnumFans"),
            fan_get_state: symbol!("ctlFanGetState"),
            handle,
            _library: library,
        })
    }

    /// The IGCL device whose OS device id (the adapter LUID) matches, and its sensors.
    unsafe fn find(&self, luid: LUID) -> Option<Device> {
        let device = handles(self.enumerate_devices, self.handle)
            .into_iter()
            .find(|device| {
                let mut id = LUID::default();
                let mut properties: AdapterProperties = std::mem::zeroed();
                properties.size = size_of::<AdapterProperties>() as u32;
                properties.version = 2;
                properties.device_id = &mut id as *mut LUID as *mut c_void;
                properties.device_id_size = size_of::<LUID>() as u32;
                (self.get_device_properties)(*device, &mut properties) == CTL_RESULT_SUCCESS
                    && id.LowPart == luid.LowPart
                    && id.HighPart == luid.HighPart
            })?;
        let sensors = handles(self.enum_temperature_sensors, device);
        let temperature = sensors
            .iter()
            .copied()
            .find(|sensor| {
                let mut properties = TempProperties {
                    size: size_of::<TempProperties>() as u32,
                    version: 0,
                    kind: u32::MAX,
                    max_temperature: 0.0,
                };
                (self.temperature_get_properties)(*sensor, &mut properties) == CTL_RESULT_SUCCESS
                    && properties.kind == CTL_TEMP_SENSORS_GPU
            })
            .or_else(|| sensors.first().copied());
        Some(Device {
            temperature,
            power: handles(self.enum_power_domains, device).first().copied(),
            fan: handles(self.enum_fans, device).first().copied(),
            energy: None,
        })
    }

    unsafe fn read(&self, device: &mut Device) -> Option<VendorReadings> {
        let temp = device.temperature.and_then(|sensor| {
            let mut celsius = 0.0;
            ((self.temperature_get_state)(sensor, &mut celsius) == CTL_RESULT_SUCCESS
                && celsius > 0.0
                && celsius < 150.0)
                .then(|| round(celsius as f32))
        });
        let power = device.power.and_then(|domain| {
            let mut counter = EnergyCounter {
                size: size_of::<EnergyCounter>() as u32,
                version: 0,
                energy: 0,
                timestamp: 0,
            };
            if (self.power_get_energy_counter)(domain, &mut counter) != CTL_RESULT_SUCCESS {
                return None;
            }
            let previous = device.energy.replace((counter.energy, counter.timestamp))?;
            let (joules, seconds) = (
                counter.energy.checked_sub(previous.0)? as f64 / 1e6,
                counter.timestamp.checked_sub(previous.1)? as f64 / 1e6,
            );
            (seconds > 0.0).then(|| round((joules / seconds) as f32))
        });
        let fan_rpm = device.fan.and_then(|fan| {
            let mut rpm = 0;
            ((self.fan_get_state)(fan, CTL_FAN_SPEED_UNITS_RPM, &mut rpm) == CTL_RESULT_SUCCESS
                && rpm > 0)
                .then_some(rpm as f32)
        });
        (temp.is_some() || power.is_some() || fan_rpm.is_some()).then_some(VendorReadings {
            temp,
            power,
            fan_rpm,
            ..VendorReadings::default()
        })
    }
}

// Struct sizes from igcl_api.h on 64-bit Windows; a layout slip fails the build.
const _: () = {
    assert!(size_of::<InitArgs>() == 36);
    assert!(size_of::<TempProperties>() == 24);
    assert!(size_of::<EnergyCounter>() == 24);
    assert!(std::mem::offset_of!(AdapterProperties, pci_vendor_id) == 64);
    assert!(std::mem::offset_of!(AdapterProperties, name) == 88);
    assert!(std::mem::offset_of!(AdapterProperties, pci_subsys_id) == 196);
};
