# Elgato plugin compatibility and script execution

Research date: 2026-09-27. Sources below are official Elgato, Tauri, and Rust documentation/repositories.

## Finding

Freeze should **not promise to install and run arbitrary Elgato Marketplace plugins as Freeze plugins**. Elgato documents an SDK and a host protocol for plugins that connect to the Stream Deck desktop app. The official Node plugin environment expects the Stream Deck app to host the plugin backend and its Chromium property inspector; the native WebSocket API likewise describes a plugin registering with the Stream Deck app over a port and event protocol. That protocol gives a possible basis for a separately scoped compatibility experiment, but not a documented general-purpose API for third-party apps to host marketplace plugins. [Plugin Environment](https://docs.elgato.com/streamdeck/sdk/v1/introduction/plugin-environment/) · [Plugin WebSocket protocol](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin/)

Marketplace bundles create another hard boundary: Elgato says Marketplace plugins can be DRM-protected/encrypted and integrity-checked, with the processed version downloaded through Maker Console. A third-party host should not attempt to decrypt, patch, or bypass those protections. [Distribution and DRM](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/) · [Managing products](https://docs.elgato.com/maker-console/managing-products/)

The official `@elgato/streamdeck` SDK repository is MIT-licensed. That license covers the repository's software; it does not by itself establish rights to Elgato Marketplace binaries, plugin assets, trademarks, or compatibility with the Stream Deck app protocol. The public documentation points to the Maker Agreement inside Maker Console for additional terms, so the legal status of implementing a compatible host or importing third-party plugins remains unverified. Get Elgato's written clarification before marketing or shipping compatibility. [SDK repository](https://github.com/elgatosf/streamdeck) · [SDK MIT license](https://raw.githubusercontent.com/elgatosf/streamdeck/main/LICENSE) · [Maker requirements](https://docs.elgato.com/marketplace/become-a-maker/) · [Marketplace legal guidelines](https://docs.elgato.com/guidelines/products/)

## Updated product direction

The product owner wants broad support for Elgato Marketplace functionality. Direct `.streamDeckPlugin` compatibility is the first technical prototype target. Where packages are protected, depend on unavailable host features, or cannot legally/technically be supported, implement clearly branded Freeze equivalents from public APIs and documented behavior. Do not copy proprietary plugin source/artwork or bypass DRM. Direct Marketplace distribution or installation remains conditional on written clarification and applicable rights.

1. **Compatibility prototype:** run an official, non-protected sample plugin with a narrow Freeze host implementing the documented key-action lifecycle, settings, property inspector, and dynamic title/image/state surface. Record Windows/macOS support and limitations. This protocol work is a compatibility project, not a claim of universal drop-in support.
2. **Broad action coverage:** audit Marketplace action families and track each as directly compatible, a Freeze equivalent, or unsupported. Start with key-based actions; the current phone UI cannot reproduce Elgato Encoder/dial controllers without a deliberate gesture mapping.
3. **Freeze equivalents:** implement independently with Freeze's own source, assets, UI, and integration credentials. Prefer official public service APIs or documented OS behavior; show when a feature can't be implemented without private access.
4. **Extension surface:** add a Freeze-owned versioned extension API only where it makes third-party or user-developed actions materially easier than the compatibility layer. Keep installation per-plugin opt-in and visibly permissioned.

## User-authored scripts

Treat scripts as privileged arbitrary code running as the logged-in desktop user. They must execute **on the PC only**, never on the phone and never directly from an unauthenticated network request. The phone should send a button/action ID; the trusted PC resolves the saved action and asks for explicit opt-in before a script runs. Do not accept script source or executable/argument paths from phone tap messages.

For a first safe release, prefer declared actions (hotkey, media, launch app) and optionally allow a user to select a local script file and bind it to a button. Show the full script path, runtime, and arguments in the PC editor; require a deliberate save/enable step; allow disable/remove; record last result/error. Spawn the configured interpreter/program directly with separate arguments and no shell string interpolation. Rust's `std::process::Command` provides process construction/spawning; its docs warn that Windows `.bat`/`cmd.exe` argument parsing is particularly complex and can expose arbitrary command execution from malicious input, so batch files and shell commands should not be treated as ordinary safe targets. [Rust `Command`](https://doc.rust-lang.org/std/process/struct.Command.html)

Tauri's permission/capability system scopes frontend access to commands; its shell plugin supports allowlisted executables and argument validation, with arguments disallowed by default. Apply that discipline to any script-runner bridge, and keep the phone-facing command separate from generic process spawning. Capabilities alone are not a sandbox for user-selected scripts: the user is explicitly granting those scripts the PC user's privileges. [Tauri capabilities](https://tauri.app/security/capabilities/) · [Tauri permissions](https://tauri.app/security/permissions/) · [Tauri shell plugin security](https://v2.tauri.app/reference/javascript/shell/)

## Script and execution implications

- Add a **Plugins & Scripts** section to the desktop companion. The phone's Connect UI can be redesigned without changing how scripts/plugins are executed.
- Keep profiles/buttons authored on PC. A button refers to a plugin/action or script identifier; the host resolves and executes it locally.
- User scripts are an easy-to-author desktop action with templates, an editor/file picker, runtime detection, test output, and one-time explicit enablement. Script code and executable arguments never arrive from phone messages.
- Plugins and scripts are code running with the desktop user's privileges; process isolation alone is not a sandbox. Show source/runtime/capability details, allow disable/uninstall, and keep credentials outside profiles and phone storage.
- Do not implement Marketplace decryption or DRM bypass. Record Elgato written clarification as a release dependency for any direct Marketplace content distribution or install integration.
