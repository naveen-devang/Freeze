# Freeze desktop app

Cross-platform desktop companion for the Freeze phone app. It hosts an authenticated WebSocket on the local network and can send validated keyboard shortcuts and media keys.

## Run the desktop companion

```powershell
npm install
npm run tauri dev
```

The app displays a QR code containing the PC address, port, and random pairing key. On the same Wi-Fi, scan it from Freeze's **Connect** tab. Manual entry remains available as a fallback. Keep the QR code private while the companion is running.

### Android over USB

Install Android SDK Platform-Tools and make `adb` available in `PATH`. Enable USB debugging on the Android phone, connect it, unlock it, and approve the computer's debugging prompt. With exactly one authorized phone connected, choose **Android USB** in the desktop app and press **Set up USB**. Pair by QR once; afterward select USB from the phone's **Connect** screen without scanning again. The companion persists the pairing key, and restores `adb reverse tcp:39421 tcp:39421` if the cable or phone reconnects. Keep USB debugging authorization active. Reset the key in the desktop app to revoke paired phones.

There is no general-purpose direct USB app-to-PC connection for iOS. Apple's External Accessory framework communicates with compatible MFi accessories, so Freeze uses Wi-Fi on iOS unless a dedicated certified accessory is developed.

## WebSocket protocol

Connect to `ws://<PC address>:39421/ws`, then authenticate first:

```json
{"type":"authenticate","token":"<pairing key>"}
```

The PC replies `{"type":"ready"}`. Send an action:

```json
{"type":"action","action":{"type":"hotkey","keys":["CTRL","SHIFT","M"]}}
```

Launch an app by its executable name or path on Windows, or its app name or path on macOS. Freeze passes this value directly to the process launcher instead of a shell:

```json
{"type":"action","action":{"type":"launch_app","app":"notepad.exe"}}
```

Run up to 10 supported media, shortcut, or app-launch actions in sequence:

```json
{"type":"action","action":{"type":"sequence","actions":[{"type":"launch_app","app":"notepad.exe"},{"type":"hotkey","keys":["CTRL","S"]}]}}
```

After authentication, the PC reports changes to the system playback state as `{"type":"playback_state","state":"playing"}`. States are `playing`, `paused`, `stopped`, and `unavailable`. On Windows this uses the current Windows media session. macOS does not provide a public API for querying other apps' global playback state, so Freeze reports `unavailable` there and the phone keeps its last Play/Pause command as a visual prediction.

Supported media commands: `play_pause`, `next_track`, `previous_track`, `volume_up`, `volume_down`, and `mute`. On macOS, these are sent as system media-key events. macOS asks for Accessibility permission before Freeze can send them; allow Freeze in **System Settings → Privacy & Security → Accessibility**.

The macOS companion targets Catalina (10.15) and later. Build and package it on a Mac with Xcode Command Line Tools installed.
