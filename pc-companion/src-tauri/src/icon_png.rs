//! Turning a Windows icon's pixels into a PNG, and remembering icons already read. The pixel handling has no
//! Windows calls in it, so it is tested everywhere; `win_icon.rs` supplies the pixels.

use std::collections::HashMap;

/// An icon's pixels as Windows hands them over: blue, green, red, alpha per pixel, rows top to bottom.
/// Old-style icons have no alpha at all (every alpha is 0); their see-through areas come from a separate mask,
/// one bit per pixel (1 = transparent) in rows padded to 32 bits.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn bgra_to_rgba(width: usize, height: usize, pixels: &[u8], mask: Option<&[u8]>) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || pixels.len() != width * height * 4 {
        return Err("The icon has an unexpected size".into());
    }
    let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
    let mask_stride = width.div_ceil(32) * 4;
    if let Some(mask) = mask {
        if !has_alpha && mask.len() < mask_stride * height {
            return Err("The icon's mask has an unexpected size".into());
        }
    }
    let mut rgba = Vec::with_capacity(pixels.len());
    for (index, pixel) in pixels.chunks_exact(4).enumerate() {
        let alpha = if has_alpha {
            pixel[3]
        } else if let Some(mask) = mask {
            let (row, column) = (index / width, index % width);
            let transparent = mask[row * mask_stride + column / 8] & (0x80 >> (column % 8)) != 0;
            if transparent { 0 } else { 255 }
        } else {
            255
        };
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], alpha]);
    }
    Ok(rgba)
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer.write_image_data(rgba).map_err(|error| error.to_string())?;
    }
    Ok(bytes)
}

const CACHE_LIMIT: usize = 256;

/// Icons already read, by what they were read from. A path alone is not enough: an app update changes its icon,
/// so the key also carries the file's last-changed time.
#[derive(Default)]
pub(super) struct IconCache {
    entries: HashMap<String, String>,
}

impl IconCache {
    pub(super) fn key(path: &str, variant: bool, modified_nanos: Option<u128>) -> String {
        format!("{path}\u{0}{}\u{0}{}", u8::from(variant), modified_nanos.map_or_else(String::new, |value| value.to_string()))
    }

    pub(super) fn get(&self, key: &str) -> Option<String> {
        self.entries.get(key).cloned()
    }

    pub(super) fn insert(&mut self, key: String, icon: String) {
        // Starting over is simpler than tracking age, and a full cache only costs some re-reading.
        if self.entries.len() >= CACHE_LIMIT && !self.entries.contains_key(&key) {
            self.entries.clear();
        }
        self.entries.insert(key, icon);
    }

    #[cfg(test)]
    pub(super) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_are_reordered_and_alpha_kept() {
        // One blue pixel with half alpha, one red pixel with full alpha.
        let rgba = bgra_to_rgba(2, 1, &[255, 0, 0, 128, 0, 0, 255, 255], None).unwrap();
        assert_eq!(rgba, [0, 0, 255, 128, 255, 0, 0, 255]);
    }

    #[test]
    fn an_icon_without_alpha_takes_its_transparency_from_the_mask() {
        // 2x2, no alpha anywhere. Mask rows are 4 bytes: row 0 makes the second pixel transparent, row 1 the first.
        let pixels = [10u8, 20, 30, 0, 40, 50, 60, 0, 70, 80, 90, 0, 100, 110, 120, 0];
        let mask = [0b0100_0000, 0, 0, 0, 0b1000_0000, 0, 0, 0];
        let rgba = bgra_to_rgba(2, 2, &pixels, Some(&mask)).unwrap();
        let alphas: Vec<u8> = rgba.chunks_exact(4).map(|pixel| pixel[3]).collect();
        assert_eq!(alphas, [255, 0, 0, 255]);
        // Without a mask, such an icon is opaque rather than invisible.
        assert!(bgra_to_rgba(2, 2, &pixels, None).unwrap().chunks_exact(4).all(|pixel| pixel[3] == 255));
        // A real alpha channel wins over any mask.
        let with_alpha = [1u8, 2, 3, 200, 4, 5, 6, 0];
        let kept = bgra_to_rgba(2, 1, &with_alpha, Some(&[0xFF, 0, 0, 0])).unwrap();
        assert_eq!([kept[3], kept[7]], [200, 0]);
    }

    #[test]
    fn wrong_sizes_are_refused() {
        assert!(bgra_to_rgba(0, 1, &[], None).is_err());
        assert!(bgra_to_rgba(2, 2, &[0; 12], None).is_err());
        assert!(bgra_to_rgba(33, 1, &[0; 33 * 4], Some(&[0; 4])).is_err());
    }

    #[test]
    fn pixels_survive_a_trip_through_png() {
        let rgba: Vec<u8> = (0..4 * 3 * 4).map(|value| (value * 7) as u8).collect();
        let bytes = encode_png(4, 3, &rgba).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        let mut reader = png::Decoder::new(bytes.as_slice()).read_info().unwrap();
        let mut decoded = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut decoded).unwrap();
        assert_eq!((info.width, info.height), (4, 3));
        assert_eq!(&decoded[..info.buffer_size()], rgba.as_slice());
        assert!(encode_png(2, 2, &[0; 3]).is_err());
    }

    #[test]
    fn the_cache_tells_changed_files_apart_and_stays_small() {
        let mut cache = IconCache::default();
        let old = IconCache::key("C:\\App.exe", true, Some(1));
        let updated = IconCache::key("C:\\App.exe", true, Some(2));
        assert_ne!(old, updated);
        assert_ne!(old, IconCache::key("C:\\App.exe", false, Some(1)));
        cache.insert(old.clone(), "icon-v1".into());
        assert_eq!(cache.get(&old).as_deref(), Some("icon-v1"));
        assert_eq!(cache.get(&updated), None);
        for index in 0..400 {
            cache.insert(format!("k{index}"), "x".into());
        }
        assert!(cache.len() <= CACHE_LIMIT);
        assert_eq!(cache.get("k399").as_deref(), Some("x"));
    }
}
