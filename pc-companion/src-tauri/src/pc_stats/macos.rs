//! macOS GPU detection and sensors. No root and no extra permissions.
//!
//! GPUs: every IOAccelerator in the IOKit registry (Apple Silicon, Intel, AMD, older NVIDIA).
//!   load, memory   its PerformanceStatistics, the numbers Activity Monitor uses
//!   temp, power    PerformanceStatistics on AMD cards; die sensors on Apple Silicon and the SMC
//!                  "GPU" sensor on Intel Macs (both through sysinfo)
//!   fan            the SMC fan speed (system fans cool the GPU too); fanless Macs report none
//! CPU temperature: the hottest CPU die sensor (sysinfo), an exact reading.
use super::{fill, parse, round, CpuTemp, GpuKind, GpuStats, MemKind, Vendor, GB};
use std::{
    ffi::{c_char, c_void, CStr},
    time::{Duration, Instant},
};
use sysinfo::Components;

type CFTypeRef = *const c_void;
type MachPort = u32;
type IoObject = u32;
type KernReturn = i32;

const UTF8: u32 = 0x0800_0100;
const CF_NUMBER_SINT64: isize = 4;
const CF_NUMBER_DOUBLE: isize = 13;
/// kIOMainPortDefault.
const MAIN_PORT: MachPort = 0;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(
        allocator: CFTypeRef,
        text: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
    fn CFDictionaryGetValue(dictionary: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFGetTypeID(value: CFTypeRef) -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFDataGetTypeID() -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFNumberGetValue(number: CFTypeRef, kind: isize, out: *mut c_void) -> u8;
    fn CFDataGetLength(data: CFTypeRef) -> isize;
    fn CFDataGetBytePtr(data: CFTypeRef) -> *const u8;
    fn CFStringGetCString(text: CFTypeRef, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
    fn CFRelease(value: CFTypeRef);
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const c_char) -> CFTypeRef;
    fn IOServiceGetMatchingServices(
        port: MachPort,
        matching: CFTypeRef,
        iterator: *mut IoObject,
    ) -> KernReturn;
    fn IOServiceGetMatchingService(port: MachPort, matching: CFTypeRef) -> IoObject;
    fn IOIteratorNext(iterator: IoObject) -> IoObject;
    fn IOObjectRelease(object: IoObject) -> KernReturn;
    fn IOObjectGetClass(object: IoObject, class_name: *mut c_char) -> KernReturn;
    fn IORegistryEntryCreateCFProperties(
        entry: IoObject,
        properties: *mut CFTypeRef,
        allocator: CFTypeRef,
        options: u32,
    ) -> KernReturn;
    fn IORegistryEntryGetParentEntry(
        entry: IoObject,
        plane: *const c_char,
        parent: *mut IoObject,
    ) -> KernReturn;
    fn IOServiceOpen(
        service: IoObject,
        owning_task: MachPort,
        kind: u32,
        connection: *mut IoObject,
    ) -> KernReturn;
    fn IOServiceClose(connection: IoObject) -> KernReturn;
    fn IOConnectCallStructMethod(
        connection: IoObject,
        selector: u32,
        input: *const c_void,
        input_size: usize,
        output: *mut c_void,
        output_size: *mut usize,
    ) -> KernReturn;
}

unsafe extern "C" {
    static mach_task_self_: MachPort;
}

/// A CoreFoundation dictionary we own (from a Create call), released on drop.
struct Dictionary(CFTypeRef);

impl Drop for Dictionary {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

/// A dictionary value by key; borrowed from `dictionary`, valid while it lives.
unsafe fn get(dictionary: CFTypeRef, key: &CStr) -> Option<CFTypeRef> {
    if dictionary.is_null() || CFGetTypeID(dictionary) != CFDictionaryGetTypeID() {
        return None;
    }
    let key = CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), UTF8);
    if key.is_null() {
        return None;
    }
    let value = CFDictionaryGetValue(dictionary, key);
    CFRelease(key);
    (!value.is_null()).then_some(value)
}

unsafe fn number(dictionary: CFTypeRef, key: &CStr) -> Option<f64> {
    let value = get(dictionary, key)?;
    if CFGetTypeID(value) != CFNumberGetTypeID() {
        return None;
    }
    let mut out = 0f64;
    (CFNumberGetValue(value, CF_NUMBER_DOUBLE, &mut out as *mut f64 as *mut c_void) != 0)
        .then_some(out)
}

/// A string property, stored either as CFString or as NUL-terminated CFData (PCI "model").
unsafe fn text(dictionary: CFTypeRef, key: &CStr) -> Option<String> {
    let value = get(dictionary, key)?;
    let kind = CFGetTypeID(value);
    if kind == CFStringGetTypeID() {
        let mut buffer = [0 as c_char; 256];
        return (CFStringGetCString(value, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) != 0)
            .then(|| {
                CStr::from_ptr(buffer.as_ptr())
                    .to_string_lossy()
                    .trim()
                    .to_owned()
            });
    }
    let bytes = data(value)?;
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    Some(String::from_utf8_lossy(&bytes[..end]).trim().to_owned())
}

unsafe fn data<'a>(value: CFTypeRef) -> Option<&'a [u8]> {
    if CFGetTypeID(value) != CFDataGetTypeID() {
        return None;
    }
    Some(std::slice::from_raw_parts(
        CFDataGetBytePtr(value),
        CFDataGetLength(value).max(0) as usize,
    ))
}

/// A little-endian u32 stored as CFData (PCI "vendor-id", "device-id") or as a CFNumber.
unsafe fn id(dictionary: CFTypeRef, key: &CStr) -> Option<u32> {
    let value = get(dictionary, key)?;
    if CFGetTypeID(value) == CFNumberGetTypeID() {
        let mut out = 0i64;
        return (CFNumberGetValue(value, CF_NUMBER_SINT64, &mut out as *mut i64 as *mut c_void)
            != 0)
            .then_some(out as u32);
    }
    let bytes = data(value)?;
    Some(u32::from_le_bytes([
        *bytes.first()?,
        *bytes.get(1).unwrap_or(&0),
        *bytes.get(2).unwrap_or(&0),
        *bytes.get(3).unwrap_or(&0),
    ]))
}

unsafe fn properties(entry: IoObject) -> Option<Dictionary> {
    let mut properties = std::ptr::null();
    (IORegistryEntryCreateCFProperties(entry, &mut properties, std::ptr::null(), 0) == 0
        && !properties.is_null())
    .then(|| Dictionary(properties))
}

/// One GPU's identity and IOAccelerator statistics.
struct Accelerator {
    class: String,
    vendor_id: u32,
    device_id: u32,
    model: Option<String>,
    vram_total_mb: Option<f64>,
    load: Option<f64>,
    in_use_bytes: Option<f64>,
    vram_used_bytes: Option<f64>,
    temp: Option<f64>,
    fan_percent: Option<f64>,
    power: Option<f64>,
}

unsafe fn accelerators() -> Vec<Accelerator> {
    let mut found = Vec::new();
    let mut iterator = 0;
    if IOServiceGetMatchingServices(
        MAIN_PORT,
        IOServiceMatching(c"IOAccelerator".as_ptr()),
        &mut iterator,
    ) != 0
    {
        return found;
    }
    loop {
        let service = IOIteratorNext(iterator);
        if service == 0 {
            break;
        }
        let mut class = [0 as c_char; 128];
        IOObjectGetClass(service, class.as_mut_ptr());
        let class = CStr::from_ptr(class.as_ptr())
            .to_string_lossy()
            .into_owned();
        if let Some(props) = properties(service) {
            let stats = get(props.0, c"PerformanceStatistics").unwrap_or(std::ptr::null());
            // Discrete and Intel GPUs carry their PCI identity on the parent device.
            let mut parent = 0;
            let pci = (IORegistryEntryGetParentEntry(service, c"IOService".as_ptr(), &mut parent)
                == 0)
                .then(|| {
                    let pci = properties(parent);
                    IOObjectRelease(parent);
                    pci
                })
                .flatten();
            let pci = pci.as_ref().map_or(std::ptr::null(), |pci| pci.0);
            found.push(Accelerator {
                vendor_id: id(pci, c"vendor-id").unwrap_or(0),
                device_id: id(pci, c"device-id").unwrap_or(0),
                model: text(props.0, c"model").or_else(|| text(pci, c"model")),
                vram_total_mb: number(pci, c"VRAM,totalMB")
                    .or_else(|| number(props.0, c"VRAM,totalMB")),
                load: number(stats, c"Device Utilization %")
                    .or_else(|| number(stats, c"GPU Activity(%)")),
                in_use_bytes: number(stats, c"In use system memory"),
                vram_used_bytes: number(stats, c"vramUsedBytes"),
                temp: number(stats, c"Temperature(C)"),
                fan_percent: number(stats, c"Fan Speed(%)"),
                power: number(stats, c"Total Power(W)"),
                class,
            });
        }
        IOObjectRelease(service);
    }
    IOObjectRelease(iterator);
    found
}

// --- SMC (fans) -------------------------------------------------------------
// SMCKeyData_t from Apple's SMC user client, as used by smcFanControl and the Stats app.
#[repr(C)]
#[derive(Default)]
struct SmcVersion {
    major: u8,
    minor: u8,
    build: u8,
    reserved: u8,
    release: u16,
}
#[repr(C)]
#[derive(Default)]
struct SmcPowerLimit {
    version: u16,
    length: u16,
    cpu: u32,
    gpu: u32,
    memory: u32,
}
#[repr(C)]
#[derive(Default)]
struct SmcKeyInfo {
    data_size: u32,
    data_type: u32,
    data_attributes: u8,
}
#[repr(C)]
#[derive(Default)]
struct SmcKeyData {
    key: u32,
    version: SmcVersion,
    power_limit: SmcPowerLimit,
    key_info: SmcKeyInfo,
    result: u8,
    status: u8,
    data8: u8,
    data32: u32,
    bytes: [u8; 32],
}
const _: () = assert!(size_of::<SmcKeyData>() == 80);

const SMC_KERNEL_INDEX: u32 = 2;
const SMC_READ_BYTES: u8 = 5;
const SMC_READ_KEYINFO: u8 = 9;

struct Smc(IoObject);

impl Smc {
    fn open() -> Option<Self> {
        unsafe {
            let service =
                IOServiceGetMatchingService(MAIN_PORT, IOServiceMatching(c"AppleSMC".as_ptr()));
            if service == 0 {
                return None;
            }
            let mut connection = 0;
            let opened = IOServiceOpen(service, mach_task_self_, 0, &mut connection) == 0;
            IOObjectRelease(service);
            opened.then_some(Smc(connection))
        }
    }

    fn call(&self, input: &SmcKeyData) -> Option<SmcKeyData> {
        let mut output = SmcKeyData::default();
        let mut size = size_of::<SmcKeyData>();
        let status = unsafe {
            IOConnectCallStructMethod(
                self.0,
                SMC_KERNEL_INDEX,
                input as *const SmcKeyData as *const c_void,
                size_of::<SmcKeyData>(),
                &mut output as *mut SmcKeyData as *mut c_void,
                &mut size,
            )
        };
        (status == 0 && output.result == 0).then_some(output)
    }

    fn read(&self, key: &[u8; 4]) -> Option<f32> {
        let key = u32::from_be_bytes(*key);
        let info = self
            .call(&SmcKeyData {
                key,
                data8: SMC_READ_KEYINFO,
                ..SmcKeyData::default()
            })?
            .key_info;
        let size = info.data_size.min(32);
        let output = self.call(&SmcKeyData {
            key,
            data8: SMC_READ_BYTES,
            key_info: SmcKeyInfo {
                data_size: size,
                ..SmcKeyInfo::default()
            },
            ..SmcKeyData::default()
        })?;
        parse::smc_value(info.data_type.to_be_bytes(), &output.bytes[..size as usize])
    }

    /// Fastest fan as (percent of its maximum, RPM). None on fanless Macs.
    fn fans(&self) -> Option<(f32, f32)> {
        let count = self.read(b"FNum")? as u8;
        (0..count.min(4))
            .filter_map(|index| {
                let digit = b'0' + index;
                let rpm = self.read(&[b'F', digit, b'A', b'c'])?;
                let max = self
                    .read(&[b'F', digit, b'M', b'x'])
                    .filter(|max| *max > 0.0);
                Some((
                    max.map_or(0.0, |max| (rpm / max * 100.0).clamp(0.0, 100.0)),
                    rpm,
                ))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
    }
}

impl Drop for Smc {
    fn drop(&mut self) {
        unsafe { IOServiceClose(self.0) };
    }
}

// --- Sensors -------------------------------------------------------------------

pub(super) struct Sensors {
    components: Components,
    refreshed: Instant,
    smc: Option<Smc>,
    cpu: Option<f32>,
    gpu: Option<f32>,
    raw: serde_json::Value,
}

impl Sensors {
    pub(super) fn new() -> Self {
        Self {
            components: Components::new_with_refreshed_list(),
            refreshed: Instant::now(),
            smc: Smc::open(),
            cpu: None,
            gpu: None,
            raw: serde_json::Value::Null,
        }
    }

    pub(super) fn cpu_temp(&mut self, _cpu_load: f32) -> Option<CpuTemp> {
        if self.refreshed.elapsed() >= Duration::from_secs(2) || self.cpu.is_none() {
            self.components.refresh(true);
            self.refreshed = Instant::now();
            let hottest = |group| {
                self.components
                    .iter()
                    .filter(|component| parse::mac_sensor(component.label()) == Some(group))
                    .filter_map(|component| component.temperature())
                    .filter(|celsius| *celsius > 0.0 && *celsius < 125.0)
                    .reduce(f32::max)
            };
            self.cpu = hottest(parse::MacSensor::Cpu);
            self.gpu = hottest(parse::MacSensor::Gpu);
        }
        self.cpu.map(|celsius| CpuTemp {
            celsius,
            approx: false,
            source: "sensors",
        })
    }

    pub(super) fn gpus(&mut self, ram_total_gb: f32) -> Vec<GpuStats> {
        let found = unsafe { accelerators() };
        let fans = self.smc.as_ref().and_then(Smc::fans);
        // The die/SMC GPU sensor belongs to the Apple GPU, else the discrete GPU, else the only GPU.
        let sensor_owner = found
            .iter()
            .position(|gpu| gpu.class.starts_with("AGX"))
            .or_else(|| {
                found.iter().position(|gpu| {
                    matches!(
                        Vendor::from_pci(gpu.vendor_id),
                        Vendor::Amd | Vendor::Nvidia
                    )
                })
            })
            .or_else(|| (found.len() == 1).then_some(0));
        let mut gpus = Vec::new();
        for (index, accelerator) in found.iter().enumerate() {
            let apple = accelerator.class.starts_with("AGX");
            let vendor = if apple {
                Vendor::Apple
            } else {
                Vendor::from_pci(accelerator.vendor_id)
            };
            let kind = match vendor {
                Vendor::Apple | Vendor::Intel => GpuKind::Integrated,
                Vendor::Amd | Vendor::Nvidia => GpuKind::Discrete,
                Vendor::Other => GpuKind::Unknown,
            };
            let ordinal = gpus
                .iter()
                .filter(|gpu: &&GpuStats| gpu.vendor == vendor)
                .count();
            let mut gpu = GpuStats {
                id: if apple {
                    format!("apple-gpu-{ordinal}")
                } else {
                    parse::gpu_id(accelerator.vendor_id, accelerator.device_id, 0, ordinal)
                },
                name: accelerator
                    .model
                    .clone()
                    .unwrap_or_else(|| format!("{} GPU", vendor.name())),
                vendor,
                kind,
                mem_kind: match vendor {
                    Vendor::Apple => MemKind::Unified,
                    Vendor::Intel => MemKind::Shared,
                    _ => MemKind::Dedicated,
                },
                ..GpuStats::default()
            };
            fill!(
                gpu,
                load,
                "ioaccelerator",
                accelerator
                    .load
                    .map(|load| round(load.clamp(0.0, 100.0) as f32))
            );
            let used = if kind == GpuKind::Discrete {
                accelerator.vram_used_bytes.or(accelerator.in_use_bytes)
            } else {
                accelerator.in_use_bytes
            };
            fill!(
                gpu,
                mem_used,
                "ioaccelerator",
                used.map(|bytes| round(bytes as f32 / GB))
            );
            let total = match vendor {
                Vendor::Apple => Some(ram_total_gb),
                _ => accelerator.vram_total_mb.map(|mb| mb as f32 / 1024.0),
            };
            fill!(
                gpu,
                mem_total,
                if apple {
                    "unified-memory"
                } else {
                    "ioregistry"
                },
                total.map(round)
            );
            fill!(
                gpu,
                temp,
                "ioaccelerator",
                accelerator
                    .temp
                    .filter(|celsius| *celsius > 0.0)
                    .map(|celsius| round(celsius as f32))
            );
            fill!(
                gpu,
                fan,
                "ioaccelerator",
                accelerator.fan_percent.map(|percent| round(percent as f32))
            );
            fill!(
                gpu,
                power,
                "ioaccelerator",
                accelerator
                    .power
                    .filter(|watts| *watts > 0.0)
                    .map(|watts| round(watts as f32))
            );
            if sensor_owner == Some(index) {
                fill!(
                    gpu,
                    temp,
                    if apple { "die-sensors" } else { "smc" },
                    self.gpu.map(round)
                );
            }
            if let Some((percent, rpm)) = fans {
                fill!(gpu, fan, "smc", (percent > 0.0).then(|| round(percent)));
                fill!(gpu, fan_rpm, "smc", Some(rpm.round()));
            }
            gpus.push(gpu);
        }
        self.raw = serde_json::json!({
            "accelerators": found.iter().map(|a| serde_json::json!({ "class": a.class, "vendor": a.vendor_id, "device": a.device_id, "load": a.load, "inUse": a.in_use_bytes, "vramUsed": a.vram_used_bytes, "temp": a.temp })).collect::<Vec<_>>(),
            "sensors": self.components.iter().map(|c| (c.label().to_owned(), c.temperature())).collect::<Vec<_>>(),
            "fans": fans,
        });
        gpus
    }

    pub(super) fn dump(&self) -> serde_json::Value {
        self.raw.clone()
    }
}
