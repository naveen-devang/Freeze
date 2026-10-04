//! Pure helpers for the sensor sources: parsing OS names and values, and the small rules that decide
//! what a reading means. Kept free of OS calls so they're unit-tested on every platform.
// Windows and macOS each use about half of these.
#![allow(dead_code)]
use super::{GpuKind, Vendor};

impl Vendor {
    pub(super) fn from_pci(id: u32) -> Self {
        match id {
            0x10DE => Vendor::Nvidia,
            0x1002 | 0x1022 => Vendor::Amd,
            0x8086 => Vendor::Intel,
            0x106B => Vendor::Apple,
            _ => Vendor::Other,
        }
    }

    pub(super) fn name(self) -> &'static str {
        match self {
            Vendor::Nvidia => "NVIDIA",
            Vendor::Amd => "AMD",
            Vendor::Intel => "Intel",
            Vendor::Apple => "Apple",
            Vendor::Other => "GPU",
        }
    }
}

/// A GPU id that survives reboots and driver installs (Windows LUIDs don't), so a widget can keep
/// following the same card. `ordinal` separates identical cards.
pub(super) fn gpu_id(vendor: u32, device: u32, subsys: u32, ordinal: usize) -> String {
    format!("{vendor:04x}-{device:04x}-{subsys:08x}-{ordinal}")
}

/// Windows LUID as it appears in performance counter instance names, e.g. "0x00000000_0x0001010e".
pub(super) fn luid_key(high: i32, low: u32) -> String {
    format!("0x{:08x}_0x{:08x}", high as u32, low)
}

/// The LUID and engine index from a "GPU Engine" counter instance such as
/// "pid_1234_luid_0x00000000_0x0001010E_phys_0_eng_0_engtype_3D".
pub(super) fn engine_instance(name: &str) -> Option<(String, u32)> {
    let name = name.to_ascii_lowercase();
    let luid = luid_in(&name)?;
    let engine = name
        .split("_eng_")
        .nth(1)?
        .split('_')
        .next()?
        .parse()
        .ok()?;
    Some((luid, engine))
}

/// The LUID from a "GPU Adapter Memory" counter instance such as "luid_0x00000000_0x0001010e_phys_0".
pub(super) fn adapter_instance(name: &str) -> Option<String> {
    luid_in(&name.to_ascii_lowercase())
}

fn luid_in(name: &str) -> Option<String> {
    let rest = &name[name.find("luid_")? + 5..];
    let key = rest.get(..21)?;
    let valid = key.as_bytes()[10] == b'_'
        && key.split('_').all(|part| {
            part.len() == 10
                && part.starts_with("0x")
                && part[2..].chars().all(|c| c.is_ascii_hexdigit())
        });
    valid.then(|| key.to_owned())
}

/// Vendor, device and subsystem ids from a PCI device instance id such as
/// "PCI\VEN_10DE&DEV_1F15&SUBSYS_14421025&REV_A1\4&2A8DCF3A&0&0008".
pub(super) fn pci_ids(instance: &str) -> Option<(u32, u32, u32)> {
    let upper = instance.to_ascii_uppercase();
    if !upper.starts_with("PCI\\") {
        return None;
    }
    let field = |name: &str, len: usize| {
        let start = upper.find(name)? + name.len();
        u32::from_str_radix(upper.get(start..start + len)?, 16).ok()
    };
    Some((
        field("VEN_", 4)?,
        field("DEV_", 4)?,
        field("SUBSYS_", 8).unwrap_or(0),
    ))
}

/// Whether a PnP id string (ADL/ADLX "PNPString") names this exact card.
pub(super) fn pnp_matches(pnp: &str, vendor: u32, device: u32, subsys: u32) -> bool {
    pci_ids(pnp).is_some_and(|(v, d, s)| {
        v == vendor && d == device && (s == 0 || subsys == 0 || s == subsys)
    })
}

/// Integrated or discrete when Windows' hybrid flags don't say. Integrated GPUs carve out a small
/// dedicated aperture (Intel ~128 MB, AMD APUs 512 MB to 2 GB); discrete cards report their VRAM.
pub(super) fn guess_kind(vendor: Vendor, dedicated_bytes: u64) -> GpuKind {
    const GIB: u64 = 1 << 30;
    match vendor {
        Vendor::Nvidia => GpuKind::Discrete,
        Vendor::Intel if dedicated_bytes < GIB => GpuKind::Integrated,
        // ponytail: AMD APUs set to a 2 GB+ UMA buffer read as discrete; harmless except for "Automatic" GPU choice.
        Vendor::Amd if dedicated_bytes <= GIB => GpuKind::Integrated,
        Vendor::Intel | Vendor::Amd => GpuKind::Discrete,
        Vendor::Apple => GpuKind::Integrated,
        Vendor::Other => GpuKind::Unknown,
    }
}

/// What a macOS temperature sensor measures, from its sysinfo label: SMC names on Intel Macs
/// ("PECI CPU", "CPU Proximity", "GPU"), IOHID names on Apple Silicon ("pACC MTR Temp Sensor0",
/// "PMU tdie1", "GPU MTR Temp Sensor1").
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum MacSensor {
    Cpu,
    Gpu,
}

pub(super) fn mac_sensor(label: &str) -> Option<MacSensor> {
    let label = label.to_ascii_lowercase();
    if label.starts_with("gpu") {
        Some(MacSensor::Gpu)
    } else if label.contains("cpu")
        || label.starts_with("pacc")
        || label.starts_with("eacc")
        || label.starts_with("pmu tdie")
    {
        Some(MacSensor::Cpu)
    } else {
        None
    }
}

/// Decodes an SMC value by its type code. Intel Macs store fan speeds as "fpe2" (unsigned 14.2 fixed
/// point, big-endian); Apple Silicon uses "flt " (little-endian f32). Counts are "ui8 ".
pub(super) fn smc_value(data_type: [u8; 4], bytes: &[u8]) -> Option<f32> {
    match &data_type {
        b"fpe2" => Some(f32::from(u16::from_be_bytes([*bytes.first()?, *bytes.get(1)?])) / 4.0),
        b"flt " => Some(f32::from_le_bytes(bytes.get(..4)?.try_into().ok()?)),
        b"ui8 " => Some(f32::from(*bytes.first()?)),
        b"ui16" => Some(f32::from(u16::from_be_bytes([
            *bytes.first()?,
            *bytes.get(1)?,
        ]))),
        _ => None,
    }
}

/// Flags a temperature sensor that never moves. Many desktops report a fixed ACPI thermal zone
/// (often 27.8 °C) that would otherwise pass for a CPU temperature. A sensor is stuck once its value
/// hasn't changed for `STUCK_AFTER` seconds while CPU load swung by at least 30 points.
pub(super) struct StuckSensor {
    value: f32,
    since: f64,
    load_min: f32,
    load_max: f32,
}

pub(super) const STUCK_AFTER: f64 = 300.0;

impl StuckSensor {
    pub(super) fn new() -> Self {
        Self {
            value: f32::NAN,
            since: 0.0,
            load_min: f32::MAX,
            load_max: f32::MIN,
        }
    }

    /// Records a reading at `now` seconds and returns whether the sensor counts as stuck.
    pub(super) fn observe(&mut self, value: f32, load: f32, now: f64) -> bool {
        if value != self.value {
            *self = Self {
                value,
                since: now,
                load_min: load,
                load_max: load,
            };
            return false;
        }
        self.load_min = self.load_min.min(load);
        self.load_max = self.load_max.max(load);
        now - self.since >= STUCK_AFTER && self.load_max - self.load_min >= 30.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_counter_instances() {
        assert_eq!(
            engine_instance("pid_1234_luid_0x00000000_0x0001010E_phys_0_eng_3_engtype_VideoDecode"),
            Some(("0x00000000_0x0001010e".into(), 3))
        );
        assert_eq!(
            adapter_instance("luid_0x00000000_0x000103cc_phys_0"),
            Some("0x00000000_0x000103cc".into())
        );
        assert_eq!(engine_instance("pid_1234_luid_bad_phys_0_eng_0"), None);
        assert_eq!(adapter_instance("_Total"), None);
        assert_eq!(luid_key(0, 0x0001010e), "0x00000000_0x0001010e");
        assert_eq!(luid_key(-1, 1), "0xffffffff_0x00000001");
    }

    #[test]
    fn parses_pci_ids() {
        assert_eq!(
            pci_ids(r"PCI\VEN_10DE&DEV_1F15&SUBSYS_14421025&REV_A1\4&2A8DCF3A&0&0008"),
            Some((0x10de, 0x1f15, 0x1442_1025))
        );
        assert_eq!(pci_ids(r"PCI\VEN_8086&DEV_9BC4"), Some((0x8086, 0x9bc4, 0)));
        assert_eq!(pci_ids(r"ROOT\BasicDisplay\0000"), None);
        assert!(pnp_matches(
            r"PCI\VEN_1002&DEV_73BF&SUBSYS_0E3A1002&REV_C1",
            0x1002,
            0x73bf,
            0x0e3a_1002
        ));
        assert!(!pnp_matches(
            r"PCI\VEN_1002&DEV_73BF&SUBSYS_0E3A1002",
            0x1002,
            0x73bf,
            0x1234_5678
        ));
        assert_eq!(
            gpu_id(0x10de, 0x1f15, 0x1442_1025, 0),
            "10de-1f15-14421025-0"
        );
    }

    #[test]
    fn guesses_gpu_kind() {
        assert_eq!(guess_kind(Vendor::Intel, 128 << 20), GpuKind::Integrated);
        assert_eq!(guess_kind(Vendor::Intel, 8 << 30), GpuKind::Discrete);
        assert_eq!(guess_kind(Vendor::Amd, 512 << 20), GpuKind::Integrated);
        assert_eq!(guess_kind(Vendor::Amd, 8 << 30), GpuKind::Discrete);
        assert_eq!(guess_kind(Vendor::Nvidia, 0), GpuKind::Discrete);
    }

    #[test]
    fn classifies_mac_sensors() {
        assert_eq!(mac_sensor("PECI CPU"), Some(MacSensor::Cpu));
        assert_eq!(mac_sensor("CPU Proximity"), Some(MacSensor::Cpu));
        assert_eq!(mac_sensor("pACC MTR Temp Sensor2"), Some(MacSensor::Cpu));
        assert_eq!(mac_sensor("PMU tdie4"), Some(MacSensor::Cpu));
        assert_eq!(mac_sensor("GPU"), Some(MacSensor::Gpu));
        assert_eq!(mac_sensor("GPU MTR Temp Sensor1"), Some(MacSensor::Gpu));
        assert_eq!(mac_sensor("Battery"), None);
        assert_eq!(mac_sensor("NAND CH0 temp"), None);
    }

    #[test]
    fn decodes_smc_values() {
        // 1200 RPM in fpe2 is 4800 = 0x12C0.
        assert_eq!(smc_value(*b"fpe2", &[0x12, 0xC0]), Some(1200.0));
        assert_eq!(smc_value(*b"flt ", &1850.5f32.to_le_bytes()), Some(1850.5));
        assert_eq!(smc_value(*b"ui8 ", &[2]), Some(2.0));
        assert_eq!(smc_value(*b"sp78", &[0, 0]), None);
        assert_eq!(smc_value(*b"fpe2", &[1]), None);
    }

    #[test]
    fn flags_stuck_sensors_only_when_load_moves() {
        let mut sensor = StuckSensor::new();
        assert!(!sensor.observe(27.8, 5.0, 0.0));
        assert!(!sensor.observe(27.8, 90.0, 100.0));
        assert!(sensor.observe(27.8, 10.0, STUCK_AFTER));
        // A change clears it.
        assert!(!sensor.observe(28.0, 10.0, STUCK_AFTER + 1.0));
        // An unchanged value on an idle PC isn't stuck: the load never moved.
        let mut idle = StuckSensor::new();
        idle.observe(40.0, 2.0, 0.0);
        assert!(!idle.observe(40.0, 3.0, STUCK_AFTER * 2.0));
    }
}
