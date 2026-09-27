# Freeze

Phone control deck and local PC companion.

## Run the PC companion (Windows or macOS)

```powershell
cd pc-companion
npm install
npm run tauri dev
```

The Freeze desktop app listens on port `39421` and displays a pairing QR code. Keep both devices on the same Wi-Fi network. The macOS companion supports Catalina (10.15) and later and must be built on a Mac with Xcode Command Line Tools. On macOS, allow Freeze in **System Settings → Privacy & Security → Accessibility** so it can send media keys and shortcuts.

## Run the phone app

```powershell
cd phone-app
npm install
npm start
```

Open the project in Expo Go on a phone on the same Wi-Fi. In the **Connect** tab, scan the Wi-Fi QR code in Freeze for desktop. Pairing details are stored securely on the phone. Use a trusted Wi-Fi network while connected. Manual entry remains available as a fallback.

The phone deck supports multiple pages, custom keyboard shortcuts, app-launch buttons, ordered shortcut sequences, selectable Lucide icons, and per-page button ordering. Paired PCs are saved on the phone and can be switched from **Connect → Paired devices**. To use Android over USB, install Android SDK Platform-Tools, enable USB debugging, connect and authorize one phone, then select **Android USB** and **Set up USB** in the PC app. Scan once when pairing initially; afterward switch between Wi-Fi and USB from the phone's **Connect** screen. Freeze retains the PC's pairing key and restores ADB forwarding when the authorized phone reconnects.

iOS uses Wi-Fi. iOS does not provide a general-purpose USB data channel from an app to a PC; Apple's External Accessory framework is for compatible MFi accessories. [Apple External Accessory docs](https://developer.apple.com/documentation/externalaccessory)

Android's ADB reverse feature forwards a device port to the host and works with USB-connected physical devices. [Android ADB reverse docs](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server)

The app uses the React Native WebSocket API and the companion protocol documented in [the PC companion README](pc-companion/README.md).
