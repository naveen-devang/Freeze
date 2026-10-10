//! The apps Windows itself lists in the Start menu: desktop apps and Store (packaged) apps such as Apple Music,
//! read in this process from the shell's "AppsFolder". A scan of Start Menu shortcuts misses every Store app.

use windows::core::PWSTR;
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{
    IEnumShellItems, IShellItem, SHGetKnownFolderItem, BHID_EnumItems, FOLDERID_AppsFolder, KF_FLAG_DEFAULT, SIGDN,
    SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
};

/// Prefix of an entry that only the shell can open. Everything after it is the app's id.
pub(super) const SHELL_PREFIX: &str = r"shell:AppsFolder\";

fn name_of(item: &IShellItem, kind: SIGDN) -> Option<String> {
    let text: PWSTR = unsafe { item.GetDisplayName(kind) }.ok()?;
    let value = unsafe { text.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(text.0 as *const _)) };
    value
}

/// `(name, id)` for every app in the Start menu's list, in the shell's order.
pub(super) fn list() -> Result<Vec<(String, String)>, String> {
    let started = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let result = enumerate();
    if started {
        unsafe { CoUninitialize() };
    }
    result
}

fn enumerate() -> Result<Vec<(String, String)>, String> {
    let folder: IShellItem = unsafe { SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) }.map_err(|error| error.to_string())?;
    let items: IEnumShellItems = unsafe { folder.BindToHandler(None, &BHID_EnumItems) }.map_err(|error| error.to_string())?;
    let mut apps = Vec::new();
    loop {
        let mut next = [None];
        let mut fetched = 0u32;
        let status = unsafe { items.Next(&mut next, Some(&mut fetched)) };
        let Some(item) = next[0].take().filter(|_| status.is_ok() && fetched == 1) else { break };
        if let (Some(name), Some(id)) = (name_of(&item, SIGDN_NORMALDISPLAY), name_of(&item, SIGDN_PARENTRELATIVEPARSING)) {
            apps.push((name, id));
        }
    }
    Ok(apps)
}

/// The path the picker stores: a desktop app's real file when its id is one, else the `shell:` address that
/// opens it (Store apps, and desktop apps registered only by a GUID or a known-folder id).
pub(super) fn target(id: &str) -> String {
    let is_file = id.get(1..3) == Some(r":\") && std::path::Path::new(id).is_file();
    if is_file { id.to_owned() } else { format!("{SHELL_PREFIX}{id}") }
}

/// Uninstallers and documentation shortcuts the Start menu lists next to an app.
pub(super) fn is_helper(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("uninstall") || [" readme", " release notes", " documentation", " manual", " license", " changelog"].iter().any(|tail| lower.ends_with(tail))
}

/// A shortcut to a help file or web page rather than a program.
pub(super) fn is_document(id: &str) -> bool {
    let lower = id.to_lowercase();
    [".chm", ".pdf", ".txt", ".url", ".html", ".htm", ".rtf", ".doc", ".docx"].iter().any(|extension| lower.ends_with(extension))
}

/// Keeps the entries worth showing: named, not a helper, one per id.
pub(super) fn tidy(found: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<_> = found.into_iter().filter(|(name, id)| !name.trim().is_empty() && !is_helper(name) && !is_document(id) && seen.insert(id.to_lowercase())).collect();
    apps.sort_by_key(|(name, _)| name.to_lowercase());
    apps
}
