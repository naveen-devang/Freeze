//! AMD readings: ADLX (amdadlx64.dll, Adrenalin 22.7 and later) first, then legacy ADL
//! (atiadlxx.dll) for older Radeons. Both are loaded at runtime. Layouts follow the official headers:
//! GPUOpen-LibrariesAndSDKs/ADLX SDK/Include (ISystem.h, IPerformanceMonitoring.h, ADLX.h) and
//! display-library include/adl_structures.h.
use super::{parse, round, windows::Adapter, VendorReadings};
use libloading::Library;
use std::{
    collections::HashMap,
    ffi::{c_char, c_void, CStr},
    time::{Duration, Instant},
};

const RETRY_EVERY: Duration = Duration::from_secs(60);

pub(super) struct Amd {
    adlx: Option<Adlx>,
    adl: Option<Adl>,
    failed_at: Option<Instant>,
}

impl Amd {
    pub(super) fn new() -> Self {
        Self {
            adlx: None,
            adl: None,
            failed_at: None,
        }
    }

    pub(super) fn read(&mut self, adapter: &Adapter) -> Option<(&'static str, VendorReadings)> {
        if self.adlx.is_none()
            && self.adl.is_none()
            && self.failed_at.is_none_or(|at| at.elapsed() >= RETRY_EVERY)
        {
            self.adlx = unsafe { Adlx::load() };
            if self.adlx.is_none() {
                self.adl = unsafe { Adl::load() };
            }
            if self.adlx.is_none() && self.adl.is_none() {
                self.failed_at = Some(Instant::now());
            }
        }
        if let Some(adlx) = &mut self.adlx {
            if let Some(readings) = unsafe { adlx.read(adapter) } {
                return Some(("adlx", readings));
            }
        }
        if let Some(adl) = &mut self.adl {
            return unsafe { adl.read(adapter) }.map(|readings| ("adl", readings));
        }
        None
    }
}

// --- ADLX ------------------------------------------------------------------
// C interfaces are a pointer to a vtable. Unused slots are left as opaque pointers so the used
// methods sit at the header's offsets. ADLX_RESULT is an int enum; ADLX_OK is 0.

const ADLX_OK: i32 = 0;
// ADLX_FULL_VERSION for SDK 2.0.0.125 (ADLXVersion.h): major << 48 | minor << 32 | release << 16 | build.
const ADLX_FULL_VERSION: u64 = (2 << 48) | 125;

type Fn0 = *const c_void;

#[repr(C)]
struct System {
    vtbl: *const SystemVtbl,
}
#[repr(C)]
struct SystemVtbl {
    get_hybrid_graphics_type: Fn0,
    get_gpus: unsafe extern "system" fn(*mut System, *mut *mut GpuList) -> i32,
    _query_interface_to_get_gpu_tuning_services: [Fn0; 7],
    get_performance_monitoring_services:
        unsafe extern "system" fn(*mut System, *mut *mut PerfServices) -> i32,
}

#[repr(C)]
struct GpuList {
    vtbl: *const GpuListVtbl,
}
#[repr(C)]
struct GpuListVtbl {
    acquire: Fn0,
    release: unsafe extern "system" fn(*mut GpuList) -> i32,
    query_interface: Fn0,
    size: unsafe extern "system" fn(*mut GpuList) -> u32,
    _empty_to_add_back: [Fn0; 7],
    at_gpu_list: unsafe extern "system" fn(*mut GpuList, u32, *mut *mut Gpu) -> i32,
}

#[repr(C)]
struct Gpu {
    vtbl: *const GpuVtbl,
}
#[repr(C)]
struct GpuVtbl {
    acquire: Fn0,
    release: unsafe extern "system" fn(*mut Gpu) -> i32,
    _query_interface_to_driver_path: [Fn0; 7],
    pnp_string: unsafe extern "system" fn(*mut Gpu, *mut *const c_char) -> i32,
    has_desktops: Fn0,
    total_vram: unsafe extern "system" fn(*mut Gpu, *mut u32) -> i32,
}

#[repr(C)]
struct PerfServices {
    vtbl: *const PerfServicesVtbl,
}
#[repr(C)]
struct PerfServicesVtbl {
    _acquire_to_get_current_all_metrics: [Fn0; 18],
    get_current_gpu_metrics:
        unsafe extern "system" fn(*mut PerfServices, *mut Gpu, *mut *mut GpuMetrics) -> i32,
}

#[repr(C)]
struct GpuMetrics {
    vtbl: *const GpuMetricsVtbl,
}
#[repr(C)]
struct GpuMetricsVtbl {
    acquire: Fn0,
    release: unsafe extern "system" fn(*mut GpuMetrics) -> i32,
    query_interface: Fn0,
    time_stamp: Fn0,
    gpu_usage: unsafe extern "system" fn(*mut GpuMetrics, *mut f64) -> i32,
    gpu_clock_speed: Fn0,
    gpu_vram_clock_speed: Fn0,
    gpu_temperature: unsafe extern "system" fn(*mut GpuMetrics, *mut f64) -> i32,
    gpu_hotspot_temperature: unsafe extern "system" fn(*mut GpuMetrics, *mut f64) -> i32,
    gpu_power: unsafe extern "system" fn(*mut GpuMetrics, *mut f64) -> i32,
    gpu_total_board_power: unsafe extern "system" fn(*mut GpuMetrics, *mut f64) -> i32,
    gpu_fan_speed: unsafe extern "system" fn(*mut GpuMetrics, *mut i32) -> i32,
    gpu_vram: unsafe extern "system" fn(*mut GpuMetrics, *mut i32) -> i32,
}

// Each used method at its index in the header's C vtable; a miscounted placeholder fails the build.
const SLOT: usize = size_of::<Fn0>();
const _: () = {
    use std::mem::offset_of;
    assert!(offset_of!(SystemVtbl, get_gpus) == 1 * SLOT);
    assert!(offset_of!(SystemVtbl, get_performance_monitoring_services) == 9 * SLOT);
    assert!(offset_of!(GpuListVtbl, size) == 3 * SLOT);
    assert!(offset_of!(GpuListVtbl, at_gpu_list) == 11 * SLOT);
    assert!(offset_of!(GpuVtbl, pnp_string) == 9 * SLOT);
    assert!(offset_of!(GpuVtbl, total_vram) == 11 * SLOT);
    assert!(offset_of!(PerfServicesVtbl, get_current_gpu_metrics) == 18 * SLOT);
    assert!(offset_of!(GpuMetricsVtbl, gpu_usage) == 4 * SLOT);
    assert!(offset_of!(GpuMetricsVtbl, gpu_temperature) == 7 * SLOT);
    assert!(offset_of!(GpuMetricsVtbl, gpu_vram) == 12 * SLOT);
    // adl_structures.h AdapterInfo on Windows: 9 ints and 6 paths.
    assert!(size_of::<AdapterInfo>() == 9 * 4 + 6 * ADL_MAX_PATH);
};

struct Adlx {
    _library: Library,
    perf: *mut PerfServices,
    /// Matched ADLX GPU (acquired, never released while ADLX lives) and its VRAM in MB, by adapter id.
    gpus: HashMap<String, Option<(*mut Gpu, u32)>>,
    system: *mut System,
}

impl Adlx {
    unsafe fn load() -> Option<Self> {
        let library = super::windows::load_system_library("amdadlx64.dll")?;
        type Init = unsafe extern "C" fn(u64, *mut *mut System) -> i32;
        let mut system = std::ptr::null_mut();
        let mut ok = false;
        // Older drivers reject a newer SDK version through ADLXInitialize but accept it here.
        for name in [
            &b"ADLXInitialize\0"[..],
            b"ADLXInitializeWithIncompatibleDriver\0",
        ] {
            if let Ok(init) = library.get::<Init>(name) {
                if init(ADLX_FULL_VERSION, &mut system) == ADLX_OK && !system.is_null() {
                    ok = true;
                    break;
                }
            }
        }
        if !ok {
            return None;
        }
        let mut perf = std::ptr::null_mut();
        if ((*(*system).vtbl).get_performance_monitoring_services)(system, &mut perf) != ADLX_OK
            || perf.is_null()
        {
            return None;
        }
        Some(Self {
            _library: library,
            perf,
            gpus: HashMap::new(),
            system,
        })
    }

    unsafe fn find(&self, adapter: &Adapter) -> Option<(*mut Gpu, u32)> {
        let mut list = std::ptr::null_mut();
        if ((*(*self.system).vtbl).get_gpus)(self.system, &mut list) != ADLX_OK || list.is_null() {
            return None;
        }
        let mut found = None;
        for index in 0..((*(*list).vtbl).size)(list) {
            let mut gpu = std::ptr::null_mut();
            if ((*(*list).vtbl).at_gpu_list)(list, index, &mut gpu) != ADLX_OK || gpu.is_null() {
                continue;
            }
            let mut pnp = std::ptr::null();
            let matches = ((*(*gpu).vtbl).pnp_string)(gpu, &mut pnp) == ADLX_OK
                && !pnp.is_null()
                && parse::pnp_matches(
                    &CStr::from_ptr(pnp).to_string_lossy(),
                    adapter.vendor_id,
                    adapter.device_id,
                    adapter.subsys,
                );
            if matches && found.is_none() {
                let mut vram = 0;
                ((*(*gpu).vtbl).total_vram)(gpu, &mut vram);
                found = Some((gpu, vram));
            } else {
                ((*(*gpu).vtbl).release)(gpu);
            }
        }
        ((*(*list).vtbl).release)(list);
        found
    }

    unsafe fn read(&mut self, adapter: &Adapter) -> Option<VendorReadings> {
        if !self.gpus.contains_key(&adapter.id) {
            let found = self.find(adapter);
            self.gpus.insert(adapter.id.clone(), found);
        }
        let (gpu, vram_mb) = (*self.gpus.get(&adapter.id)?)?;
        let mut metrics = std::ptr::null_mut();
        if ((*(*self.perf).vtbl).get_current_gpu_metrics)(self.perf, gpu, &mut metrics) != ADLX_OK
            || metrics.is_null()
        {
            return None;
        }
        let vtbl = &*(*metrics).vtbl;
        let double = |get: unsafe extern "system" fn(*mut GpuMetrics, *mut f64) -> i32| {
            let mut value = 0.0;
            (get(metrics, &mut value) == ADLX_OK && value > 0.0).then_some(value as f32)
        };
        let int = |get: unsafe extern "system" fn(*mut GpuMetrics, *mut i32) -> i32| {
            let mut value = 0;
            (get(metrics, &mut value) == ADLX_OK && value > 0).then_some(value as f32)
        };
        let readings = VendorReadings {
            temp: double(vtbl.gpu_temperature),
            hotspot: double(vtbl.gpu_hotspot_temperature),
            // Total board power on discrete cards; APUs report only GPUPower.
            power: double(vtbl.gpu_total_board_power)
                .or_else(|| double(vtbl.gpu_power))
                .map(round),
            fan_rpm: int(vtbl.gpu_fan_speed),
            load: double(vtbl.gpu_usage).map(round),
            mem_used: int(vtbl.gpu_vram).map(|mb| round(mb / 1024.0)),
            mem_total: (vram_mb > 0).then(|| round(vram_mb as f32 / 1024.0)),
            ..VendorReadings::default()
        };
        (vtbl.release)(metrics);
        Some(readings)
    }
}

// --- ADL (legacy) ------------------------------------------------------------

const ADL_MAX_PATH: usize = 256;
const ADL_DL_FANCTRL_SPEED_TYPE_RPM: i32 = 2;

#[repr(C)]
struct AdapterInfo {
    size: i32,
    adapter_index: i32,
    udid: [c_char; ADL_MAX_PATH],
    bus_number: i32,
    device_number: i32,
    function_number: i32,
    vendor_id: i32,
    adapter_name: [c_char; ADL_MAX_PATH],
    display_name: [c_char; ADL_MAX_PATH],
    present: i32,
    exist: i32,
    driver_path: [c_char; ADL_MAX_PATH],
    driver_path_ext: [c_char; ADL_MAX_PATH],
    pnp_string: [c_char; ADL_MAX_PATH],
    os_display_index: i32,
}

#[repr(C)]
struct AdlTemperature {
    size: i32,
    /// Millidegrees Celsius.
    temperature: i32,
}

#[repr(C)]
struct AdlFanSpeedValue {
    size: i32,
    speed_type: i32,
    fan_speed: i32,
    flags: i32,
}

type TemperatureGet = unsafe extern "C" fn(i32, i32, *mut AdlTemperature) -> i32;
type FanSpeedGet = unsafe extern "C" fn(i32, i32, *mut AdlFanSpeedValue) -> i32;

unsafe extern "C" {
    fn malloc(size: usize) -> *mut c_void;
}

/// ADL asks the caller for an allocator; it only allocates a few small buffers at startup.
unsafe extern "system" fn adl_malloc(size: i32) -> *mut c_void {
    unsafe { malloc(size.max(0) as usize) }
}

struct Adl {
    _library: Library,
    temperature: TemperatureGet,
    fan_speed: Option<FanSpeedGet>,
    /// ADL adapter index by adapter id; ADL lists one entry per display output, the first match is used.
    indexes: HashMap<String, Option<i32>>,
    adapters: Vec<(i32, String)>,
}

impl Adl {
    unsafe fn load() -> Option<Self> {
        let library = super::windows::load_system_library("atiadlxx.dll")?;
        let create = *library
            .get::<unsafe extern "C" fn(unsafe extern "system" fn(i32) -> *mut c_void, i32) -> i32>(
                b"ADL_Main_Control_Create\0",
            )
            .ok()?;
        if create(adl_malloc, 1) != 0 {
            return None;
        }
        let count_get = *library
            .get::<unsafe extern "C" fn(*mut i32) -> i32>(b"ADL_Adapter_NumberOfAdapters_Get\0")
            .ok()?;
        let info_get = *library
            .get::<unsafe extern "C" fn(*mut AdapterInfo, i32) -> i32>(
                b"ADL_Adapter_AdapterInfo_Get\0",
            )
            .ok()?;
        let temperature = *library
            .get::<TemperatureGet>(b"ADL_Overdrive5_Temperature_Get\0")
            .ok()?;
        let fan_speed = library
            .get::<FanSpeedGet>(b"ADL_Overdrive5_FanSpeed_Get\0")
            .ok()
            .map(|symbol| *symbol);
        let mut count = 0;
        if count_get(&mut count) != 0 || count <= 0 || count > 256 {
            return None;
        }
        let mut infos: Vec<AdapterInfo> = (0..count).map(|_| std::mem::zeroed()).collect();
        for info in &mut infos {
            info.size = size_of::<AdapterInfo>() as i32;
        }
        if info_get(
            infos.as_mut_ptr(),
            (size_of::<AdapterInfo>() * infos.len()) as i32,
        ) != 0
        {
            return None;
        }
        let adapters = infos
            .iter()
            .map(|info| {
                (
                    info.adapter_index,
                    CStr::from_ptr(info.pnp_string.as_ptr())
                        .to_string_lossy()
                        .into_owned(),
                )
            })
            .collect();
        Some(Self {
            _library: library,
            temperature,
            fan_speed,
            indexes: HashMap::new(),
            adapters,
        })
    }

    unsafe fn read(&mut self, adapter: &Adapter) -> Option<VendorReadings> {
        let index = *self.indexes.entry(adapter.id.clone()).or_insert_with(|| {
            self.adapters
                .iter()
                .find(|(_, pnp)| {
                    parse::pnp_matches(pnp, adapter.vendor_id, adapter.device_id, adapter.subsys)
                })
                .map(|(index, _)| *index)
        });
        let index = index?;
        let mut temperature = AdlTemperature {
            size: size_of::<AdlTemperature>() as i32,
            temperature: 0,
        };
        let temp = ((self.temperature)(index, 0, &mut temperature) == 0
            && temperature.temperature > 0)
            .then(|| round(temperature.temperature as f32 / 1000.0));
        let fan_rpm = self.fan_speed.and_then(|get| {
            let mut fan = AdlFanSpeedValue {
                size: size_of::<AdlFanSpeedValue>() as i32,
                speed_type: ADL_DL_FANCTRL_SPEED_TYPE_RPM,
                fan_speed: 0,
                flags: 0,
            };
            (get(index, 0, &mut fan) == 0 && fan.fan_speed > 0).then_some(fan.fan_speed as f32)
        });
        (temp.is_some() || fan_rpm.is_some()).then_some(VendorReadings {
            temp,
            fan_rpm,
            ..VendorReadings::default()
        })
    }
}
