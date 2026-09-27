# Freeze Desktop-Owned Deck Design

**Status:** Proposed for review

**Date:** 2026-09-27

## Summary

Freeze will use the desktop companion as the authoritative deck editor and action runner. The phone will display the selected PC's deck and send control requests. The existing Connect tab remains visually and functionally unchanged: QR pairing, manual setup, saved PCs, connection status/retry, and Android USB setup continue to work as they do now.

This follows Elgato's mobile model: its desktop software manages mobile actions and profiles, while Smart Profiles can change the active profile when an associated application becomes focused.

## Current state and reason for change

The phone currently saves pages, icons, launch targets, and keyboard sequences locally. On a tap, it sends the selected action payload to the desktop. The desktop executes that supplied payload. That makes each phone a separate configuration source and makes launch targets platform-dependent on the phone's knowledge of the PC.

The intended boundary is:

```text
Desktop editor -> PC-owned profiles/actions -> authenticated local connection -> phone deck view
Phone tap(button ID) -> PC resolves configured action -> Windows/macOS executes -> result/state -> phone
```

## Goals

- Make each PC's saved profiles, pages, button assignments, labels, icons, order, and action settings authoritative.
- Keep the phone deck and PC preview synchronized with the selected PC.
- Resolve and execute app launches and action sequences on the PC using its operating-system-specific targets.
- Keep the existing Wi-Fi and Android USB transports and pairing workflow.
- Keep the Connect tab unchanged in this work.
- Maintain the current simple dark Freeze/shadcn-inspired visual style and Lucide icon set.
- Retain one-time migration for decks currently saved on a phone.

## Not in scope

- Cloud accounts, remote Internet relay, or cloud synchronization.
- Third-party action plug-in marketplace or script execution.
- iPhone USB control.
- Editing profile definitions on the phone.
- New connection UI or changes to Connect screen content, layout, or behavior.

## Ownership and data model

The desktop companion owns a versioned `DeckConfig` with profiles, pages, buttons, and the active profile/page. One Rust-owned state instance is shared by the desktop's Tauri commands and the WebSocket server, so local edits and remote reads use the same config. A button contains a stable ID, display label, Lucide icon key, and an action definition. Initial action types are media control, keyboard shortcut, app launch, sequence, and profile/page navigation. Existing six media controls become ordinary configured buttons in the default profile rather than being separately hard-coded into the phone.

An app launch action stores an application identity/target for the host platform. It may include per-platform target mappings for a profile shared through a future export/import feature, but a local profile must always resolve to an installed app on its own PC. The desktop editor supplies the app target; no path is sent from the phone at invocation time.

Sequences are configured on the desktop as ordered supported action steps. They execute on the PC, stop and report an error when a step fails, and have a bounded number of steps. Nested sequences and arbitrary shell/script commands are excluded.

The PC persists the config in its application data directory as versioned JSON, using a temporary file and replace/recovery when saving to avoid partial writes. Pairing credentials remain separate. Startup validates the saved schema and creates a default profile with the current six media controls when there is no valid config. This uses existing Rust/Serde and filesystem support rather than introducing a database dependency for a small local configuration.

Initially, the PC's active profile is shared by all phones connected to that PC. Any profile switch is made by the desktop or a configured phone button and is broadcast to other connected phones.

## Connection protocol

The existing pairing token remains the authentication mechanism. After authentication, the desktop sends a protocol version and a complete deck snapshot containing the configuration revision, profiles/pages/buttons, active profile/page, and current system-driven button state. A newly paired phone receives this snapshot over either existing transport.

For an action tap, the phone sends a request ID, the current config revision, and a button ID. The PC validates the request and resolves the action from its own config before execution. The PC returns a result correlated by request ID and publishes relevant state changes. Profile/page selection requests use stable IDs and are accepted only when those IDs exist in the PC config. Configuration edits made on the desktop are saved first, increment the revision, then broadcast an updated snapshot to connected phones.

The phone may cache the last snapshot in its existing non-secret persistent storage for faster display. It never treats that cache as editable authority. When disconnected, cached buttons may remain visible but are disabled. A stale revision or unknown button ID causes the PC to reject the request and the phone to request a fresh snapshot.

The protocol is versioned. An incompatible app/desktop pair receives an actionable update-required response rather than silently falling back to phone-supplied executable paths or action payloads.

## Migration of existing phone decks

The first connection after this change may find a legacy deck stored on the phone. The phone may identify that it has legacy deck data during the versioned handshake. If the PC has only its untouched generated default, the desktop offers to import that data as a new PC profile. Import is explicit, validated as untrusted input, and never overwrites an existing PC profile. App targets are reviewed on the PC and may need to be selected again for that operating system. Once imported, the PC sends its saved snapshot and is the sole authority. The Connect tab does not change; migration prompting and review appear in the desktop app.

If migration is declined or the phone data is invalid, the desktop default profile remains available. Existing pairing keys and saved-PC entries are not migrated or rewritten by this feature.

## Desktop experience

Add a **Deck** area beside the existing Overview. Use a profile selector and page tabs above a simple phone-shaped button canvas. Selecting a button opens a compact properties panel for its label, Lucide icon, action type, and type-specific settings. Users can add, remove, reorder, and duplicate buttons and pages, and create or switch profiles. The overview retains QR pairing and connection status.

The first app picker will select an executable (`.exe`) on Windows or an application bundle (`.app`) on macOS. If a target becomes unavailable, show it as missing and let the user reselect it. Profile auto-switching by focused app is a follow-up phase after manual profiles and synchronization are stable; its platform-specific app association data will be added with that feature.

## Phone experience

- **Deck:** renders the selected PC's profile and page, including host-defined media controls, app launches, and sequences. It reports action results and reflects state updates from the host. Remove local page management and local button editing; the existing page strip becomes the way to select among PC-defined pages.
- **Connect:** unchanged in layout and behavior.
- **Customize tab:** becomes a **Profiles** remote selector, allowing selection among profiles already defined on the PC. Page selection remains on Deck. It does not create or edit actions.

Dynamic labels/icons are derived from host state when available. For example, Play/Pause reflects the system-reported playback state where the OS exposes it; where it does not, Freeze indicates that the state is unavailable and may use a short-lived visual prediction after a tap.

## Security and failure behavior

- Authenticate before sending deck state or accepting commands.
- A phone can invoke only IDs present in the current PC-owned config; the PC never trusts phone-supplied app paths, sequence bodies, or arbitrary commands.
- Continue using direct process launching rather than shell interpolation for configured app targets.
- Validate persisted config and protocol messages, including action type, target length, sequence count, and ID existence.
- Return actionable errors for missing apps, unsupported host actions, permission failures, stale config revisions, and incompatible protocol versions.
- Preserve the current capped reconnect behavior and explicit manual retry UX.
- Phone Connect behavior and pairing secrets remain in their existing stores; the deck cache contains no secrets.

## Delivery phases

1. **PC-owned model and host API:** define versioned profile/action structures, persistence, defaults, authenticated snapshot delivery, revision updates, and ID-based invoke/select requests. Keep the old Connect tab intact.
2. **Desktop editor:** add profile/page/button management, action configuration, an app picker/target editor, sequence composition, and a live preview. Save before broadcasting revisions.
3. **Phone remote conversion:** replace local deck reads/edits with host snapshots and ID-based requests; change Customize to Profiles; leave Connect screen untouched; add legacy deck import flow on desktop.
4. **System-aware behavior:** add optional foreground-app profile association and platform-specific app/media state reporting. Windows ships first; macOS uses its native launch/control behavior and existing Accessibility requirements.
5. **Compatibility and packaging:** validate protocol mismatch messaging, profile persistence/migration, Wi-Fi and Android USB flows, Windows packaging, and macOS build/runtime behavior.

## Acceptance criteria

- Editing, reordering, or deleting a profile/button in the desktop app persists across restart and appears on every connected phone without rescanning its QR code.
- A phone action message contains a button ID and revision, not a launch path or sequence definition; the desktop resolves it from its saved config.
- Media buttons, app launches, and sequences in the phone deck are defined and editable on the desktop.
- A missing target or unsupported/failed action is shown on both the desktop and phone without losing the saved profile.
- Legacy phone deck data can be explicitly imported once without replacing existing PC config.
- The Connect tab's current pairing, paired-PC list, retry, and Android USB experience remains unchanged.
- The same profile model works in Windows and macOS builds, with native application targets resolved per host OS.

## Decisions for this design

- One PC owns one active profile shared by its currently connected phones for the first version.
- Deck editing lives on desktop; phone profile/page selectors are remote controls, not local editors.
- Profiles use a local versioned JSON file and OS-appropriate app targets; there is no cloud or plug-in runtime.
- App-linked automatic profile switching follows the editor/synchronization foundation rather than blocking it.

## References

- [Elgato Stream Deck Mobile 2.0 — Getting Started](https://help.elgato.com/hc/en-us/articles/16786832942221-Elgato-Stream-Deck-Mobile-2-0-Getting-Started)
- [Elgato Stream Deck — Smart Profiles](https://help.elgato.com/hc/en-us/articles/360053419071-Elgato-Stream-Deck-Smart-Profiles)
- [Tauri v2 commands and events](https://v2.tauri.app/develop/calling-rust/)
- [Tauri v2 managed state](https://v2.tauri.app/develop/state-management/)
- [Expo SDK 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Expo SDK 57 store data guide](https://docs.expo.dev/versions/v57.0.0/develop/user-interface/store-data/)
