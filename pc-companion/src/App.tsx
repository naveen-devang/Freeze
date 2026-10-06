import { useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AppWindow,
  ChevronUp,
  Check,
  ChevronDown,
  Command,
  Copy,
  File,
  FolderOpen,
  Headphones,
  Layers,
  Keyboard,
  Layers2,
  Package,
  LayoutDashboard,
  ListOrdered,
  Mic,
  Monitor,
  MicVocal,
  Music,
  PanelsTopLeft,
  Pause,
  Play,
  QrCode,
  Plus,
  Trash2,
  Save,
  Settings,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Smartphone,
  Snowflake,
  Wifi,
  Volume1,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { NowPlayingPreview, REFERENCE_WIDGET_SURFACE } from "./NowPlayingPreview";
import { LyricsPreview } from "./LyricsPreview";
import { ClockFacePreview } from "./clock-faces/ClockFacePreview";
import { ClockWidgetSettings } from "./clock-faces/ClockSettings";
import { PcStatsPreview } from "./pc-stats/PcStatsPreview";
import { PcStatsSettings } from "./pc-stats/PcStatsSettings";
import { AddWidgetMenu, type WidgetChoice } from "./AddWidgetMenu";
import { widgetBlockSize, type WidgetSurface } from "./now-playing-layout";
import { version } from "../package.json";
import { UpdatesSetting, useUpdater } from "./updates";

type ConnectionInfo = {
  host: string;
  deviceName: string;
  port: number;
  token: string;
  activeDevices: number;
  serverOnline: boolean;
  isMacos: boolean;
  androidUsbEnabled: boolean;
  widgetSurface: WidgetSurface | null;
};

type MediaCommand = 'play_pause' | 'next_track' | 'previous_track' | 'volume_up' | 'volume_down' | 'mute';
type DeckStep = { type: 'media'; command: MediaCommand } | { type: 'hotkey'; keys: string[] } | { type: 'launch_app'; app: string } | { type: 'launch_file'; path: string } | { type: 'launch_folder'; path: string };
type DeckAction = DeckStep | { type: 'run_script'; path: string; allowOnPc: boolean } | { type: 'plugin_action'; pluginId: string; actionId: string; allowOnPc: boolean; inputs: Record<string, string> } | { type: 'launch_app'; app: string } | { type: 'sequence'; steps: DeckStep[] } | { type: 'select_profile'; profileId: string } | { type: 'select_page'; pageId: string };
type FreezePluginInput = { id: string; label: string; type: 'text' | 'number' | 'select'; default: string; options: string[]; optionLabels: string[] };
type FreezePluginWidget = { id: string; name: string; description: string; type: 'text'; inputs: FreezePluginInput[] };
type FreezePlugin = { id: string; name: string; version: string; description: string; actions: { id: string; name: string; description: string; script: string; inputs: FreezePluginInput[] }[]; widgets: FreezePluginWidget[] };
type FreezePluginListing = { plugins: FreezePlugin[]; warnings: string[] };
type DeckPlacement = { row: number; column: number; rowSpan: number; columnSpan: number };
type DeckButton = { id: string; label: string; icon: string; placement?: DeckPlacement; iconSvg?: string; appIconData?: string; action: DeckAction };
type DeckWidget = { id: string; type: 'clock'; placement: DeckPlacement; face?: string; color?: string } | { id: string; type: 'now_playing'; placement: DeckPlacement } | { id: string; type: 'lyrics'; placement: DeckPlacement } | { id: string; type: 'pc_stats'; placement: DeckPlacement; face?: string; metric?: string; color?: string; gpu?: string } | { id: string; type: 'plugin'; pluginId: string; widgetId: string; renderType: string; values: Record<string, string>; placement: DeckPlacement };
type WidgetScreen = { enabled: boolean; rows: number; columns: number; buttons: DeckButton[]; widgets: DeckWidget[] };
type WidgetPage = { id: string; name: string; buttons: DeckButton[]; widgets: DeckWidget[] };
type WidgetArea = { enabled: boolean; rows: number; columns: number; pages: WidgetPage[] };
type PlaybackState = 'playing' | 'paused' | 'stopped' | 'unavailable';
type SystemMediaState = { sourceAppId?: string | null; title?: string | null; artist?: string | null; album?: string | null; playbackState: PlaybackState; positionMs?: number | null; durationMs?: number | null; artworkDataUrl?: string | null; volumePercent?: number | null; canSeek?: boolean; playbackRate?: number | null };
type SystemMediaProgress = Pick<SystemMediaState, 'playbackState' | 'positionMs' | 'durationMs' | 'volumePercent' | 'playbackRate'>;
type LucideRegistry = Record<string, typeof Command>;
type DeckPage = { id: string; name: string; rows: number; columns: number; buttons: DeckButton[]; widgetArea?: WidgetArea };
type DeckProfile = { id: string; name: string; pages: DeckPage[]; activePageId: string; autoSwitchApps: string[]; autoSwitchEnabled: boolean };
type DeckConfig = { schemaVersion: number; revision: number; profiles: DeckProfile[]; activeProfileId: string; fallbackProfileId: string };
type LegacyImportSummary = { sourceId: string; pages: number; buttons: number; requested: boolean; ready: boolean };

function buttonPlacement(page: DeckPage, button: DeckButton): DeckPlacement {
  if (button.placement) return button.placement;
  const index = page.buttons.findIndex((item) => item.id === button.id);
  return { row: Math.floor(index / page.columns), column: index % page.columns, rowSpan: 1, columnSpan: 1 };
}

function canPlaceButton(page: DeckPage, buttonId: string, placement: DeckPlacement): boolean {
  if (![placement.row, placement.column, placement.rowSpan, placement.columnSpan].every(Number.isInteger) ||
      placement.row < 0 || placement.column < 0 || placement.rowSpan < 1 || placement.columnSpan < 1 ||
      placement.row + placement.rowSpan > page.rows || placement.column + placement.columnSpan > page.columns) return false;
  return page.buttons.every((button) => {
    if (button.id === buttonId) return true;
    const other = buttonPlacement(page, button);
    return placement.row >= other.row + other.rowSpan || other.row >= placement.row + placement.rowSpan ||
      placement.column >= other.column + other.columnSpan || other.column >= placement.column + placement.columnSpan;
  });
}

function swapPlacements(rows: number, columns: number, items: { id: string; placement: DeckPlacement }[], firstId: string, secondId: string): Map<string, DeckPlacement> | null {
  const first = items.find((item) => item.id === firstId)?.placement;
  const second = items.find((item) => item.id === secondId)?.placement;
  if (!first || !second || firstId === secondId) return null;
  const placements = items.map((item) => ({
    id: item.id,
    placement: item.id === firstId ? { ...first, row: second.row, column: second.column }
      : item.id === secondId ? { ...second, row: first.row, column: first.column }
        : item.placement,
  }));
  const fits = placements.every(({ placement }, index) => placement.row >= 0 && placement.column >= 0 && placement.row + placement.rowSpan <= rows && placement.column + placement.columnSpan <= columns &&
    placements.slice(index + 1).every(({ placement: other }) => placement.row >= other.row + other.rowSpan || other.row >= placement.row + placement.rowSpan || placement.column >= other.column + other.columnSpan || other.column >= placement.column + placement.columnSpan));
  return fits ? new Map(placements.map((item) => [item.id, item.placement])) : null;
}

function firstButtonPlacement(page: DeckPage, rowSpan = 1, columnSpan = 1): DeckPlacement | null {
  for (let row = 0; row <= page.rows - rowSpan; row++) {
    for (let column = 0; column <= page.columns - columnSpan; column++) {
      const placement = { row, column, rowSpan, columnSpan };
      if (canPlaceButton(page, '', placement)) return placement;
    }
  }
  return null;
}

function occupiedDeckCells(page: DeckPage): Map<number, DeckButton> {
  const occupied = new Map<number, DeckButton>();
  page.buttons.forEach((button) => {
    const placement = buttonPlacement(page, button);
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) {
        occupied.set(row * page.columns + column, button);
      }
    }
  });
  return occupied;
}

function emptyWidgetArea(): WidgetArea {
  return { enabled: false, rows: 2, columns: 3, pages: [{ id: 'widgets-1', name: 'Page 1', buttons: [], widgets: [] }] };
}

type WidgetCanvasItem = { type: 'button'; button: DeckButton } | { type: 'widget'; widget: DeckWidget };

function canPlaceWidgetItem(screen: WidgetScreen, itemId: string, placement: DeckPlacement): boolean {
  if (![placement.row, placement.column, placement.rowSpan, placement.columnSpan].every(Number.isInteger) ||
      placement.row < 0 || placement.column < 0 || placement.rowSpan < 1 || placement.columnSpan < 1 ||
      placement.row + placement.rowSpan > screen.rows || placement.column + placement.columnSpan > screen.columns) return false;
  const items = [
    ...screen.buttons.map((button) => ({ id: button.id, placement: buttonPlacement({ ...screen, id: '', name: '', buttons: screen.buttons }, button) })),
    ...screen.widgets.map((widget) => ({ id: widget.id, placement: widget.placement })),
  ];
  return items.every((item) => item.id === itemId ||
    placement.row >= item.placement.row + item.placement.rowSpan || item.placement.row >= placement.row + placement.rowSpan ||
    placement.column >= item.placement.column + item.placement.columnSpan || item.placement.column >= placement.column + placement.columnSpan);
}

function firstWidgetPlacement(screen: WidgetScreen, rowSpan = 1, columnSpan = 1): DeckPlacement | null {
  for (let row = 0; row <= screen.rows - rowSpan; row++) {
    for (let column = 0; column <= screen.columns - columnSpan; column++) {
      const placement = { row, column, rowSpan, columnSpan };
      if (canPlaceWidgetItem(screen, '', placement)) return placement;
    }
  }
  return null;
}

// Mirrors the phone: a page with no buttons stretches the bounding box of its widget items
// across the whole widget area, so cells get bigger. `override` is a placement being resized.
function phoneWidgetGrid(pageHasButtons: boolean, screen: WidgetScreen, overrideId: string, override: DeckPlacement) {
  if (pageHasButtons) return { columns: screen.columns, rows: screen.rows };
  const page = { id: '', name: '', rows: screen.rows, columns: screen.columns, buttons: screen.buttons };
  const placements = [
    ...screen.buttons.map((button) => button.id === overrideId ? override : buttonPlacement(page, button)),
    ...screen.widgets.map((widget) => widget.id === overrideId ? override : widget.placement),
  ];
  if (!placements.length) return { columns: screen.columns, rows: screen.rows };
  const top = Math.min(...placements.map((item) => item.row));
  const left = Math.min(...placements.map((item) => item.column));
  return {
    columns: Math.max(...placements.map((item) => Math.min(screen.columns, item.column + item.columnSpan))) - left,
    rows: Math.max(...placements.map((item) => Math.min(screen.rows, item.row + item.rowSpan))) - top,
  };
}

function occupiedWidgetCells(screen: WidgetScreen): Map<number, WidgetCanvasItem> {
  const occupied = new Map<number, WidgetCanvasItem>();
  const page = { id: '', name: '', rows: screen.rows, columns: screen.columns, buttons: screen.buttons };
  for (const button of screen.buttons) {
    const placement = buttonPlacement(page, button);
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) occupied.set(row * screen.columns + column, { type: 'button', button });
    }
  }
  for (const widget of screen.widgets) {
    const placement = widget.placement;
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) occupied.set(row * screen.columns + column, { type: 'widget', widget });
    }
  }
  return occupied;
}

function App() {
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [transport, setTransport] = useState<'wifi' | 'usb'>('wifi');
  const [usbEnabled, setUsbEnabled] = useState(false);
  const [usbBusy, setUsbBusy] = useState(false);
  const [usbError, setUsbError] = useState('');
  // Set when this PC has no adb: the card then offers Google's download (size in MB) instead of failing.
  const [adbDownloadMb, setAdbDownloadMb] = useState<number | null>(null);
  const [adbProgress, setAdbProgress] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [screen, setScreen] = useState<'overview' | 'deck' | 'settings'>('overview');
  const updater = useUpdater();
  const { checkNow } = updater;
  useEffect(() => {
    // The tray's "Check for Updates…" item.
    const stop = listen('check-for-updates', () => { setScreen('settings'); void checkNow(); });
    return () => { void stop.then((unlisten) => unlisten()); };
  }, [checkNow]);
  const [deckConfig, setDeckConfig] = useState<DeckConfig | null>(null);
  const [independentNavigation, setIndependentNavigation] = useState(false);
  const [navigationSettingBusy, setNavigationSettingBusy] = useState(false);
  const [navigationSettingError, setNavigationSettingError] = useState('');
  const [playbackState, setPlaybackState] = useState<PlaybackState>('unavailable');
  const [mediaState, setMediaState] = useState<SystemMediaState>({ playbackState: 'unavailable' });
  const [legacyImports, setLegacyImports] = useState<LegacyImportSummary[]>([]);
  const [importError, setImportError] = useState('');
  const [freezePlugins, setFreezePlugins] = useState<FreezePlugin[]>([]);
  const [freezePluginWarnings, setFreezePluginWarnings] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const info = await invoke<ConnectionInfo>("connection_info");
        if (live) {
          setConnection(info);
          setUsbEnabled(info.androidUsbEnabled);
          setLoadError(false);
        }
      } catch {
        if (live) setLoadError(true);
      }
      try {
        const offers = await invoke<LegacyImportSummary[]>('pending_legacy_imports');
        if (live) setLegacyImports(offers);
      } catch { /* Companion startup may still be initializing. */ }
    };
    void refresh();
    void invoke<DeckConfig>('deck_config').then((config) => { if (live) setDeckConfig(config); }).catch(() => {});
    void invoke<boolean>('get_independent_navigation').then((enabled) => { if (live) setIndependentNavigation(enabled); }).catch(() => {});
    void invoke<FreezePluginListing>('list_freeze_plugins').then(({ plugins, warnings }) => { if (live) { setFreezePlugins(plugins); setFreezePluginWarnings(warnings); } }).catch(() => {});
    const timer = window.setInterval(refresh, 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let live = true;
    let eventRevision = 0;
    let unlistenState: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    void Promise.all([
      listen<SystemMediaState>('system-media-state', ({ payload }) => {
        eventRevision += 1;
        if (live) setMediaState(payload);
      }),
      listen<SystemMediaProgress>('system-media-progress', ({ payload }) => {
        eventRevision += 1;
        if (!live) return;
        setMediaState((current) => ({ ...current, ...payload }));
      }),
    ]).then(([stopState, stopProgress]) => {
      if (!live) {
        stopState();
        stopProgress();
        return;
      }
      unlistenState = stopState;
      unlistenProgress = stopProgress;
      const revision = eventRevision;
      void invoke<SystemMediaState>('get_system_media_state').then((snapshot) => {
        if (live && revision === eventRevision) setMediaState(snapshot);
      }).catch(() => {});
    }).catch(() => {});
    return () => {
      live = false;
      unlistenState?.();
      unlistenProgress?.();
    };
  }, []);

  useEffect(() => {
    if (!connection?.isMacos) return;
    const rootBackground = document.documentElement.style.backgroundColor;
    const bodyBackground = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    return () => {
      document.documentElement.style.backgroundColor = rootBackground;
      document.body.style.backgroundColor = bodyBackground;
    };
  }, [connection?.isMacos]);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try { const state = await invoke<PlaybackState>('get_playback_state'); if (live) setPlaybackState(state); } catch { if (live) setPlaybackState('unavailable'); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  async function copyPairingDetails() {
    if (!connection) return;
    await navigator.clipboard.writeText(
      `${transport === 'usb' ? '127.0.0.1' : connection.host}:${connection.port}\n${connection.token}`,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function enableAndroidUsb() {
    setUsbBusy(true);
    setUsbError('');
    try {
      await invoke('enable_android_usb');
      setUsbEnabled(true);
      setTransport('usb');
      setAdbDownloadMb(null);
    } catch (error) {
      if (String(error) === 'ADB_MISSING') {
        const status = await invoke<{ downloadMb: number }>('adb_status').catch(() => null);
        setAdbDownloadMb(status?.downloadMb ?? 10);
      } else setUsbError(String(error));
    } finally {
      setUsbBusy(false);
    }
  }

  async function installAdb() {
    setUsbBusy(true);
    setUsbError('');
    setAdbProgress('Starting…');
    const stop = await listen<{ stage: string; received: number; total: number }>('adb-progress', ({ payload }) => {
      setAdbProgress(payload.stage === 'download' ? `Downloading… ${Math.min(100, Math.floor((payload.received / payload.total) * 100))}%` : payload.stage === 'verify' ? 'Checking the download…' : 'Unpacking…');
    });
    try {
      await invoke('install_adb');
      setAdbDownloadMb(null);
      stop();
      setAdbProgress('');
      await enableAndroidUsb();
      return;
    } catch (error) {
      setUsbError(String(error));
    }
    stop();
    setAdbProgress('');
    setUsbBusy(false);
  }

  async function rotatePairingKey() {
    if (!window.confirm('Reset the pairing key? All connected phones will be disconnected and must scan the new QR code.')) return;
    setPairingError('');
    try {
      await invoke('rotate_pairing_key');
      const info = await invoke<ConnectionInfo>('connection_info');
      setConnection(info);
    } catch {
      setPairingError('Could not reset the pairing key.');
    }
  }

  async function saveIndependentNavigation(enabled: boolean) {
    setNavigationSettingBusy(true);
    setNavigationSettingError('');
    try {
      const saved = await invoke<boolean>('set_independent_navigation', { enabled });
      setIndependentNavigation(saved);
    } catch {
      setNavigationSettingError('Could not save this setting. Try again.');
    } finally {
      setNavigationSettingBusy(false);
    }
  }

  async function importPhoneDeck(sourceId: string) {
    setImportError('');
    try {
      const config = await invoke<DeckConfig>('import_legacy_deck', { sourceId });
      setDeckConfig(config);
      setLegacyImports((imports) => imports.filter((item) => item.sourceId !== sourceId));
      setScreen('deck');
    } catch (error) {
      setImportError(String(error));
    }
  }

  async function requestPhoneDeck(sourceId: string) {
    setImportError('');
    try {
      await invoke('request_legacy_deck_import', { sourceId });
    } catch (error) {
      setImportError(String(error));
    }
  }

  const online = connection?.serverOnline ?? false;
  const pairingQr = connection
    ? JSON.stringify({
        type: "freeze-pair",
        version: 1,
        transport,
        host: connection.host,
        deviceName: connection.deviceName,
        port: connection.port,
        token: connection.token,
      })
    : "";

  return (
    <main className={`app-shell ${connection?.isMacos ? 'macos-native-sidebar' : ''}`}>
      <aside className="sidebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <Snowflake size={20} strokeWidth={1.8} />
          <span>Freeze</span>
        </div>

        <div className="nav-heading">Workspace</div>
        <nav aria-label="Workspace">
          <button className={`nav-item ${screen === 'overview' ? 'selected' : ''}`} aria-current={screen === 'overview' ? 'page' : undefined} onClick={() => setScreen('overview')}>
            <LayoutDashboard size={16} strokeWidth={1.8} /><span>Overview</span>
          </button>
          <button className={`nav-item ${screen === 'deck' ? 'selected' : ''}`} aria-current={screen === 'deck' ? 'page' : undefined} onClick={() => setScreen('deck')}>
            <Layers size={16} strokeWidth={1.8} /><span>Deck</span>
          </button>
          <button className={`nav-item ${screen === 'settings' ? 'selected' : ''}`} aria-current={screen === 'settings' ? 'page' : undefined} onClick={() => setScreen('settings')}>
            <Settings size={16} strokeWidth={1.8} /><span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          {updater.state.kind === 'ready' ? <button type="button" className="update-pill" onClick={() => void updater.restart()}><span className="status-dot" />Restart to update</button> : <span className="version">{version}</span>}
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar" data-tauri-drag-region>
          <span>{screen === 'overview' ? 'Overview' : screen === 'deck' ? 'Deck' : 'Settings'}</span>
          <div className="network-badge">
            <Wifi size={14} strokeWidth={1.8} />
            {transport === 'usb' ? 'Android USB' : 'Local network'}
          </div>
        </header>

        <div className="content">
          {legacyImports.length > 0 ? <section className="legacy-imports" aria-label="Phone deck import">
            <div className="legacy-import-copy"><strong>{legacyImports.some((item) => item.ready) ? 'Phone deck ready to import' : 'Saved phone deck detected'}</strong><span>{legacyImports.map((item) => item.ready ? `${item.pages} pages · ${item.buttons} buttons ready as a new profile` : item.requested ? 'Transfer requested. Keep the phone connected.' : 'The saved buttons stay on the phone until you request a transfer.').join('  |  ')}</span></div>
            <div className="legacy-import-actions">{legacyImports.map((item) => <button key={item.sourceId} className="secondary-button" onClick={() => void (item.ready ? importPhoneDeck(item.sourceId) : requestPhoneDeck(item.sourceId))}>{item.ready ? 'Import phone deck' : item.requested ? 'Request again' : 'Transfer phone deck'}</button>)}</div>
            {importError ? <p className="usb-error" role="alert">{importError}</p> : null}
          </section> : null}
          {screen === 'deck' ? <DesktopDeckEditor config={deckConfig} onSaved={setDeckConfig} playbackState={playbackState} mediaState={mediaState} isMacos={connection?.isMacos ?? false} plugins={freezePlugins} widgetSurface={connection?.widgetSurface ?? null} /> : screen === 'settings' ? <>
          <div className="page-heading"><div><h1>Settings</h1><p>Manage updates, device navigation and Freeze plugins.</p></div></div>
          <UpdatesSetting updater={updater} />
          <section className="device-navigation-setting">
            <div className="device-navigation-copy"><h2>Independent device navigation</h2><p>Let each connected phone use its own profile and page. Turn this off to mirror navigation across all phones.</p></div>
            <button className={`setting-switch ${independentNavigation ? 'enabled' : ''}`} type="button" role="switch" aria-checked={independentNavigation} aria-label="Independent device navigation" disabled={navigationSettingBusy} onClick={() => void saveIndependentNavigation(!independentNavigation)}><span /></button>
            {navigationSettingError ? <p className="setting-error" role="alert">{navigationSettingError}</p> : null}
          </section>
          <FreezePluginSettings plugins={freezePlugins} warnings={freezePluginWarnings} onChange={(plugins, warnings) => { setFreezePlugins(plugins); setFreezePluginWarnings(warnings); }} />
          </> : <>
          <div className="page-heading">
            <div>
              <h1>Overview</h1>
              <p>Connect your phone and control this computer.</p>
            </div>
            <div className={`ready-badge ${online ? "ready" : ""}`}>
              <span className="status-dot" />
              {online ? "Ready to pair" : loadError ? "Unavailable" : "Starting"}
            </div>
          </div>

          <section className="pair-card" aria-labelledby="pair-title">
            <div className="pair-copy">
              <div className="section-title-row">
                <div className="section-icon"><Smartphone size={17} /></div>
                <div>
                  <h2 id="pair-title">Pair a phone</h2>
                  <p>Scan this code from the Freeze app on your phone.</p>
                </div>
              </div>

              <div className="connection-details">
                <div>
                  <span>PC address</span>
                  <code>
                    {connection
                      ? `${connection.host}:${connection.port}`
                      : loadError
                        ? "Unavailable"
                        : "Finding network…"}
                  </code>
                </div>
                <div>
                  <span>Pairing</span>
                  <span className="pairing-ready">
                    <ShieldCheck size={14} />
                    Key included in QR code
                  </span>
                </div>
              </div>

              <button
                className="secondary-button"
                onClick={copyPairingDetails}
                disabled={!connection}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy manual setup details"}
              </button>
              <div className="usb-setup">
                <div>
                  <strong>Android USB</strong>
                  <span>{adbDownloadMb !== null
                    ? `Freeze needs Google's Android USB tool (adb, about ${adbDownloadMb} MB). It is downloaded from dl.google.com and kept inside Freeze.`
                    : "Needs USB debugging turned on in the phone's Developer options."}</span>
                </div>
                <button className="secondary-button" onClick={() => void (adbDownloadMb !== null ? installAdb() : enableAndroidUsb())} disabled={!connection || usbBusy}>
                  {adbProgress || (usbBusy ? 'Setting up…' : adbDownloadMb !== null ? `Download (${adbDownloadMb} MB)` : usbEnabled ? 'Reconnect USB' : 'Set up USB')}
                </button>
              </div>
              {usbError ? <p className="usb-error" role="alert">{usbError}</p> : null}
              {transport === 'usb' && usbEnabled ? <p className="pair-note">Connect the Android phone by USB, then scan this code. Keep USB debugging enabled while using Freeze.</p> : null}
              {transport === 'usb' ? <p className="pair-note">On the phone: Settings → About phone → tap Build number 7 times → Developer options → turn on USB debugging, then tap Allow when asked.</p> : null}
              <p className="pair-note">iPhone USB data control needs a compatible MFi accessory. Use Wi-Fi on iOS.</p>
              <button className="secondary-button reset-pairing-button" onClick={() => void rotatePairingKey()}>Reset pairing key</button>
              {pairingError ? <p className="usb-error" role="alert">{pairingError}</p> : null}
              <p className="pair-note">
                Keep the QR code private. Anyone who scans it can control this PC.
              </p>
              {connection?.isMacos && (
                <p className="pair-note mac-note">
                  Allow Freeze under System Settings → Privacy &amp; Security → Accessibility to send shortcuts and volume keys. Now playing, play/pause and track skipping work without it.
                </p>
              )}
            </div>

            <div className="qr-column">
              <div className="transport-tabs" role="group" aria-label="Connection type">
                <button className={transport === 'wifi' ? 'transport-tab selected' : 'transport-tab'} onClick={() => setTransport('wifi')}>Wi-Fi</button>
                <button className={transport === 'usb' ? 'transport-tab selected' : 'transport-tab'} onClick={() => setTransport('usb')}>Android USB</button>
              </div>
              <div className="qr-frame">
                {connection && online && (transport === 'wifi' || usbEnabled) ? (
                  <QRCodeSVG
                    value={pairingQr}
                    size={184}
                    level="M"
                    marginSize={2}
                    aria-label="Freeze phone pairing QR code"
                  />
                ) : (
                  <div className="qr-placeholder">
                    <QrCode size={24} />
                  <span>{loadError ? "QR unavailable" : transport === 'usb' && !usbEnabled ? "Set up USB first" : "Starting…"}</span>
                  </div>
                )}
              </div>
              <span className="qr-caption">{transport === 'usb' ? 'Android USB pairing' : 'Wi-Fi pairing'}</span>
            </div>
          </section>

          <div className="section-heading">
            <h2>PC status</h2>
          </div>
          <div className="status-grid">
            <article className="status-card">
              <div className="card-heading">
                <span>Connection</span>
                <Wifi size={16} />
              </div>
              <strong>{online ? "Ready" : loadError ? "Unavailable" : "Starting"}</strong>
              <span className="card-foot">
                {connection?.activeDevices ?? 0} phones connected
              </span>
            </article>
            <article className="status-card">
              <div className="card-heading">
                <span>Controls</span>
                <Keyboard size={16} />
              </div>
              <strong>Shortcuts and media</strong>
              <span className="card-foot">Available from your phone</span>
            </article>
            <article className="status-card">
              <div className="card-heading">
                <span>Network</span>
                <Monitor size={16} />
              </div>
              <strong>Local only</strong>
              <span className="card-foot">No account or cloud relay</span>
            </article>
          </div>
          </>}
        </div>
      </section>
    </main>
  );
}

function FreezePluginSettings({ plugins, warnings, onChange }: { plugins: FreezePlugin[]; warnings: string[]; onChange: (plugins: FreezePlugin[], warnings: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    const listing = await invoke<FreezePluginListing>('list_freeze_plugins');
    onChange(listing.plugins, listing.warnings);
  }
  async function install() {
    setBusy(true);
    setError('');
    try {
      const sourcePath = await openFileDialog({ title: 'Choose a Freeze plugin folder', multiple: false, directory: true });
      if (typeof sourcePath !== 'string') return;
      await invoke<FreezePlugin>('install_freeze_plugin', { sourcePath });
      await refresh();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  async function uninstall(plugin: FreezePlugin) {
    if (!window.confirm(`Remove Freeze plugin “${plugin.name}”? Deck items using its actions or widgets must be removed or reconfigured first.`)) return;
    setBusy(true);
    setError('');
    try {
      await invoke('uninstall_freeze_plugin', { pluginId: plugin.id });
      await refresh();
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <section className="freeze-plugin-settings">
    <div className="freeze-plugin-heading"><div><h2><Package size={16} /> Freeze plugins</h2><p>Install Freeze-native actions and widgets for your deck.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => void install()}><Plus size={14} /> Install plugin</button></div>
    <p className="freeze-plugin-warning">Only install code from people you trust. Plugin scripts run as your PC user and may access your files and applications. Each deck button requires separate permission before it can run. Elgato Stream Deck packages are not supported.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {warnings.length ? <div className="freeze-plugin-errors" role="status">{warnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div> : null}
    {plugins.length ? <div className="freeze-plugin-list">{plugins.map((plugin) => <article className="freeze-plugin-item" key={plugin.id}><div><strong>{plugin.name} <span>v{plugin.version}</span></strong><small>{plugin.description || `${plugin.actions.length} actions`}</small><small>{plugin.actions.map((action) => action.name).join(' · ')}</small></div><button type="button" className="icon-button" aria-label={`Remove ${plugin.name}`} title="Remove plugin" disabled={busy} onClick={() => void uninstall(plugin)}><Trash2 size={14} /></button></article>)}</div> : <p className="freeze-plugin-empty">No Freeze plugins installed.</p>}
    <details className="freeze-plugin-format"><summary>Plugin folder format</summary><code>{`manifest.json\nscripts/your-action.ps1  (Windows)\nscripts/your-action.sh    (macOS)`}</code><span>Manifest schema and a complete example: pc-companion/docs/freeze-plugin-format.md</span></details>
  </section>;
}

function DesktopDeckEditor({ config: savedConfig, onSaved, playbackState, mediaState, isMacos, plugins, widgetSurface }: { config: DeckConfig | null; onSaved: (config: DeckConfig) => void; playbackState: PlaybackState; mediaState: SystemMediaState; isMacos: boolean; plugins: FreezePlugin[]; widgetSurface: WidgetSurface | null }) {
  const [workingConfig, setWorkingConfig] = useState<DeckConfig | null>(savedConfig);
  const [profileId, setProfileId] = useState('');
  const [pageId, setPageId] = useState('');
  const [buttonId, setButtonId] = useState('');
  const [widgetId, setWidgetId] = useState('');
  const [widgetPageId, setWidgetPageId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [editingPageId, setEditingPageId] = useState('');
  const [pageNameDraft, setPageNameDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draggingButtonId, setDraggingButtonId] = useState('');
  const [dragOverButtonId, setDragOverButtonId] = useState('');
  const [dragOverCellKey, setDragOverCellKey] = useState('');
  const [resizePreview, setResizePreview] = useState<{ id: string; placement: DeckPlacement; valid: boolean } | null>(null);
  const [autoSwitchAppDraft, setAutoSwitchAppDraft] = useState('');
  const [addMenu, setAddMenu] = useState<{ anchor: DOMRect; row?: number; column?: number } | null>(null);
  const buttonDrag = useRef<{ id: string; surface: 'page' | 'widgets'; kind: 'button' | 'widget'; pointerId: number; x: number; y: number; active: boolean } | null>(null);
  const resizeDrag = useRef<{ id: string; surface: 'page' | 'widgets'; kind: 'button' | 'widget'; pointerId: number; x: number; y: number; placement: DeckPlacement } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const widgetCanvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setWorkingConfig(savedConfig); }, [savedConfig]);
  const config = workingConfig ?? savedConfig;

  useEffect(() => {
    if (!config) return;
    const profile = config.profiles.find((item) => item.id === (profileId || config.activeProfileId)) ?? config.profiles[0];
    const page = profile.pages.find((item) => item.id === (pageId || profile.activePageId)) ?? profile.pages[0];
    setProfileId(profile.id);
    setPageId(page.id);
    const area = page.widgetArea;
    const widgetPage = area?.pages.find((item) => item.id === widgetPageId) ?? area?.pages[0];
    if (widgetPage && widgetPage.id !== widgetPageId) setWidgetPageId(widgetPage.id);
    if (!widgetId && !page.buttons.some((button) => button.id === buttonId) && !widgetPage?.buttons.some((button) => button.id === buttonId)) setButtonId(page.buttons[0]?.id ?? '');
    if (!widgetPage?.widgets.some((widget) => widget.id === widgetId)) setWidgetId('');
  }, [config, profileId, pageId, buttonId, widgetId]);

  const activeProfile = config?.profiles.find((item) => item.id === profileId) ?? config?.profiles[0];
  const activePage = activeProfile?.pages.find((item) => item.id === pageId) ?? activeProfile?.pages[0];
  useEffect(() => { if (activeProfile) setProfileName(activeProfile.name); }, [activeProfile?.id, activeProfile?.name]);
  useEffect(() => setAutoSwitchAppDraft(''), [activeProfile?.id]);

  if (!config || !activeProfile || !activePage) return <div className="deck-loading">Loading your PC deck…</div>;
  const deck = config;
  const profile = activeProfile;
  const page = activePage;
  const widgetArea = page.widgetArea ?? emptyWidgetArea();
  const widgetPage = widgetArea.pages.find((item) => item.id === widgetPageId) ?? widgetArea.pages[0];
  const widgetScreen: WidgetScreen = { enabled: widgetArea.enabled, rows: widgetArea.rows, columns: widgetArea.columns, buttons: widgetPage?.buttons ?? [], widgets: widgetPage?.widgets ?? [] };
  const selected = page.buttons.find((button) => button.id === buttonId) ?? widgetScreen.buttons.find((button) => button.id === buttonId) ?? null;
  const selectedWidget = widgetScreen.widgets.find((widget) => widget.id === widgetId) ?? null;
  const selectedWidgetDefinition = selectedWidget?.type === 'plugin'
    ? plugins.find((plugin) => plugin.id === selectedWidget.pluginId)?.widgets?.find((widget) => widget.id === selectedWidget.widgetId) ?? null
    : null;
  const pluginWidgetOptions = plugins.flatMap((plugin) => (plugin.widgets ?? []).map((widget) => ({
    value: `${plugin.id}::${widget.id}`,
    label: `${plugin.name} · ${widget.name}`,
    plugin,
    widget,
  })));
  const occupied = occupiedDeckCells(page);
  const widgetOccupied = occupiedWidgetCells(widgetScreen);
  const hasFreeCell = occupied.size < page.rows * page.columns;

  async function save(next: DeckConfig) {
    const normalized: DeckConfig = {
      ...next,
      profiles: next.profiles.map((item) => ({
        ...item,
        pages: item.pages.map((deckPage) => {
          const area = deckPage.widgetArea;
          if (!area) return deckPage;
          return {
            ...deckPage,
            widgetArea: {
              ...area,
              pages: area.pages.map((widgetPage) => ({
                ...widgetPage,
                widgets: widgetPage.widgets.map((widget) => {
                  if (widget.type !== 'plugin') return widget;
                  const definition = plugins.find((plugin) => plugin.id === widget.pluginId)?.widgets?.find((candidate) => candidate.id === widget.widgetId);
                  if (!definition) return widget;
                  const values = Object.fromEntries(definition.inputs.map((input) => [input.id, widget.values[input.id] ?? (input.default || (input.type === 'select' ? input.options[0] ?? '' : ''))]));
                  return { ...widget, values };
                }),
              })),
            },
          };
        }),
      })),
    };
    for (const widget of normalized.profiles.flatMap((item) => item.pages.flatMap((deckPage) => deckPage.widgetArea?.pages.flatMap((widgetPage) => widgetPage.widgets) ?? []))) {
      if (widget.type !== 'plugin') continue;
      const definition = plugins.find((plugin) => plugin.id === widget.pluginId)?.widgets?.find((item) => item.id === widget.widgetId);
      if (!definition) continue;
      const inputs = new Map(definition.inputs.map((input) => [input.id, input]));
      if (Object.keys(widget.values).some((id) => !inputs.has(id))) {
        setError(`“${definition.name}” contains an unknown input. Reconfigure it before saving.`);
        return;
      }
      if (definition.inputs.some((input) => input.type === 'select' && !input.options.includes(widget.values[input.id] ?? ''))) {
        setError(`Choose a valid option for every select field in “${definition.name}”.`);
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const saved = await invoke<DeckConfig>('save_deck_config', { config: normalized });
      onSaved(saved);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  function replacePage(nextPage: DeckPage, nextProfile = profile, persist = true) {
    const next = { ...deck, activeProfileId: nextProfile.id, profiles: deck.profiles.map((item) => item.id === nextProfile.id ? { ...nextProfile, activePageId: nextPage.id, pages: nextProfile.pages.map((candidate) => candidate.id === nextPage.id ? nextPage : candidate) } : item) };
    setProfileId(nextProfile.id);
    setPageId(nextPage.id);
    setWorkingConfig(next);
    if (persist) void save(next);
  }

  function replaceWidgetScreen(nextScreen: WidgetScreen, nextProfile = profile, persist = true, basePage = page) {
    const baseArea = basePage.widgetArea ?? emptyWidgetArea();
    const pages = baseArea.pages.map((item) => item.id === widgetPage?.id ? { ...item, buttons: nextScreen.buttons, widgets: nextScreen.widgets } : item);
    const nextArea: WidgetArea = { enabled: nextScreen.enabled, rows: nextScreen.rows, columns: nextScreen.columns, pages: pages.length ? pages : [{ id: 'widgets-1', name: 'Page 1', buttons: nextScreen.buttons, widgets: nextScreen.widgets }] };
    const nextPage = { ...basePage, widgetArea: nextArea };
    replacePage(nextPage, nextProfile, persist);
  }

  function addPage() {
    if (profile.pages.length >= 8) return setError('Profiles can have up to 8 pages.');
    const id = `page-${Date.now()}`;
    const nextPage = { id, name: `Page ${profile.pages.length + 1}`, rows: 2, columns: 3, buttons: [] };
    const nextProfile = { ...profile, pages: [...profile.pages, nextPage], activePageId: id };
    const next = { ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? nextProfile : item), activeProfileId: profile.id };
    setPageId(id);
    void save(next);
  }

  function addButton(row?: number, column?: number) {
    const targetPage = page.rows === 0 && page.columns === 0 ? { ...page, rows: 1, columns: 1 } : page;
    const placement = row === undefined || column === undefined
      ? firstButtonPlacement(targetPage)
      : canPlaceButton(targetPage, '', { row, column, rowSpan: 1, columnSpan: 1 })
        ? { row, column, rowSpan: 1, columnSpan: 1 }
        : null;
    if (!placement) return setError('There is no free grid cell. Move or resize a button to make room.');
    const id = `button-${Date.now()}`;
    const nextButton: DeckButton = { id, label: 'New button', icon: 'auto', placement, action: { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] } };
    replacePage({ ...targetPage, buttons: [...targetPage.buttons, nextButton] });
    setButtonId(id);
  }

  function moveButtonTo(buttonId: string, row: number, column: number) {
    const moving = page.buttons.find((button) => button.id === buttonId);
    if (!moving || busy) return;
    const placement = { ...buttonPlacement(page, moving), row, column };
    if (!canPlaceButton(page, buttonId, placement)) return setError('That position is occupied or outside the grid. Move another button first.');
    setError('');
    replacePage({ ...page, buttons: page.buttons.map((button) => button.id === buttonId ? { ...button, placement } : button) });
  }

  function moveItemBetweenSurfaces(itemId: string, source: 'page' | 'widgets', target: 'page' | 'widgets', row: number, column: number, kind: 'button' | 'widget', targetId = '') {
    if (busy) return;
    if (kind === 'widget') {
      if (source !== 'widgets' || target !== 'widgets') return;
      const widget = widgetScreen.widgets.find((item) => item.id === itemId);
      if (!widget) return;
      if (source === target && targetId && targetId !== itemId) {
        const placements = swapPlacements(widgetScreen.rows, widgetScreen.columns, [
          ...widgetScreen.buttons.map((button) => ({ id: button.id, placement: buttonPlacement({ ...widgetScreen, id: '', name: '', buttons: widgetScreen.buttons }, button) })),
          ...widgetScreen.widgets.map((item) => ({ id: item.id, placement: item.placement })),
        ], itemId, targetId);
        if (!placements) return setError('Those items cannot swap places without overlapping. Resize one and try again.');
        setError('');
        replaceWidgetScreen({ ...widgetScreen,
          buttons: widgetScreen.buttons.map((button) => ({ ...button, placement: placements.get(button.id)! })),
          widgets: widgetScreen.widgets.map((item) => ({ ...item, placement: placements.get(item.id)! })),
        });
        setWidgetId(itemId);
        setButtonId('');
        return;
      }
      const placement = { ...widget.placement, row, column };
      if (!canPlaceWidgetItem(widgetScreen, itemId, placement)) return setError('That position is occupied or outside the widget screen.');
      replaceWidgetScreen({ ...widgetScreen, widgets: widgetScreen.widgets.map((item) => item.id === itemId ? { ...item, placement } : item) });
      setWidgetId(itemId);
      setButtonId('');
      return;
    }
    const button = (source === 'page' ? page.buttons : widgetScreen.buttons).find((item) => item.id === itemId);
    if (!button) return;
    const placement = { ...buttonPlacement(source === 'page' ? page : { ...widgetScreen, id: 'widgets', name: 'Widgets' }, button), row, column };
    if (source === target) {
      if (targetId && targetId !== itemId) {
        const currentPage = target === 'page' ? page : null;
        const items = target === 'page'
          ? page.buttons.map((item) => ({ id: item.id, placement: buttonPlacement(page, item) }))
          : [
            ...widgetScreen.buttons.map((item) => ({ id: item.id, placement: buttonPlacement({ ...widgetScreen, id: '', name: '', buttons: widgetScreen.buttons }, item) })),
            ...widgetScreen.widgets.map((item) => ({ id: item.id, placement: item.placement })),
          ];
        const placements = swapPlacements(target === 'page' ? page.rows : widgetScreen.rows, target === 'page' ? page.columns : widgetScreen.columns, items, itemId, targetId);
        if (!placements) return setError('Those items cannot swap places without overlapping. Resize one and try again.');
        setError('');
        if (currentPage) replacePage({ ...currentPage, buttons: currentPage.buttons.map((item) => ({ ...item, placement: placements.get(item.id)! })) });
        else replaceWidgetScreen({ ...widgetScreen,
          buttons: widgetScreen.buttons.map((item) => ({ ...item, placement: placements.get(item.id)! })),
          widgets: widgetScreen.widgets.map((item) => ({ ...item, placement: placements.get(item.id)! })),
        });
        setButtonId(itemId);
        setWidgetId('');
        return;
      }
      const valid = target === 'page' ? canPlaceButton(page, itemId, placement) : canPlaceWidgetItem(widgetScreen, itemId, placement);
      if (!valid) return setError(`That position is occupied or outside the ${target === 'page' ? 'button grid' : 'widget screen'}.`);
      setError('');
      if (target === 'page') replacePage({ ...page, buttons: page.buttons.map((item) => item.id === itemId ? { ...item, placement } : item) });
      else replaceWidgetScreen({ ...widgetScreen, buttons: widgetScreen.buttons.map((item) => item.id === itemId ? { ...item, placement } : item) });
    } else if (target === 'widgets') {
      if (!canPlaceWidgetItem(widgetScreen, '', placement)) return setError('That position is occupied or outside the widget screen.');
      setError('');
      replaceWidgetScreen({ ...widgetScreen, enabled: true, buttons: [...widgetScreen.buttons, { ...button, placement }] }, profile, true, { ...page, buttons: page.buttons.filter((entry) => entry.id !== itemId) });
    } else {
      const targetPage = page.rows === 0 && page.columns === 0
        ? { ...page, rows: Math.max(1, placement.rowSpan), columns: Math.max(1, placement.columnSpan), buttons: [] }
        : page;
      const targetPlacement = targetPage === page ? placement : { row: 0, column: 0, rowSpan: placement.rowSpan, columnSpan: placement.columnSpan };
      if (!canPlaceButton(targetPage, '', targetPlacement)) return setError('That position is occupied or outside the button grid.');
      const nextPage = { ...targetPage, buttons: [...targetPage.buttons, { ...button, placement: targetPlacement }] };
      const nextScreen = { ...widgetScreen, buttons: widgetScreen.buttons.filter((item) => item.id !== itemId) };
      setError('');
      replaceWidgetScreen(nextScreen, profile, true, nextPage);
    }
    setButtonId(itemId);
    setWidgetId('');
  }

  function moveSelectedButtonToOtherSurface() {
    if (!selected) return;
    const source = page.buttons.some((button) => button.id === selected.id) ? 'page' : 'widgets';
    const placement = buttonPlacement(source === 'page' ? page : { ...widgetScreen, id: 'widgets', name: 'Widgets' }, selected);
    const target = source === 'page' ? 'widgets' : 'page';
    const destination = target === 'page'
      ? page.rows === 0 && page.columns === 0
        ? placement.rowSpan <= 6 && placement.columnSpan <= 6 ? { row: 0, column: 0, rowSpan: placement.rowSpan, columnSpan: placement.columnSpan } : null
        : firstButtonPlacement(page, placement.rowSpan, placement.columnSpan)
      : firstWidgetPlacement(widgetScreen, placement.rowSpan, placement.columnSpan);
    if (!destination) return setError(`There is no free ${target === 'page' ? 'button grid' : 'widget screen'} space large enough for this button.`);
    moveItemBetweenSurfaces(selected.id, source, target, destination.row, destination.column, 'button');
  }

  function resizeButtonTo(buttonId: string, placement: DeckPlacement) {
    if (busy) return false;
    if (!canPlaceButton(page, buttonId, placement)) return false;
    setError('');
    replacePage({ ...page, buttons: page.buttons.map((button) => button.id === buttonId ? { ...button, placement } : button) });
    return true;
  }

  function resizeWidgetItem(itemId: string, placement: DeckPlacement, kind: 'button' | 'widget') {
    if (busy || !canPlaceWidgetItem(widgetScreen, itemId, placement)) return false;
    if (kind === 'button') replaceWidgetScreen({ ...widgetScreen, buttons: widgetScreen.buttons.map((button) => button.id === itemId ? { ...button, placement } : button) });
    else replaceWidgetScreen({ ...widgetScreen, widgets: widgetScreen.widgets.map((widget) => widget.id === itemId ? { ...widget, placement } : widget) });
    return true;
  }

  function startButtonDrag(event: React.PointerEvent<HTMLButtonElement>, id: string, surface: 'page' | 'widgets' = 'page') {
    if (event.button !== 0 || busy) return;
    buttonDrag.current = { id, surface, kind: 'button', pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startWidgetDrag(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || busy) return;
    buttonDrag.current = { id, surface: 'widgets', kind: 'widget', pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveButtonDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = buttonDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    drag.active = true;
    event.preventDefault();
    setDraggingButtonId(drag.id);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-deck-cell]');
    const targetId = target?.dataset.deckItem ?? target?.dataset.deckButton ?? '';
    if (targetId !== dragOverButtonId) setDragOverButtonId(targetId);
    const cellKey = target ? `${target.dataset.row}:${target.dataset.column}` : '';
    if (cellKey !== dragOverCellKey) setDragOverCellKey(cellKey);
  }

  function finishButtonDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = buttonDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    buttonDrag.current = null;
    if (drag.active) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-deck-cell]');
      if (target?.dataset.surface === 'page' || target?.dataset.surface === 'widgets') {
        moveItemBetweenSurfaces(drag.id, drag.surface, target.dataset.surface, Number(target.dataset.row), Number(target.dataset.column), drag.kind, target.dataset.deckItem ?? target.dataset.deckButton ?? '');
      }
      if (drag.kind === 'button') setButtonId(drag.id);
      else setWidgetId(drag.id);
    }
    setDraggingButtonId('');
    setDragOverButtonId('');
    setDragOverCellKey('');
  }

  function cancelButtonDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (buttonDrag.current?.pointerId !== event.pointerId) return;
    buttonDrag.current = null;
    setDraggingButtonId('');
    setDragOverButtonId('');
    setDragOverCellKey('');
  }

  function startResize(event: React.PointerEvent<HTMLSpanElement>, button: DeckButton | DeckWidget, surface: 'page' | 'widgets' = 'page', kind: 'button' | 'widget' = 'button') {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const placement = kind === 'widget' ? (button as DeckWidget).placement : buttonPlacement(surface === 'page' ? page : { ...widgetScreen, id: 'widgets', name: 'Widgets' }, button as DeckButton);
    resizeDrag.current = { id: button.id, surface, kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, placement };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === 'button') setButtonId(button.id);
    else setWidgetId(button.id);
  }

  function moveResize(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = resizeDrag.current;
    const canvas = drag?.surface === 'widgets' ? widgetCanvasRef.current : canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;
    const surface = drag.surface === 'widgets' ? widgetScreen : null;
    const rowCount = surface?.rows ?? page.rows;
    const columnCount = surface?.columns ?? page.columns;
    const bounds = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const gap = Number.parseFloat(style.columnGap) || 10;
    const rowGap = Number.parseFloat(style.rowGap) || gap;
    const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    const cellWidth = (bounds.width - horizontalPadding - gap * (columnCount - 1)) / columnCount;
    const cellHeight = 100;
    const columnSpan = Math.max(1, drag.placement.columnSpan + Math.round((event.clientX - drag.x) / (cellWidth + gap)));
    const rowSpan = Math.max(1, drag.placement.rowSpan + Math.round((event.clientY - drag.y) / (cellHeight + rowGap)));
    const placement = { ...drag.placement, rowSpan, columnSpan };
    const valid = drag.surface === 'page' ? canPlaceButton(page, drag.id, placement) : canPlaceWidgetItem(widgetScreen, drag.id, placement);
    setResizePreview({ id: drag.id, placement, valid: valid && placement.row + placement.rowSpan <= rowCount });
  }

  function finishResize(event: React.PointerEvent<HTMLSpanElement>) {
    const drag = resizeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeDrag.current = null;
    const preview = resizePreview;
    if (preview?.id === drag.id && preview.valid) {
      if (drag.surface === 'page') resizeButtonTo(drag.id, preview.placement);
      else resizeWidgetItem(drag.id, preview.placement, drag.kind);
    }
    else if (preview?.id === drag.id && (preview.placement.rowSpan !== drag.placement.rowSpan || preview.placement.columnSpan !== drag.placement.columnSpan)) setError('That size overlaps another button or extends beyond the grid.');
    setResizePreview(null);
  }

  function cancelResize(event: React.PointerEvent<HTMLSpanElement>) {
    if (resizeDrag.current?.pointerId !== event.pointerId) return;
    resizeDrag.current = null;
    setResizePreview(null);
  }

  function duplicateButton() {
    if (!selected) return;
    const sourcePlacement = buttonPlacement(page, selected);
    const placement = firstButtonPlacement(page, sourcePlacement.rowSpan, sourcePlacement.columnSpan);
    if (!placement) return setError('There is no free space large enough to duplicate this button.');
    const id = `button-${Date.now()}`;
    const buttons = [...page.buttons, { ...selected, id, placement, label: `${selected.label} copy`.slice(0, 24) }];
    replacePage({ ...page, buttons });
    setButtonId(id);
  }

  function addProfile() {
    if (deck.profiles.length >= 32) return setError('You can create up to 32 profiles.');
    const id = `profile-${Date.now()}`;
    const nextProfile: DeckProfile = { id, name: `Profile ${deck.profiles.length + 1}`, pages: [{ id: `${id}-main`, name: 'Main', rows: 2, columns: 3, buttons: [] }], activePageId: `${id}-main`, autoSwitchApps: [], autoSwitchEnabled: false };
    const next = { ...deck, activeProfileId: id, profiles: [...deck.profiles, nextProfile] };
    setProfileId(id);
    setPageId(nextProfile.activePageId);
    setButtonId('');
    setWidgetId('');
    void save(next);
  }

  function renameProfile() {
    const name = profileName.trim();
    if (!name || name.length > 32) return setError('Profile names must be 1–32 characters.');
    if (name === profile.name) return;
    const next = { ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? { ...item, name } : item) };
    void save(next);
  }

  function deleteProfile() {
    if (deck.profiles.length <= 1) return setError('Keep at least one profile.');
    const remaining = deck.profiles.filter((item) => item.id !== profile.id);
    const next = { ...deck, activeProfileId: remaining[0].id, fallbackProfileId: deck.fallbackProfileId === profile.id ? remaining[0].id : deck.fallbackProfileId, profiles: remaining };
    setProfileId(remaining[0].id);
    setPageId(remaining[0].activePageId);
    setButtonId('');
    void save(next);
  }

  function renamePage(pageId: string, draft: string) {
    const currentPage = profile.pages.find((item) => item.id === pageId);
    if (!currentPage) return;
    const name = draft.trim();
    if (!name || name.length > 24) {
      setError('Page names must be 1–24 characters.');
      setEditingPageId('');
      return;
    }
    if (profile.pages.some((item) => item.id !== pageId && item.name.toLowerCase() === name.toLowerCase())) {
      setError('Page names must be unique within a profile.');
      setEditingPageId('');
      return;
    }
    setEditingPageId('');
    if (name === currentPage.name) return;
    setError('');
    const nextProfile = { ...profile, pages: profile.pages.map((item) => item.id === pageId ? { ...item, name } : item) };
    void save({ ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? nextProfile : item) });
  }

  function deletePage() {
    if (profile.pages.length <= 1) return setError('Keep at least one page in each profile.');
    const remaining = profile.pages.filter((item) => item.id !== page.id);
    const nextProfile = { ...profile, pages: remaining, activePageId: remaining[0].id };
    setPageId(remaining[0].id);
    setButtonId(remaining[0].buttons[0]?.id ?? '');
    void save({ ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? nextProfile : item) });
  }

  function updateButton(patch: Partial<DeckButton>) {
    if (!selected) return;
    if (page.buttons.some((button) => button.id === selected.id)) replacePage({ ...page, buttons: page.buttons.map((button) => button.id === selected.id ? { ...button, ...patch } : button) }, profile, false);
    else replaceWidgetScreen({ ...widgetScreen, buttons: widgetScreen.buttons.map((button) => button.id === selected.id ? { ...button, ...patch } : button) }, profile, false);
  }

  function resizePage(dimension: 'rows' | 'columns', value: string) {
    const nextValue = Number(value);
    if (!Number.isInteger(nextValue) || nextValue < 0 || nextValue > 6) return;
    if (nextValue === 0) {
      if (page.buttons.length) {
        let nextScreen = { ...widgetScreen, enabled: true };
        for (const button of page.buttons) {
          const source = buttonPlacement(page, button);
          const placement = firstWidgetPlacement(nextScreen, source.rowSpan, source.columnSpan);
          if (!placement) return setError('The widget area does not have enough room for every button. Expand it or move some buttons there first.');
          nextScreen = { ...nextScreen, buttons: [...nextScreen.buttons, { ...button, placement }] };
        }
        setError('');
        replaceWidgetScreen(nextScreen, profile, true, { ...page, rows: 0, columns: 0, buttons: [] });
        return;
      }
      setError('');
      replacePage({ ...page, rows: 0, columns: 0 });
      return;
    }
    const rows = dimension === 'rows' ? nextValue : page.rows || 1;
    const columns = dimension === 'columns' ? nextValue : page.columns || 3;
    if (page.buttons.some((button) => {
      const placement = buttonPlacement(page, button);
      return placement.row + placement.rowSpan > rows || placement.column + placement.columnSpan > columns;
    })) return setError(`A button extends beyond the new grid. Move or resize it before reducing ${dimension}.`);
    setError('');
    replacePage({ ...page, rows, columns });
  }

  function updateWidgetScreen(patch: Partial<WidgetScreen>) {
    replaceWidgetScreen({ ...widgetScreen, ...patch });
  }

  function addWidgetPage() {
    if (widgetArea.pages.length >= 9) return setError('A page can have up to 9 widget pages.');
    const id = `widgets-${Date.now()}`;
    const nextArea = { ...widgetArea, enabled: true, pages: [...widgetArea.pages, { id, name: `Page ${widgetArea.pages.length + 1}`, buttons: [], widgets: [] }] };
    replacePage({ ...page, widgetArea: nextArea });
    setWidgetPageId(id);
    setButtonId('');
    setWidgetId('');
  }

  function selectWidgetPage(id: string) {
    setWidgetPageId(id);
    setButtonId('');
    setWidgetId('');
  }

  function deleteWidgetPage() {
    if (widgetArea.pages.length <= 1) return setError('Keep at least one widget page.');
    if (widgetScreen.buttons.length + widgetScreen.widgets.length > 0) return setError('Move or delete the items on this widget page first.');
    const remaining = widgetArea.pages.filter((item) => item.id !== widgetPage?.id);
    replacePage({ ...page, widgetArea: { ...widgetArea, pages: remaining } });
    setWidgetPageId(remaining[0].id);
  }

  function resizeWidgetScreen(dimension: 'rows' | 'columns', value: string) {
    const nextValue = Number(value);
    if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 6) return;
    const nextScreen = { ...widgetScreen, [dimension]: nextValue };
    if (widgetArea.pages.some((candidate) => [
      ...candidate.buttons.map((button) => button.placement ?? buttonPlacement({ id: '', name: '', rows: widgetScreen.rows, columns: widgetScreen.columns, buttons: candidate.buttons }, button)),
      ...candidate.widgets.map((widget) => widget.placement),
    ].some((placement) => placement.row + placement.rowSpan > nextScreen.rows || placement.column + placement.columnSpan > nextScreen.columns))) {
      return setError(`An item extends beyond the new widget screen. Move or resize it before reducing ${dimension}.`);
    }
    setError('');
    updateWidgetScreen({ [dimension]: nextValue });
  }

  function addWidget(choice: WidgetChoice, row?: number, column?: number) {
    setAddMenu(null);
    const placement = row === undefined || column === undefined
      ? firstWidgetPlacement(widgetScreen)
      : canPlaceWidgetItem(widgetScreen, '', { row, column, rowSpan: 1, columnSpan: 1 })
        ? { row, column, rowSpan: 1, columnSpan: 1 }
        : null;
    if (!placement) return setError('There is no free cell on the widget screen. Move or resize an item to make room.');
    const id = `widget-${Date.now()}`;
    let widget: DeckWidget;
    if (choice.kind === 'plugin') {
      const definition = plugins.find((item) => item.id === choice.pluginId)?.widgets?.find((item) => item.id === choice.widgetId);
      if (!definition) return;
      const values = Object.fromEntries(definition.inputs.map((input) => [input.id, input.default || (input.type === 'select' ? input.options[0] ?? '' : '')]));
      widget = { id, type: 'plugin', pluginId: choice.pluginId, widgetId: choice.widgetId, renderType: definition.type, values, placement };
    } else widget = { id, type: choice.kind, placement };
    setError('');
    setWidgetId(widget.id);
    setButtonId('');
    updateWidgetScreen({ enabled: true, widgets: [...widgetScreen.widgets, widget] });
  }

  function updateSelectedClockWidget(patch: { face?: string; color?: string }) {
    if (selectedWidget?.type !== 'clock') return;
    replaceWidgetScreen({ ...widgetScreen, widgets: widgetScreen.widgets.map((widget) => widget.id === selectedWidget.id && widget.type === 'clock'
      ? { ...widget, ...patch }
      : widget) }, profile, false);
  }

  function updateSelectedPcStatsWidget(patch: { face?: string; metric?: string; color?: string; gpu?: string }) {
    if (selectedWidget?.type !== 'pc_stats') return;
    replaceWidgetScreen({ ...widgetScreen, widgets: widgetScreen.widgets.map((widget) => widget.id === selectedWidget.id && widget.type === 'pc_stats'
      ? { ...widget, ...patch }
      : widget) }, profile, false);
  }

  function updateSelectedPluginWidgetValue(inputId: string, value: string) {
    if (selectedWidget?.type !== 'plugin' || !selectedWidgetDefinition?.inputs.some((input) => input.id === inputId)) return;
    const values = Object.fromEntries(selectedWidgetDefinition.inputs.map((input) => [input.id, selectedWidget.values[input.id] ?? input.default]));
    values[inputId] = value;
    replaceWidgetScreen({ ...widgetScreen, widgets: widgetScreen.widgets.map((widget) => widget.id === selectedWidget.id && widget.type === 'plugin'
      ? { ...widget, values }
      : widget) }, profile, false);
  }

  function deleteSelectedWidget() {
    if (!selectedWidget) return;
    updateWidgetScreen({ widgets: widgetScreen.widgets.filter((widget) => widget.id !== selectedWidget.id) });
    setWidgetId('');
  }

  function updateAutoSwitchApps(apps: string[]) {
    void save({ ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? { ...item, autoSwitchApps: apps } : item) });
  }

  function addAutoSwitchApp(value = autoSwitchAppDraft) {
    const app = value.trim();
    if (!app) return;
    if (profile.autoSwitchApps.some((item) => item.toLowerCase() === app.toLowerCase())) {
      setError('This application is already assigned to the selected profile.');
      return;
    }
    if (deck.profiles.some((item) => item.id !== profile.id && item.autoSwitchApps.some((target) => target.toLowerCase() === app.toLowerCase()))) {
      setError('This application is already assigned to another profile.');
      return;
    }
    setError('');
    setAutoSwitchAppDraft('');
    updateAutoSwitchApps([...profile.autoSwitchApps, app]);
  }

  async function browseAutoSwitchApp() {
    try {
      const path = await openFileDialog({
        title: 'Choose an application for automatic profile switching',
        multiple: false,
        directory: isMacos,
        filters: [isMacos ? { name: 'Applications', extensions: ['app'] } : { name: 'Applications', extensions: ['exe'] }],
      });
      if (typeof path === 'string') addAutoSwitchApp(path);
    } catch (cause) {
      setError(`Could not open the application picker: ${String(cause)}`);
    }
  }

  function updateProfileAutoSwitch(enabled: boolean) {
    void save({ ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? { ...item, autoSwitchEnabled: enabled } : item) });
  }

  function updateFallbackProfile(fallbackProfileId: string) {
    void save({ ...deck, fallbackProfileId });
  }

  return <>
    <div className="page-heading">
      <div><h1>Deck</h1><p>Build the controls saved on this PC and shared with connected phones.</p></div>
      <div className="heading-actions">{deck.profiles.length > 1 ? <button className="secondary-button" onClick={deleteProfile} disabled={busy}><Trash2 size={14} /> Delete profile</button> : null}{profile.pages.length > 1 ? <button className="secondary-button" onClick={deletePage} disabled={busy}><Trash2 size={14} /> Delete page</button> : null}<button className="primary-button" onClick={addProfile} disabled={busy}><Plus size={15} /> New profile</button></div>
    </div>
    {error ? <p className="usb-error" role="alert">{error}</p> : null}
    <section className="deck-toolbar">
      <label>Profile<DeckSelect value={profile.id} disabled={busy} options={deck.profiles.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => { const nextProfile = deck.profiles.find((item) => item.id === value)!; setProfileId(nextProfile.id); setPageId(nextProfile.activePageId); setButtonId(''); setWidgetId(''); void save({ ...deck, activeProfileId: nextProfile.id }); }} /></label>
      <label>Profile name<input value={profileName} maxLength={32} disabled={busy} onChange={(event) => setProfileName(event.target.value)} onBlur={renameProfile} /></label>
      <div className="page-control"><label>Pages<div className="page-switcher">{profile.pages.map((item) => item.id === editingPageId ? <input key={item.id} className="page-tab-editor" aria-label={`Rename ${item.name}`} value={pageNameDraft} maxLength={24} style={{ width: `${Math.max(8, pageNameDraft.length + 2)}ch` }} autoFocus disabled={busy} onChange={(event) => setPageNameDraft(event.target.value)} onBlur={() => renamePage(item.id, pageNameDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /> : <button key={item.id} className={`transport-tab ${page.id === item.id ? 'selected' : ''}`} disabled={busy} title="Double-click to rename" onDoubleClick={() => { setPageId(item.id); setPageNameDraft(item.name); setEditingPageId(item.id); }} onClick={() => { setPageId(item.id); setWidgetId(''); if (page.id !== item.id) setButtonId(''); if (profile.activePageId !== item.id) void save({ ...deck, activeProfileId: profile.id, profiles: deck.profiles.map((entry) => entry.id === profile.id ? { ...entry, activePageId: item.id } : entry) }); }}>{item.name}</button>)}</div></label><button className="add-page-button" onClick={addPage} disabled={busy || profile.pages.length >= 8} aria-label="Add page" title="Add page"><Plus size={16} /></button></div>
    </section>
    <section className="auto-switch-card">
      <div className="auto-switch-heading"><div><h2>Automatic switching · {profile.name}</h2><p>Switch to this profile when one of its assigned apps is in the foreground on this PC.</p></div><label className="auto-switch-toggle"><input type="checkbox" checked={profile.autoSwitchEnabled} disabled={busy} onChange={(event) => updateProfileAutoSwitch(event.target.checked)} /> Enabled</label></div>
      <div className="auto-switch-settings">
        <label>Fallback when leaving an automatic profile<DeckSelect value={deck.fallbackProfileId || deck.profiles[0].id} disabled={busy} options={deck.profiles.map((item) => ({ value: item.id, label: item.name }))} onChange={updateFallbackProfile} /></label>
        <div className="auto-switch-apps"><div className="auto-switch-apps-heading"><strong>Apps assigned to {profile.name}</strong><span>Entering a process name also works.</span></div><div className="auto-switch-app-add"><input value={autoSwitchAppDraft} maxLength={512} disabled={busy} placeholder={isMacos ? 'App name or .app path' : 'App name or .exe path'} onChange={(event) => setAutoSwitchAppDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addAutoSwitchApp(); } }} /><button className="secondary-button" disabled={busy || !autoSwitchAppDraft.trim()} onClick={() => addAutoSwitchApp()}>Add app</button><button className="icon-button" aria-label="Browse for an application" title="Browse for an application" disabled={busy} onClick={() => void browseAutoSwitchApp()}><FolderOpen size={15} /></button></div>{profile.autoSwitchApps.length ? <div className="auto-switch-app-list">{profile.autoSwitchApps.map((app) => <span className="auto-switch-app" key={app}>{app}<button className="icon-button" aria-label={`Remove ${app}`} disabled={busy} onClick={() => updateAutoSwitchApps(profile.autoSwitchApps.filter((item) => item !== app))}><Trash2 size={12} /></button></span>)}</div> : <p className="auto-switch-empty">No apps assigned to this profile yet.</p>}</div>
      </div>
    </section>
    <section className="deck-editor-layout">
      <div className="deck-canvas-column">
      <div className="deck-canvas-wrap">
        <div className="deck-canvas-heading"><div><h2>{profile.name} / {page.name}</h2><p>{page.rows === 0 ? 'Widgets fill the phone deck area' : `${page.buttons.length} buttons · ${occupied.size} of ${page.rows * page.columns} cells · Drag to move or resize`}</p></div><div className="heading-actions"><label className="grid-size-control">Rows<DeckSelect value={String(page.rows)} disabled={busy} options={[{ value: '0', label: page.buttons.length ? '0 · Move to widgets' : '0 · Off' }, ...Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))]} onChange={(value) => resizePage('rows', value)} /></label><label className="grid-size-control">Columns<DeckSelect value={String(page.columns)} disabled={busy} options={[{ value: '0', label: page.buttons.length ? '0 · Move to widgets' : '0 · Off' }, ...Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))]} onChange={(value) => resizePage('columns', value)} /></label>{selected && page.buttons.some((item) => item.id === selected.id) ? <button className="secondary-button" onClick={duplicateButton} disabled={busy || !firstButtonPlacement(page, buttonPlacement(page, selected).rowSpan, buttonPlacement(page, selected).columnSpan)}><Copy size={13} /> Duplicate</button> : null}<button className="secondary-button" onClick={() => addButton()} disabled={busy || (page.rows > 0 && !hasFreeCell)}><Plus size={14} /> Add button</button></div></div>
        {page.rows === 0 ? <div className="deck-grid-disabled"><PanelsTopLeft size={20} /><p>Button grid is off</p><span>The widget area will fill the available deck space on your phone.</span></div> : <div ref={canvasRef} className="deck-canvas" style={{ gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${page.rows}, minmax(100px, auto))` }}>{Array.from({ length: page.rows * page.columns }, (_, index) => {
          const row = Math.floor(index / page.columns);
          const column = index % page.columns;
          const button = occupied.get(index);
          if (button) {
            const placement = buttonPlacement(page, button);
            if (placement.row !== row || placement.column !== column) return null;
            const preview = resizePreview?.id === button.id ? resizePreview : null;
            const requestedPlacement = preview?.placement ?? placement;
            const shownPlacement = {
              ...requestedPlacement,
              rowSpan: Math.min(requestedPlacement.rowSpan, page.rows - placement.row),
              columnSpan: Math.min(requestedPlacement.columnSpan, page.columns - placement.column),
            };
            return <button
          key={button.id}
          type="button"
          data-deck-button={button.id}
          data-deck-item={button.id}
          data-deck-cell="true"
          data-surface="page"
          data-row={placement.row}
          data-column={placement.column}
          className={`deck-button ${selected?.id === button.id ? 'selected' : ''} ${dragOverButtonId === button.id ? 'drop-target' : ''} ${draggingButtonId === button.id ? 'dragging' : ''} ${preview && !preview.valid ? 'resize-invalid' : ''}`}
          style={{ gridColumn: `${placement.column + 1} / span ${shownPlacement.columnSpan}`, gridRow: `${placement.row + 1} / span ${shownPlacement.rowSpan}` }}
          onClick={() => { setWidgetId(''); setButtonId(button.id); }}
          onPointerDown={(event) => startButtonDrag(event, button.id, 'page')}
          onPointerMove={moveButtonDrag}
          onPointerUp={finishButtonDrag}
          onPointerCancel={cancelButtonDrag}
          onLostPointerCapture={cancelButtonDrag}
          onKeyDown={(event) => {
            if (!event.altKey && !event.shiftKey) return;
            const current = buttonPlacement(page, button);
            if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              moveButtonTo(button.id, current.row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0), current.column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0));
            } else if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              resizeButtonTo(button.id, { ...current, columnSpan: current.columnSpan + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0), rowSpan: current.rowSpan + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) });
            }
          }}
          title="Drag to move · Drag the lower-right corner to resize · Alt+Arrow to move · Shift+Arrow to resize"
          ><span>{iconForButton(button, playbackState)}</span><strong>{buttonLabel(button, playbackState)}</strong><span className="deck-button-size">{preview ? `${requestedPlacement.columnSpan}×${requestedPlacement.rowSpan}` : placement.rowSpan > 1 || placement.columnSpan > 1 ? `${placement.columnSpan}×${placement.rowSpan}` : null}</span><span className="deck-resize-handle" aria-hidden="true" onPointerDown={(event) => startResize(event, button, 'page')} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={cancelResize} onLostPointerCapture={cancelResize} /></button>;
          }
          return <button key={`empty-${index}`} type="button" data-deck-cell="true" data-surface="page" data-row={row} data-column={column} className={`deck-button deck-slot ${dragOverCellKey === `${row}:${column}` ? 'drop-target' : ''}`} onClick={() => addButton(row, column)} disabled={busy || !hasFreeCell} aria-label={`Add button in row ${row + 1}, column ${column + 1}`}><Plus size={17} /><span>Add button</span></button>;
        })}
        </div>}
      </div>
      <section className="deck-canvas-wrap widget-screen-editor">
        <div className="deck-canvas-heading">
          <div><h2>{page.name} / Widget area</h2><p>{widgetScreen.buttons.length + widgetScreen.widgets.length} items · {widgetOccupied.size} of {widgetScreen.rows * widgetScreen.columns} cells · Drag buttons here to move them</p></div>
          <div className="heading-actions">
            <label className="widget-screen-toggle"><input type="checkbox" checked={widgetArea.enabled} disabled={busy} onChange={(event) => updateWidgetScreen({ enabled: event.target.checked })} /> Show on phone</label>
            <label className="grid-size-control">Rows<DeckSelect value={String(widgetScreen.rows)} disabled={busy} options={Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(value) => resizeWidgetScreen('rows', value)} /></label>
            <label className="grid-size-control">Columns<DeckSelect value={String(widgetScreen.columns)} disabled={busy} options={Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(value) => resizeWidgetScreen('columns', value)} /></label>
            <button className="secondary-button" onClick={(event) => setAddMenu({ anchor: event.currentTarget.getBoundingClientRect() })} disabled={busy || !firstWidgetPlacement(widgetScreen)}><Plus size={14} /> Add widget</button>
          </div>
        </div>
        <div className="widget-page-toolbar">
          <div className="page-switcher">{widgetArea.pages.map((item) => <button key={item.id} className={`transport-tab ${item.id === widgetPage?.id ? 'selected' : ''}`} disabled={busy} onClick={() => selectWidgetPage(item.id)}>{item.name}</button>)}</div>
          <div className="heading-actions"><button className="secondary-button" onClick={addWidgetPage} disabled={busy || widgetArea.pages.length >= 9}><Plus size={14} /> Add widget page</button>{widgetArea.pages.length > 1 ? <button className="icon-button" aria-label="Delete empty widget page" title="Delete empty widget page" onClick={deleteWidgetPage} disabled={busy || widgetScreen.buttons.length + widgetScreen.widgets.length > 0}><Trash2 size={14} /></button> : null}</div>
        </div>
        <div ref={widgetCanvasRef} className="deck-canvas widget-canvas" style={{ gridTemplateColumns: `repeat(${widgetScreen.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${widgetScreen.rows}, minmax(100px, auto))` }}>
          {Array.from({ length: widgetScreen.rows * widgetScreen.columns }, (_, index) => {
            const row = Math.floor(index / widgetScreen.columns);
            const column = index % widgetScreen.columns;
            const item = widgetOccupied.get(index);
            if (item) {
              const placement = item.type === 'button' ? buttonPlacement({ id: 'widgets', name: 'Widgets', rows: widgetScreen.rows, columns: widgetScreen.columns, buttons: widgetScreen.buttons }, item.button) : item.widget.placement;
              if (placement.row !== row || placement.column !== column) return null;
              const itemId = item.type === 'button' ? item.button.id : item.widget.id;
              const preview = resizePreview?.id === itemId ? resizePreview : null;
              const shown = preview?.placement ?? placement;
              const previewRows = Math.min(shown.rowSpan, widgetScreen.rows - placement.row);
              const previewColumns = Math.min(shown.columnSpan, widgetScreen.columns - placement.column);
              const phoneGrid = phoneWidgetGrid(page.buttons.length > 0, widgetScreen, itemId, shown);
              return <button key={itemId} type="button" data-deck-item={itemId} data-deck-cell="true" data-surface="widgets" data-row={placement.row} data-column={placement.column} className={`deck-button ${item.type === 'widget' ? 'clock-widget' : ''} ${item.type === 'widget' && (item.widget.type === 'now_playing' || item.widget.type === 'lyrics' || item.widget.type === 'clock' || item.widget.type === 'pc_stats') ? 'now-playing-widget-preview' : ''} ${item.type === 'button' && selected?.id === itemId ? 'selected' : ''} ${item.type === 'widget' && selectedWidget?.id === itemId ? 'selected' : ''} ${dragOverButtonId === itemId ? 'drop-target' : ''} ${draggingButtonId === itemId ? 'dragging' : ''} ${preview && !preview.valid ? 'resize-invalid' : ''}`} style={{ gridColumn: `${placement.column + 1} / span ${Math.min(shown.columnSpan, widgetScreen.columns - placement.column)}`, gridRow: `${placement.row + 1} / span ${Math.min(shown.rowSpan, widgetScreen.rows - placement.row)}` }} onClick={() => item.type === 'button' ? (setWidgetId(''), setButtonId(item.button.id)) : (setButtonId(''), setWidgetId(item.widget.id))} onPointerDown={(event) => item.type === 'button' ? startButtonDrag(event, item.button.id, 'widgets') : startWidgetDrag(event, item.widget.id)} onPointerMove={moveButtonDrag} onPointerUp={finishButtonDrag} onPointerCancel={cancelButtonDrag} onLostPointerCapture={cancelButtonDrag}>
                {item.type === 'button' ? <><span>{iconForButton(item.button, playbackState)}</span><strong>{buttonLabel(item.button, playbackState)}</strong></> : item.widget.type === 'clock' ? (() => { const block = widgetBlockSize(widgetSurface ?? REFERENCE_WIDGET_SURFACE, phoneGrid.columns, phoneGrid.rows, previewColumns, previewRows); return <ClockFacePreview face={item.widget.face ?? 'digital'} color={item.widget.color} width={block.width} height={block.height} />; })() : item.widget.type === 'pc_stats' ? (() => { const block = widgetBlockSize(widgetSurface ?? REFERENCE_WIDGET_SURFACE, phoneGrid.columns, phoneGrid.rows, previewColumns, previewRows); return <PcStatsPreview style={item.widget.face ?? 'ring'} metric={item.widget.metric} color={item.widget.color} gpu={item.widget.gpu} width={block.width} height={block.height} columns={previewColumns} rows={previewRows} />; })() : item.widget.type === 'now_playing' ? <NowPlayingPreview media={mediaState} surface={widgetSurface ?? REFERENCE_WIDGET_SURFACE} columns={phoneGrid.columns} rows={phoneGrid.rows} columnSpan={previewColumns} rowSpan={previewRows} /> : item.widget.type === 'lyrics' ? <LyricsPreview media={mediaState} surface={widgetSurface ?? REFERENCE_WIDGET_SURFACE} columns={phoneGrid.columns} rows={phoneGrid.rows} columnSpan={previewColumns} rowSpan={previewRows} /> : item.widget.renderType === 'text' ? <><span className="clock-widget-icon"><Package size={18} /></span><strong>{item.widget.values.title || item.widget.widgetId}</strong><small>{item.widget.values.body || 'Text widget'}</small></> : <><span className="clock-widget-icon"><Package size={18} /></span><strong>Unavailable widget</strong><small>{item.widget.renderType}</small></>}
                <span className="deck-button-size">{preview ? `${shown.columnSpan}×${shown.rowSpan}` : placement.rowSpan > 1 || placement.columnSpan > 1 ? `${placement.columnSpan}×${placement.rowSpan}` : null}</span>
                <span className="deck-resize-handle" aria-hidden="true" onPointerDown={(event) => item.type === 'button' ? startResize(event, item.button, 'widgets', 'button') : startResize(event, item.widget, 'widgets', 'widget')} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={cancelResize} onLostPointerCapture={cancelResize} />
              </button>;
            }
            return <button key={`widget-empty-${index}`} type="button" data-deck-cell="true" data-surface="widgets" data-row={row} data-column={column} className={`deck-button deck-slot ${dragOverCellKey === `${row}:${column}` ? 'drop-target' : ''}`} onClick={(event) => setAddMenu({ anchor: event.currentTarget.getBoundingClientRect(), row, column })} disabled={busy || !firstWidgetPlacement(widgetScreen)} aria-label={`Add a widget in row ${row + 1}, column ${column + 1}`}><Plus size={17} /><span>Add widget</span></button>;
          })}
        </div>
      </section>
      </div>
      <div className="button-properties"><div className="properties-heading"><div><h2>{selectedWidget ? 'Widget settings' : 'Button settings'}</h2><p>{selectedWidget?.type === 'clock' ? 'Clock · shows the phone’s local time' : selectedWidget?.type === 'pc_stats' ? 'PC stats · live readings from this PC' : selectedWidget?.type === 'now_playing' ? 'Now Playing · system media from this PC' : selectedWidget?.type === 'lyrics' ? 'Lyrics · synced lyrics for what this PC is playing' : selectedWidget?.type === 'plugin' ? `${plugins.find((plugin) => plugin.id === selectedWidget.pluginId)?.name ?? 'Plugin'} · ${selectedWidgetDefinition?.name ?? selectedWidget.widgetId}` : selected ? 'Edit the selected control' : 'Select an item from either grid'}</p></div>{selected || selectedWidget ? <button className="icon-button" aria-label={selectedWidget ? 'Remove widget' : 'Remove button'} onClick={() => {
        if (selectedWidget) { deleteSelectedWidget(); return; }
        if (!selected) return;
        setButtonId('');
        if (page.buttons.some((item) => item.id === selected.id)) replacePage({ ...page, buttons: page.buttons.filter((item) => item.id !== selected.id) });
        else replaceWidgetScreen({ ...widgetScreen, buttons: widgetScreen.buttons.filter((item) => item.id !== selected.id) });
      }}><Trash2 size={15} /></button> : null}</div>
        {selected && !selectedWidget ? <button className="secondary-button widget-transfer-button" onClick={moveSelectedButtonToOtherSurface} disabled={busy}>{page.buttons.some((button) => button.id === selected.id) ? 'Move to widget area' : 'Move to button grid'}</button> : null}
        {selectedWidget?.type === 'clock' ? <ClockWidgetSettings key={selectedWidget.id} face={selectedWidget.face} color={selectedWidget.color} busy={busy} block={(() => { const grid = phoneWidgetGrid(page.buttons.length > 0, widgetScreen, selectedWidget.id, selectedWidget.placement); return widgetBlockSize(widgetSurface ?? REFERENCE_WIDGET_SURFACE, grid.columns, grid.rows, selectedWidget.placement.columnSpan, selectedWidget.placement.rowSpan); })()} onChange={updateSelectedClockWidget} /> : selectedWidget?.type === 'pc_stats' ? <PcStatsSettings key={selectedWidget.id} style={selectedWidget.face} metric={selectedWidget.metric} color={selectedWidget.color} gpu={selectedWidget.gpu} busy={busy} columns={selectedWidget.placement.columnSpan} rows={selectedWidget.placement.rowSpan} block={(() => { const grid = phoneWidgetGrid(page.buttons.length > 0, widgetScreen, selectedWidget.id, selectedWidget.placement); return widgetBlockSize(widgetSurface ?? REFERENCE_WIDGET_SURFACE, grid.columns, grid.rows, selectedWidget.placement.columnSpan, selectedWidget.placement.rowSpan); })()} onChange={updateSelectedPcStatsWidget} /> : selectedWidget?.type === 'now_playing' ? <div className="widget-properties"><Music size={22} /><strong>Now Playing</strong><span>Shows the active media session, artwork and playback progress from this PC.</span></div> : selectedWidget?.type === 'lyrics' ? <div className="widget-properties"><MicVocal size={22} /><strong>Lyrics</strong><span>Shows time-synced lyrics from LRCLIB for the song playing on this PC. Videos and tracks LRCLIB doesn’t know show “No lyrics found”. Each phone fetches lyrics over its own internet connection.</span></div> : selectedWidget?.type === 'plugin' ? <PluginWidgetProperties widget={selectedWidget} definition={selectedWidgetDefinition} busy={busy} onChange={updateSelectedPluginWidgetValue} /> : selected ? <ButtonProperties key={selected.id} button={selected} busy={busy} isMacos={isMacos} profiles={deck.profiles} pages={profile.pages} plugins={plugins} onChange={updateButton} /> : <div className="properties-empty">Select an item from either grid.</div>}
        {selected || selectedWidget ? <button className="primary-button save-button" onClick={() => void save(deck)} disabled={busy}><Save size={14} /> {busy ? 'Saving…' : 'Save deck'}</button> : null}
      </div>
      {addMenu ? <AddWidgetMenu anchor={addMenu.anchor} plugins={pluginWidgetOptions.map((option) => ({ pluginId: option.plugin.id, widgetId: option.widget.id, label: option.label }))} onPick={(choice) => addWidget(choice, addMenu.row, addMenu.column)} onClose={() => setAddMenu(null)} /> : null}
    </section>
  </>;
}

function PluginWidgetProperties({ widget, definition, busy, onChange }: {
  widget: Extract<DeckWidget, { type: 'plugin' }>;
  definition: FreezePluginWidget | null;
  busy: boolean;
  onChange: (inputId: string, value: string) => void;
}) {
  if (!definition) return <div className="widget-properties"><Package size={22} /><strong>Plugin widget unavailable</strong><span>The plugin or widget definition is not installed. Its saved preview can still be shown on the phone.</span></div>;
  return <div className="property-fields plugin-widget-fields">
    <div className="widget-properties plugin-widget-summary"><Package size={22} /><strong>{definition.name}</strong>{definition.description ? <span>{definition.description}</span> : null}</div>
    {definition.inputs.map((input) => {
      const value = widget.values[input.id] ?? input.default;
      return <label key={input.id}>{input.label}{input.type === 'select'
        ? <DeckSelect value={value} disabled={busy} options={input.options.map((option, index) => ({ value: option, label: input.optionLabels?.[index] || option }))} onChange={(next) => onChange(input.id, next)} />
        : <input type={input.type === 'number' ? 'number' : 'text'} value={value} disabled={busy} onChange={(event) => onChange(input.id, event.target.value)} />}</label>;
    })}
  </div>;
}

function buttonLabel(button: DeckButton, playback: PlaybackState) {
  return button.action.type === 'media' && button.action.command === 'play_pause' && button.icon === 'auto'
    ? playback === 'playing' ? 'Pause' : 'Play'
    : button.label;
}

function iconForButton(button: DeckButton, playback: PlaybackState) {
  if (button.appIconData) return <img className="deck-button-app-icon" src={button.appIconData} alt="" />;
  if (button.iconSvg && button.icon !== 'auto') return <img className="deck-button-svg-icon" src={`data:image/svg+xml,${encodeURIComponent(button.iconSvg)}`} alt="" />;
  const aliases: Record<string, typeof Command> = { command: Command, monitor: Monitor, music: Music, mic: Mic, headphones: Headphones, 'app-window': AppWindow };
  const Icon = button.icon === 'auto' ? autoIcon(button.action, playback) : aliases[button.icon] ?? Command;
  return <Icon size={18} />;
}

function autoIcon(action: DeckAction, playback: PlaybackState) {
  if (action.type === 'media') return ({ play_pause: playback === 'playing' ? Pause : Play, next_track: SkipForward, previous_track: SkipBack, volume_up: Volume2, volume_down: Volume1, mute: VolumeX } as const)[action.command];
  if (action.type === 'launch_app') return AppWindow;
  if (action.type === 'launch_file') return File;
  if (action.type === 'launch_folder') return FolderOpen;
  if (action.type === 'plugin_action') return Package;
  if (action.type === 'run_script') return File;
  if (action.type === 'sequence') return ListOrdered;
  if (action.type === 'select_profile') return Layers2;
  if (action.type === 'select_page') return PanelsTopLeft;
  return Keyboard;
}

function DeckSelect({ value, options, onChange, disabled = false }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  function openMenu() {
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) openMenu();
      else setActiveIndex((index) => (index + step + options.length) % options.length);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
    } else if (open && event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (open && event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    }
  }

  return <div className="deck-select" ref={root}>
    <button type="button" className={`select-trigger ${open ? 'open' : ''}`} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : openMenu()} onKeyDown={handleKeyDown}>
      <span>{options[selectedIndex]?.label ?? value}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open ? <div className="select-menu" id={`${id}-options`} role="listbox" aria-label="Options">
      {options.map((option, index) => <div id={`${id}-option-${index}`} role="option" aria-selected={index === selectedIndex} key={option.value} className={`select-option ${index === activeIndex ? 'active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{index === selectedIndex ? <Check size={15} aria-hidden="true" /> : null}
      </div>)}
    </div> : null}
  </div>;
}

// The picked icon as standalone SVG markup at 24 px in the deck's light ink. The picker button has
// already drawn it, so copy that instead of rendering it again (which needed react-dom/server).
function iconMarkup(button: HTMLElement) {
  const svg = button.querySelector('svg')!.cloneNode(true) as SVGSVGElement;
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('stroke', '#f4f4f5');
  svg.setAttribute('stroke-width', '2');
  return svg.outerHTML;
}

function IconPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (name: string, svg?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(72);
  const [registry, setRegistry] = useState<LucideRegistry | null>(null);
  const [loading, setLoading] = useState(false);
  const matches = useMemo(() => Object.keys(registry ?? {}).filter((name) => name.toLowerCase().includes(query.trim().toLowerCase())), [query, registry]);
  const visible = matches.slice(0, limit);
  const SelectedIcon = value === 'auto' ? Zap : registry?.[value as keyof LucideRegistry] ?? Command;
  async function togglePicker() {
    if (open) { setOpen(false); return; }
    if (!registry) {
      setLoading(true);
      try { const module = await import('lucide-react/dist/esm/icons/index.mjs'); setRegistry(module as unknown as LucideRegistry); }
      finally { setLoading(false); }
    }
    setOpen(true);
  }
  return <div className="icon-picker">
    <button type="button" className="icon-picker-trigger" disabled={disabled || loading} onClick={() => void togglePicker()}><SelectedIcon size={17} /><span>{loading ? 'Loading icons…' : value === 'auto' ? 'Automatic by action' : value}</span><ChevronDown size={15} /></button>
    {open ? <div className="icon-picker-popover">
      <input autoFocus value={query} placeholder={`Search ${Object.keys(registry ?? {}).length} Lucide icons…`} onChange={(event) => { setQuery(event.target.value); setLimit(72); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} />
      <button type="button" className={`icon-picker-auto ${value === 'auto' ? 'selected' : ''}`} onClick={() => { onChange('auto'); setOpen(false); }}><Zap size={16} /> Automatic by action</button>
      <div className="icon-picker-grid">{visible.map((name) => {
        const Icon = registry![name as keyof LucideRegistry];
        return <button type="button" key={name} className={`icon-picker-option ${name === value ? 'selected' : ''}`} title={name} aria-label={name} onClick={(event) => { onChange(name, iconMarkup(event.currentTarget)); setOpen(false); }}><Icon size={17} /><span>{name}</span></button>;
      })}</div>
      {matches.length > visible.length ? <button type="button" className="icon-picker-more" onClick={() => setLimit((current) => current + 72)}>Show more ({matches.length - visible.length} remaining)</button> : null}
    </div> : null}
  </div>;
}

function ButtonProperties({ button, busy, isMacos, profiles, pages, plugins, onChange }: { button: DeckButton; busy: boolean; isMacos: boolean; profiles: DeckProfile[]; pages: DeckPage[]; plugins: FreezePlugin[]; onChange: (patch: Partial<DeckButton>) => void }) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const action = button.action;
  const kind = action.type === 'plugin_action' ? `plugin:${action.pluginId}:${action.actionId}` : action.type === 'sequence' ? 'sequence' : action.type;
  const keys = action.type === 'hotkey' ? action.keys.join('+') : '';
  const app = action.type === 'launch_app' ? action.app : '';
  const filePath = action.type === 'launch_file' ? action.path : '';
  const folderPath = action.type === 'launch_folder' ? action.path : '';
  const scriptPath = action.type === 'run_script' ? action.path : '';
  const media = action.type === 'media' ? action.command : 'play_pause';
  const pluginAction = action.type === 'plugin_action' ? plugins.find((plugin) => plugin.id === action.pluginId)?.actions.find((item) => item.id === action.actionId) : undefined;
  const [iconError, setIconError] = useState('');
  const [extractingIcon, setExtractingIcon] = useState(false);
  const [extractingThumbnail, setExtractingThumbnail] = useState(false);
  const thumbnailRequestRef = useRef(0);
  function setAppTarget(app: string) {
    if (action.type !== 'launch_app') return;
    onChange({ action: { ...action, app }, ...(button.icon === 'app-icon' ? { icon: 'auto', iconSvg: undefined } : {}), appIconData: undefined });
    setIconError('');
  }
  async function extractIcon(useShortcutIcon: boolean) {
    setExtractingIcon(true);
    setIconError('');
    try {
      const data = await invoke<string>('extract_app_icon', { app, useShortcutIcon });
      onChange({ icon: 'app-icon', iconSvg: undefined, appIconData: data });
    } catch (error) {
      setIconError(String(error));
    } finally {
      setExtractingIcon(false);
    }
  }
  async function browseApp() {
    try {
      const path = await openFileDialog({
        title: 'Choose an application',
        multiple: false,
        directory: false,
        filters: [isMacos ? { name: 'Applications', extensions: ['app'] } : { name: 'Applications and shortcuts', extensions: ['exe', 'lnk'] }],
      });
      if (typeof path === 'string') setAppTarget(path);
    } catch (error) {
      setIconError(`Could not open the application picker: ${String(error)}`);
    }
  }
  async function browseScript() {
    try {
      const path = await openFileDialog({
        title: 'Choose a local script', multiple: false, directory: false,
        filters: [isMacos ? { name: 'Scripts', extensions: ['sh', 'py'] } : { name: 'Scripts', extensions: ['ps1', 'py'] }],
      });
      if (typeof path === 'string') onChange({ action: { type: 'run_script', path, allowOnPc: action.type === 'run_script' && action.allowOnPc } });
    } catch (error) { setIconError(`Could not open the script picker: ${String(error)}`); }
  }
  function setFileTarget(path: string) {
    if (action.type !== 'launch_file') return;
    thumbnailRequestRef.current += 1;
    setExtractingThumbnail(false);
    onChange({ action: { ...action, path }, ...(button.icon === 'app-icon' ? { icon: 'auto', iconSvg: undefined } : {}), appIconData: undefined });
    setIconError('');
  }
  function setFolderTarget(path: string) {
    if (action.type !== 'launch_folder') return;
    thumbnailRequestRef.current += 1;
    setExtractingThumbnail(false);
    onChange({ action: { ...action, path }, ...(button.icon === 'app-icon' ? { icon: 'auto', iconSvg: undefined } : {}), appIconData: undefined });
    setIconError('');
  }
  async function extractFileThumbnail(path: string) {
    if (!path.trim()) return;
    const request = ++thumbnailRequestRef.current;
    setExtractingThumbnail(true);
    setIconError('');
    try {
      const data = await invoke<string>('extract_file_thumbnail', { path });
      if (request === thumbnailRequestRef.current) onChangeRef.current({ icon: 'app-icon', iconSvg: undefined, appIconData: data });
    } catch (error) {
      if (request === thumbnailRequestRef.current) setIconError(String(error));
    } finally {
      if (request === thumbnailRequestRef.current) setExtractingThumbnail(false);
    }
  }
  async function browseFileOrFolder(directory: boolean) {
    try {
      const path = await openFileDialog({ title: directory ? 'Choose a folder' : 'Choose a file', multiple: false, directory });
      if (typeof path === 'string') {
        if (directory) setFolderTarget(path);
        else setFileTarget(path);
        void extractFileThumbnail(path);
      }
    } catch (error) {
      setIconError(`Could not open the picker: ${String(error)}`);
    }
  }
  const isWindowsShortcut = !isMacos && app.toLowerCase().endsWith('.lnk');
  const actionOptions = [['media', 'Media'], ['hotkey', 'Keyboard shortcut'], ['launch_app', 'Launch app'], ['launch_file', 'Launch file'], ['launch_folder', 'Launch folder'], ['run_script', 'Run local script'], ['sequence', 'Sequence'], ['select_profile', 'Select profile'], ['select_page', 'Select page']].map(([value, label]) => ({ value, label }));
  actionOptions.push(...plugins.flatMap((plugin) => plugin.actions.map((pluginAction) => ({ value: `plugin:${plugin.id}:${pluginAction.id}`, label: `${plugin.name} / ${pluginAction.name}` }))));
  const setKind = (value: string) => {
    thumbnailRequestRef.current += 1;
    setExtractingThumbnail(false);
    const pluginTarget = value.startsWith('plugin:') ? value.slice(7).split(':') : [];
    const selectedPluginAction = pluginTarget.length === 2 ? plugins.find((plugin) => plugin.id === pluginTarget[0])?.actions.find((item) => item.id === pluginTarget[1]) : undefined;
    const next: DeckAction = pluginTarget.length === 2 ? { type: 'plugin_action', pluginId: pluginTarget[0], actionId: pluginTarget[1], allowOnPc: false, inputs: Object.fromEntries((selectedPluginAction?.inputs ?? []).map((input) => [input.id, input.default || (input.type === 'select' ? input.options[0] ?? '' : '')])) } : value === 'media' ? { type: 'media', command: 'play_pause' } : value === 'launch_app' ? { type: 'launch_app', app: '' } : value === 'launch_file' ? { type: 'launch_file', path: '' } : value === 'launch_folder' ? { type: 'launch_folder', path: '' } : value === 'run_script' ? { type: 'run_script', path: '', allowOnPc: false } : value === 'sequence' ? { type: 'sequence', steps: [{ type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] }, { type: 'hotkey', keys: ['CTRL', 'S'] }] } : value === 'select_profile' ? { type: 'select_profile', profileId: profiles[0]?.id ?? '' } : value === 'select_page' ? { type: 'select_page', pageId: pages[0]?.id ?? '' } : { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] };
    onChange({ action: next, ...(value === 'launch_app' ? {} : { icon: 'auto', iconSvg: undefined, appIconData: undefined }) });
  };
  return <div className="property-fields">
    <label>Button label<input value={button.label} onChange={(event) => onChange({ label: event.target.value })} maxLength={24} disabled={busy} /></label>
    <label>Icon<IconPicker value={button.icon} disabled={busy} onChange={(name, svg) => { thumbnailRequestRef.current += 1; setExtractingThumbnail(false); onChange({ icon: name, iconSvg: svg, appIconData: undefined }); }} /></label>
    <label>Action<DeckSelect value={kind} onChange={setKind} disabled={busy} options={actionOptions} /></label>
    {action.type === 'plugin_action' ? <><label className="plugin-action-info">Plugin action<span>{pluginAction?.description || 'Runs the local script defined by this Freeze plugin.'}</span></label>{pluginAction?.inputs.map((input) => <label key={input.id}>{input.label}{input.type === 'select' ? <DeckSelect value={action.inputs?.[input.id] ?? input.default ?? input.options[0] ?? ''} disabled={busy} options={input.options.map((option, index) => ({ value: option, label: input.optionLabels?.[index] || option }))} onChange={(value) => onChange({ action: { ...action, inputs: { ...action.inputs, [input.id]: value } } })} /> : <input type={input.type} value={action.inputs?.[input.id] ?? input.default} onChange={(event) => onChange({ action: { ...action, inputs: { ...action.inputs, [input.id]: event.target.value } } })} disabled={busy} maxLength={512} />}</label>)}<label className="script-permission"><input type="checkbox" checked={action.allowOnPc} disabled={busy} onChange={(event) => onChange({ action: { ...action, allowOnPc: event.target.checked } })} /><span>Allow this plugin action to run on this PC from a paired phone</span></label></> : null}
    {kind === 'run_script' && action.type === 'run_script' ? <><label>Local script<div className="app-path-picker"><input value={scriptPath} onChange={(event) => onChange({ action: { ...action, path: event.target.value } })} placeholder={isMacos ? 'Choose a .sh or .py script' : 'Choose a .ps1 or .py script'} disabled={busy} /><button type="button" className="app-browse-button" aria-label="Browse for a local script" title="Browse for a local script" disabled={busy} onClick={() => void browseScript()}><File size={15} /></button></div></label><label className="script-permission"><input type="checkbox" checked={action.allowOnPc} disabled={busy || !scriptPath.trim()} onChange={(event) => onChange({ action: { ...action, allowOnPc: event.target.checked } })} /><span>Allow this script to run on this PC when activated from a paired phone</span></label><small>Scripts run as your Windows or macOS user. Freeze follows the operating system’s script policy.</small>{iconError ? <small className="form-error">{iconError}</small> : null}</> : null}
    {kind === 'media' ? <label>Media command<DeckSelect value={media} onChange={(value) => onChange({ action: { type: 'media', command: value as MediaCommand } })} disabled={busy} options={[['play_pause', 'Play / Pause'], ['next_track', 'Next track'], ['previous_track', 'Previous track'], ['volume_up', 'Volume up'], ['volume_down', 'Volume down'], ['mute', 'Mute']].map(([value, label]) => ({ value, label }))} /></label> : null}
    {kind === 'hotkey' ? <label>Keys<input value={keys} onChange={(event) => onChange({ action: { type: 'hotkey', keys: event.target.value.toUpperCase().split('+').map((key) => key.trim()).filter(Boolean) } })} placeholder="CTRL+SHIFT+M" disabled={busy} /></label> : null}
    {kind === 'launch_app' && action.type === 'launch_app' ? <><label>App path or name<div className="app-path-picker"><input value={app} onChange={(event) => setAppTarget(event.target.value)} placeholder="Application, shortcut, or app name" disabled={busy} /><button type="button" className="app-browse-button" aria-label="Browse for an application" title="Browse for an application" disabled={busy} onClick={() => void browseApp()}><FolderOpen size={15} /></button></div></label><button type="button" className="secondary-button app-icon-button" disabled={busy || extractingIcon || !app.trim()} onClick={() => void extractIcon(true)}>{extractingIcon ? 'Reading icon…' : button.appIconData ? isWindowsShortcut ? 'Refresh shortcut icon' : 'Refresh app icon' : isWindowsShortcut ? 'Use shortcut icon' : 'Use original app icon'}</button>{isWindowsShortcut && button.appIconData ? <button type="button" className="secondary-button app-icon-button" disabled={busy || extractingIcon} onClick={() => void extractIcon(false)}>Reset to app icon</button> : null}{iconError ? <small className="form-error">{iconError}</small> : null}</> : null}
    {kind === 'launch_file' && action.type === 'launch_file' ? <><label>File path<div className="app-path-picker"><input value={filePath} onChange={(event) => setFileTarget(event.target.value)} placeholder="Choose a file" disabled={busy} /><button type="button" className="app-browse-button" aria-label="Browse for a file" title="Browse for a file" disabled={busy} onClick={() => void browseFileOrFolder(false)}><File size={15} /></button></div></label><button type="button" className="secondary-button app-icon-button" disabled={busy || extractingThumbnail || !filePath.trim()} onClick={() => void extractFileThumbnail(filePath)}>{extractingThumbnail ? 'Reading thumbnail…' : button.appIconData ? 'Refresh thumbnail' : 'Use file thumbnail'}</button>{iconError ? <small className="form-error">{iconError}</small> : null}</> : null}
    {kind === 'launch_folder' && action.type === 'launch_folder' ? <><label>Folder path<div className="app-path-picker"><input value={folderPath} onChange={(event) => setFolderTarget(event.target.value)} placeholder="Choose a folder" disabled={busy} /><button type="button" className="app-browse-button" aria-label="Browse for a folder" title="Browse for a folder" disabled={busy} onClick={() => void browseFileOrFolder(true)}><FolderOpen size={15} /></button></div></label><button type="button" className="secondary-button app-icon-button" disabled={busy || extractingThumbnail || !folderPath.trim()} onClick={() => void extractFileThumbnail(folderPath)}>{extractingThumbnail ? 'Reading icon…' : button.appIconData ? 'Refresh folder icon' : 'Use folder icon'}</button>{iconError ? <small className="form-error">{iconError}</small> : null}</> : null}
    {kind === 'sequence' && action.type === 'sequence' ? <SequenceEditor steps={action.steps} disabled={busy} isMacos={isMacos} onChange={(steps) => onChange({ action: { type: 'sequence', steps } })} /> : null}
    {kind === 'select_profile' && action.type === 'select_profile' ? <label>Profile<DeckSelect value={action.profileId} options={profiles.map((item) => ({ value: item.id, label: item.name }))} onChange={(profileId) => onChange({ action: { type: 'select_profile', profileId } })} disabled={busy} /></label> : null}
    {kind === 'select_page' && action.type === 'select_page' ? <label>Page<DeckSelect value={action.pageId} options={pages.map((item) => ({ value: item.id, label: item.name }))} onChange={(pageId) => onChange({ action: { type: 'select_page', pageId } })} disabled={busy} /></label> : null}
  </div>;
}

function SequenceEditor({ steps, disabled, isMacos, onChange }: { steps: DeckStep[]; disabled: boolean; isMacos: boolean; onChange: (steps: DeckStep[]) => void }) {
  const [draft, setDraft] = useState(steps);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(steps); setError(''); }, [steps]);

  function commit(next: DeckStep[]) {
    if (next.length < 1 || next.length > 10) return;
    setDraft(next);
    setError('');
    onChange(next);
  }

  function changeStep(index: number, step: DeckStep) {
    const next = [...draft];
    next[index] = step;
    commit(next);
  }

  function moveStep(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= draft.length) return;
    const next = [...draft];
    [next[index], next[destination]] = [next[destination], next[index]];
    commit(next);
  }

  async function browseApp(index: number) {
    try {
      const path = await openFileDialog({
        title: 'Choose an application for this step',
        multiple: false,
        directory: false,
        filters: [isMacos ? { name: 'Applications', extensions: ['app'] } : { name: 'Applications and shortcuts', extensions: ['exe', 'lnk'] }],
      });
      if (typeof path === 'string') changeStep(index, { type: 'launch_app', app: path });
    } catch (cause) {
      setError(`Could not open the application picker: ${String(cause)}`);
    }
  }

  async function browseFileOrFolder(index: number, directory: boolean) {
    try {
      const path = await openFileDialog({ title: directory ? 'Choose a folder for this step' : 'Choose a file for this step', multiple: false, directory });
      if (typeof path === 'string') changeStep(index, directory ? { type: 'launch_folder', path } : { type: 'launch_file', path });
    } catch (cause) {
      setError(`Could not open the picker: ${String(cause)}`);
    }
  }

  return <div className="sequence-editor">
    <div className="sequence-heading"><strong>Sequence steps</strong><span>Runs in order on this PC · {draft.length}/10</span></div>
    {draft.map((step, index) => <section className="sequence-step" key={index} aria-label={`Sequence step ${index + 1}`}>
      <div className="sequence-step-heading">
        <span className="sequence-step-number">{index + 1}</span>
        <div className="sequence-step-type"><DeckSelect value={step.type} disabled={disabled} options={[['hotkey', 'Keyboard shortcut'], ['media', 'Media command'], ['launch_app', 'Launch app'], ['launch_file', 'Launch file'], ['launch_folder', 'Launch folder']].map(([value, label]) => ({ value, label }))} onChange={(value) => changeStep(index, value === 'media' ? { type: 'media', command: 'play_pause' } : value === 'launch_app' ? { type: 'launch_app', app: '' } : value === 'launch_file' ? { type: 'launch_file', path: '' } : value === 'launch_folder' ? { type: 'launch_folder', path: '' } : { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] })} /></div>
        <button type="button" className="sequence-order-button" aria-label={`Move step ${index + 1} up`} title="Move up" disabled={disabled || index === 0} onClick={() => moveStep(index, -1)}><ChevronUp size={14} /></button>
        <button type="button" className="sequence-order-button" aria-label={`Move step ${index + 1} down`} title="Move down" disabled={disabled || index === draft.length - 1} onClick={() => moveStep(index, 1)}><ChevronDown size={14} /></button>
        <button type="button" className="sequence-order-button sequence-remove-button" aria-label={`Remove step ${index + 1}`} title="Remove step" disabled={disabled || draft.length === 1} onClick={() => commit(draft.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
      </div>
      {step.type === 'hotkey' ? <label>Shortcut<input value={step.keys.join('+')} disabled={disabled} placeholder="CTRL+SHIFT+M" onChange={(event) => {
        const next = [...draft];
        next[index] = { type: 'hotkey', keys: event.target.value.toUpperCase().split('+').map((key) => key.trim()) };
        setDraft(next);
      }} onBlur={() => {
        const keys = parseShortcut(step.keys.join('+'));
        if (!keys) setError(`Step ${index + 1}: enter a valid shortcut such as CTRL+SHIFT+M.`);
        else changeStep(index, { type: 'hotkey', keys });
      }} /></label> : null}
      {step.type === 'media' ? <label>Command<DeckSelect value={step.command} disabled={disabled} options={[
        ['play_pause', 'Play / Pause'], ['next_track', 'Next track'], ['previous_track', 'Previous track'], ['volume_up', 'Volume up'], ['volume_down', 'Volume down'], ['mute', 'Mute'],
      ].map(([value, label]) => ({ value, label }))} onChange={(value) => changeStep(index, { type: 'media', command: value as MediaCommand })} /></label> : null}
      {step.type === 'launch_app' ? <label>Application<div className="app-path-picker"><input value={step.app} disabled={disabled} placeholder="Application path or name" onChange={(event) => {
        const next = [...draft];
        next[index] = { type: 'launch_app', app: event.target.value };
        setDraft(next);
      }} onBlur={() => changeStep(index, step)} /><button type="button" className="app-browse-button" aria-label={`Browse for application in step ${index + 1}`} title="Browse for an application" disabled={disabled} onClick={() => void browseApp(index)}><FolderOpen size={15} /></button></div></label> : null}
      {step.type === 'launch_file' || step.type === 'launch_folder' ? <label>{step.type === 'launch_file' ? 'File' : 'Folder'}<div className="app-path-picker"><input value={step.path} disabled={disabled} placeholder={`${step.type === 'launch_file' ? 'File' : 'Folder'} path`} onChange={(event) => {
        const next = [...draft];
        next[index] = { type: step.type, path: event.target.value };
        setDraft(next);
      }} onBlur={() => changeStep(index, step)} /><button type="button" className="app-browse-button" aria-label={`Browse for ${step.type === 'launch_file' ? 'file' : 'folder'} in step ${index + 1}`} title={`Browse for a ${step.type === 'launch_file' ? 'file' : 'folder'}`} disabled={disabled} onClick={() => void browseFileOrFolder(index, step.type === 'launch_folder')}>{step.type === 'launch_file' ? <File size={15} /> : <FolderOpen size={15} />}</button></div></label> : null}
    </section>)}
    {draft.length < 10 ? <button type="button" className="secondary-button sequence-add-button" disabled={disabled} onClick={() => commit([...draft, { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] }])}><Plus size={14} /> Add step</button> : null}
    {error ? <small className="form-error">{error}</small> : null}
  </div>;
}

function parseShortcut(value: string): string[] | null {
  if (!value.trim()) return null;
  const modifiers = new Set(['CTRL', 'ALT', 'SHIFT', 'META']);
  const special = new Set(['SPACE', 'ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE', 'HOME', 'END', 'PAGE_UP', 'PAGE_DOWN', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
  const keys = value.toUpperCase().replace(/ /g, '').split('+');
  if (keys.length < 2 || keys.length > 5 || keys.some((key) => !key) || keys.slice(0, -1).some((key) => !modifiers.has(key)) || new Set(keys.slice(0, -1)).size !== keys.length - 1) return null;
  const last = keys[keys.length - 1];
  if (!/^[A-Z0-9]$/.test(last) && !special.has(last) && !/^F([1-9]|1[0-2])$/.test(last)) return null;
  return keys;
}

export default App;
