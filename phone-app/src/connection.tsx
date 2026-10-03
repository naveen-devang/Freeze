import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { loadDeckPages } from './deck';
import { validDeckPageLayout, validDeckWidgetAreaLayout } from './deck-layout';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { WidgetSurface } from './now-playing-layout';

export type PcConnection = { host: string; port: number; token: string; deviceName?: string; transport?: 'wifi' | 'usb' };
export type DeckMediaCommand = 'play_pause' | 'next_track' | 'previous_track' | 'volume_up' | 'volume_down' | 'mute';
export type DeckStep = { type: 'media'; command: DeckMediaCommand } | { type: 'hotkey'; keys: string[] } | { type: 'launch_app'; app: string } | { type: 'launch_file'; path: string } | { type: 'launch_folder'; path: string };
export type DeckAction = DeckStep | { type: 'run_script'; path: string; allowOnPc: boolean } | { type: 'plugin_action'; pluginId: string; actionId: string; allowOnPc: boolean; inputs?: Record<string, string> } | { type: 'sequence'; steps: DeckStep[] } | { type: 'select_profile'; profileId: string } | { type: 'select_page'; pageId: string };
export type DeckPlacement = { row: number; column: number; rowSpan: number; columnSpan: number };
export type DeckButton = { id: string; label: string; icon: string; placement?: DeckPlacement; iconSvg?: string; appIconData?: string; action: DeckAction };
export type DeckWidget = { id: string; type: 'clock'; placement: DeckPlacement } | { id: string; type: 'now_playing'; placement: DeckPlacement } | { id: string; type: 'plugin'; pluginId: string; widgetId: string; renderType: string; values: Record<string, string>; placement: DeckPlacement };
export type DeckWidgetPage = { id: string; name: string; buttons: DeckButton[]; widgets: DeckWidget[] };
export type DeckWidgetArea = { enabled: boolean; rows: number; columns: number; pages: DeckWidgetPage[] };
export type DeckPage = { id: string; name: string; rows?: number; columns?: number; buttons: DeckButton[]; widgetArea?: DeckWidgetArea };
export type DeckProfile = { id: string; name: string; pages: DeckPage[]; activePageId: string };
export type DeckConfig = { schemaVersion: number; revision: number; profiles: DeckProfile[]; activeProfileId: string };
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'unavailable';
export type SystemMediaState = { sourceAppId?: string; title?: string; artist?: string; album?: string; playbackState: PlaybackState; positionMs?: number; durationMs?: number; artworkDataUrl?: string; volumePercent?: number };
export type ActionError = 'accessibility_permission_required' | 'app_launch_failed' | 'stale_revision' | 'unknown_button' | 'control_failed';

type ConnectionContextValue = {
  connection: PcConnection | null;
  pairedDevices: PcConnection[];
  status: ConnectionStatus;
  protocolError: string | null;
  playbackState: PlaybackState;
  mediaState: SystemMediaState;
  deckConfig: DeckConfig | null;
  independentNavigation: boolean;
  selectedProfileId: string | null;
  selectedPageId: string | null;
  actionError: ActionError | null;
  connect: (connection: PcConnection) => Promise<void>;
  disconnect: () => Promise<void>;
  removePairedDevice: (id: string) => Promise<void>;
  sendButton: (buttonId: string) => boolean;
  sendMediaCommand: (command: DeckMediaCommand) => boolean;
  sendSystemVolume: (volumePercent: number) => boolean;
  selectProfile: (profileId: string) => boolean;
  selectPage: (pageId: string) => boolean;
  reportWidgetSurface: (surface: WidgetSurface) => void;
};

const STORAGE_KEY = 'freeze.pc-connection';
const PAIRED_KEY = 'freeze.pc-connections';
const LEGACY_STORAGE_KEY = 'decklink.pc-connection';
const MAX_RECONNECT_ATTEMPTS = 3;
const DECK_CACHE_KEY = 'freeze.deck-snapshot';
const DEVICE_SELECTION_KEY = 'freeze.device-navigation';
const LEGACY_SOURCE_KEY = 'freeze.legacy-import-source';
const LEGACY_IMPORTED_KEY = 'freeze.legacy-imported';
const ConnectionContext = createContext<ConnectionContextValue | null>(null);
const EMPTY_MEDIA_STATE: SystemMediaState = { playbackState: 'unavailable' };

export function connectionId(connection: PcConnection) {
  return `${connection.host.toLowerCase()}:${connection.port}`;
}

async function legacyDeckForPairing(connection: PcConnection) {
  if (await SecureStore.getItemAsync(`${LEGACY_IMPORTED_KEY}.${connectionId(connection)}`)) return null;
  const pages = await loadDeckPages();
  if (!pages.some((page) => page.shortcuts.length > 0)) return null;
  let sourceId = await SecureStore.getItemAsync(LEGACY_SOURCE_KEY);
  if (!sourceId) {
    sourceId = `phone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await SecureStore.setItemAsync(LEGACY_SOURCE_KEY, sourceId);
  }
  return { sourceId, pages };
}

function websocketUrl(connection: PcConnection) {
  const address = connection.transport === 'usb' ? '127.0.0.1' : connection.host;
  const formattedHost = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
  return `ws://${formattedHost}:${connection.port}/ws`;
}

function validDeckButton(value: unknown): value is DeckButton {
  if (!value || typeof value !== 'object') return false;
  const button = value as Partial<DeckButton>;
  const placement = button.placement;
  return typeof button.id === 'string' && typeof button.label === 'string' && typeof button.icon === 'string' &&
    (placement === undefined || (placement !== null && typeof placement === 'object' && Number.isInteger(placement.row) && Number.isInteger(placement.column) && Number.isInteger(placement.rowSpan) && Number.isInteger(placement.columnSpan))) &&
    (!button.iconSvg || (typeof button.iconSvg === 'string' && button.iconSvg.length <= 8192 && button.iconSvg.startsWith('<svg') && button.iconSvg.endsWith('</svg>') && !/<script|<foreignobject|onload=|onclick=|href=|url\(/i.test(button.iconSvg))) &&
    (!button.appIconData || (typeof button.appIconData === 'string' && button.appIconData.length <= 65536 && button.appIconData.startsWith('data:image/png;base64,'))) &&
    !!button.action && typeof button.action.type === 'string';
}

function utf8ByteLength(value: string) {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function validDeckWidget(value: unknown): value is DeckWidget {
  if (!value || typeof value !== 'object') return false;
  const widget = value as Partial<DeckWidget>;
  const placement = widget.placement;
  if (typeof widget.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(widget.id) || !placement || typeof placement !== 'object' ||
      ![placement.row, placement.column, placement.rowSpan, placement.columnSpan].every(Number.isInteger)) return false;
  if (widget.type === 'clock' || widget.type === 'now_playing') return true;
  if (widget.type !== 'plugin' || !('pluginId' in widget) || !('widgetId' in widget) || !('renderType' in widget) || !('values' in widget)) return false;
  const pluginWidget = widget as Extract<DeckWidget, { type: 'plugin' }>;
  if (![pluginWidget.pluginId, pluginWidget.widgetId, pluginWidget.renderType].every((id) => typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id)) ||
      !pluginWidget.values || typeof pluginWidget.values !== 'object' || Array.isArray(pluginWidget.values)) return false;
  const entries = Object.entries(pluginWidget.values);
  return entries.length <= 16 && entries.every(([id, text]) => /^[A-Za-z0-9._-]{1,64}$/.test(id) && typeof text === 'string' && utf8ByteLength(text) <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/.test(text)) &&
    entries.reduce((total, [, text]) => total + utf8ByteLength(text), 0) <= 8192;
}

function validWidgetArea(value: unknown): value is DeckWidgetArea {
  if (!value || typeof value !== 'object') return false;
  const area = value as Partial<DeckWidgetArea>;
  return typeof area.enabled === 'boolean' && Number.isInteger(area.rows) && Number.isInteger(area.columns) &&
    (area.rows ?? 0) >= 1 && (area.rows ?? 0) <= 6 && (area.columns ?? 0) >= 1 && (area.columns ?? 0) <= 6 &&
    Array.isArray(area.pages) && area.pages.length > 0 && area.pages.length <= 9 &&
    area.pages.every((page) => page && typeof page.id === 'string' && typeof page.name === 'string' && Array.isArray(page.buttons) && Array.isArray(page.widgets) &&
      page.buttons.length + page.widgets.length <= (area.rows ?? 0) * (area.columns ?? 0) && page.buttons.every(validDeckButton) && page.widgets.every(validDeckWidget)) &&
    validDeckWidgetAreaLayout(area as DeckWidgetArea);
}

function validDeckPage(value: unknown): value is DeckPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<DeckPage>;
  return typeof page.id === 'string' && typeof page.name === 'string' &&
    (page.rows === undefined || (Number.isInteger(page.rows) && page.rows >= 0 && page.rows <= 6)) &&
    (page.columns === undefined || (Number.isInteger(page.columns) && page.columns >= 0 && page.columns <= 6)) &&
    Array.isArray(page.buttons) && page.buttons.length <= 36 && page.buttons.every(validDeckButton) &&
    (page.widgetArea === undefined || validWidgetArea(page.widgetArea)) &&
    validDeckPageLayout(page as DeckPage);
}

function validDeckConfig(value: unknown): value is DeckConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<DeckConfig>;
  return config.schemaVersion === 1 && Number.isSafeInteger(config.revision) && Array.isArray(config.profiles) && config.profiles.length > 0 && config.profiles.length <= 32 &&
    config.profiles.every((profile) => profile && typeof profile.id === 'string' && typeof profile.name === 'string' && Array.isArray(profile.pages) && profile.pages.length > 0 && profile.pages.length <= 8 &&
      profile.pages.every(validDeckPage));
}

export function ConnectionProvider({ children }: PropsWithChildren) {
  const socketRef = useRef<WebSocket | null>(null);
  const widgetSurfaceRef = useRef<WidgetSurface | null>(null);
  const pendingRequestsRef = useRef(new Set<string>());
  const openConnectionRef = useRef<((next: PcConnection, retrying: boolean) => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const terminalErrorRef = useRef(false);
  const [connection, setConnection] = useState<PcConnection | null>(null);
  const [pairedDevices, setPairedDevices] = useState<PcConnection[]>([]);
  const pairedDevicesRef = useRef<PcConnection[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [protocolError, setProtocolError] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('unavailable');
  const [mediaState, setMediaState] = useState<SystemMediaState>(EMPTY_MEDIA_STATE);
  const [deckConfig, setDeckConfig] = useState<DeckConfig | null>(null);
  const [independentNavigation, setIndependentNavigation] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ConnectionContextValue['actionError']>(null);

  const persistPairedDevices = useCallback((devices: PcConnection[]) => {
    pairedDevicesRef.current = devices;
    setPairedDevices(devices);
    return SecureStore.setItemAsync(PAIRED_KEY, JSON.stringify(devices));
  }, []);

  const openConnection = useCallback((next: PcConnection, retrying = false) => {
    pendingRequestsRef.current.clear();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    const previous = socketRef.current;
    socketRef.current = null;
    previous?.close();
    if (!retrying) {
      shouldReconnectRef.current = true;
      terminalErrorRef.current = false;
      reconnectAttemptRef.current = 0;
    }
    setConnection(next);
    setStatus('connecting');
    if (!retrying) {
      setDeckConfig(null);
      setIndependentNavigation(false);
      setSelectedProfileId(null);
      setSelectedPageId(null);
      setProtocolError(null);
      setPlaybackState('unavailable');
      setMediaState(EMPTY_MEDIA_STATE);
      setActionError(null);
    }

    const retry = () => {
      if (!shouldReconnectRef.current) return;
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        shouldReconnectRef.current = false;
        setStatus('disconnected');
        return;
      }
      setStatus('connecting');
      const delay = 1000 * 2 ** reconnectAttemptRef.current;
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (shouldReconnectRef.current) openConnectionRef.current?.(next, true);
      }, delay);
    };

    try {
      const socket = new WebSocket(websocketUrl(next));
      socketRef.current = socket;
      void Storage.getItem(`${DECK_CACHE_KEY}.${connectionId(next)}`).then((saved) => {
        if (socketRef.current !== socket || !saved) return;
        try {
          const cached: unknown = JSON.parse(saved);
          if (validDeckConfig(cached)) setDeckConfig((current) => current && current.revision > cached.revision ? current : cached);
        } catch {
          void Storage.removeItem(`${DECK_CACHE_KEY}.${connectionId(next)}`);
        }
      });
      socket.onopen = () => {
        void Promise.all([legacyDeckForPairing(next), Storage.getItem(`${DEVICE_SELECTION_KEY}.${connectionId(next)}`)]).then(([legacyDeck, savedSelection]) => {
          let selection: { profileId: string; pageId: string } | null = null;
          try {
            const parsed = savedSelection ? JSON.parse(savedSelection) as Partial<{ profileId: string; pageId: string }> : null;
            if (typeof parsed?.profileId === 'string' && typeof parsed.pageId === 'string') selection = { profileId: parsed.profileId, pageId: parsed.pageId };
          } catch { void Storage.removeItem(`${DEVICE_SELECTION_KEY}.${connectionId(next)}`); }
          if (socketRef.current === socket) socket.send(JSON.stringify({ type: 'authenticate', token: next.token, protocolVersion: 1, legacyDeckAvailable: Boolean(legacyDeck), supportsIndependentNavigation: true, ...(selection ? { selectedProfileId: selection.profileId, selectedPageId: selection.pageId } : {}), ...(legacyDeck ? { legacySourceId: legacyDeck.sourceId } : {}) }));
          else socket.close();
        }).catch(() => {
          if (socketRef.current === socket) socket.send(JSON.stringify({ type: 'authenticate', token: next.token, protocolVersion: 1, supportsIndependentNavigation: true }));
        });
      };
      socket.onmessage = async (event) => {
        if (socketRef.current !== socket || typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as { type?: string; message?: string; state?: unknown; ok?: boolean; reason?: string; requestId?: string; sourceId?: string; volumePercent?: unknown };
          if (message.type === 'ready') {
            reconnectAttemptRef.current = 0;
            setStatus('connected');
            if (widgetSurfaceRef.current) socket.send(JSON.stringify({ type: 'widget_surface', surface: widgetSurfaceRef.current }));
          }
          if (message.type === 'playback_state' && typeof message.state === 'string' && ['playing', 'paused', 'stopped', 'unavailable'].includes(message.state)) setPlaybackState(message.state as PlaybackState);
          if (message.type === 'media_state') {
            const state = message.state;
            if (!state || typeof state !== 'object' || Array.isArray(state)) {
              setMediaState(EMPTY_MEDIA_STATE);
            } else {
              const value = state as Record<string, unknown>;
              const text = (key: string, max: number) => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= max ? value[key] as string : undefined;
              const number = (key: string) => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= 86_400_000 ? value[key] as number : undefined;
              const playback = value.playbackState;
              const artwork = text('artworkDataUrl', 2_800_000);
              setMediaState({
                sourceAppId: text('sourceAppId', 256),
                title: text('title', 512),
                artist: text('artist', 512),
                album: text('album', 512),
                playbackState: typeof playback === 'string' && ['playing', 'paused', 'stopped', 'unavailable'].includes(playback) ? playback as PlaybackState : 'unavailable',
                positionMs: number('positionMs'),
                durationMs: number('durationMs'),
                volumePercent: typeof value.volumePercent === 'number' && Number.isFinite(value.volumePercent) && value.volumePercent >= 0 && value.volumePercent <= 100 ? Math.round(value.volumePercent) : undefined,
                artworkDataUrl: artwork && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(artwork) ? artwork : undefined,
              });
            }
          }
          if (message.type === 'media_progress') {
            const progress = message as { playbackState?: unknown; positionMs?: unknown; durationMs?: unknown; volumePercent?: unknown };
            const finiteTime = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000 ? value : undefined;
            setMediaState((current) => ({
              ...current,
              playbackState: typeof progress.playbackState === 'string' && ['playing', 'paused', 'stopped', 'unavailable'].includes(progress.playbackState) ? progress.playbackState as PlaybackState : current.playbackState,
              positionMs: finiteTime(progress.positionMs),
              durationMs: finiteTime(progress.durationMs),
              volumePercent: typeof progress.volumePercent === 'number' && Number.isFinite(progress.volumePercent) && progress.volumePercent >= 0 && progress.volumePercent <= 100 ? Math.round(progress.volumePercent) : current.volumePercent,
            }));
          }
          if (message.type === 'action_result' && message.requestId && pendingRequestsRef.current.delete(message.requestId)) {
            const reason = message.reason;
            setActionError(message.ok ? null : reason === 'accessibility_permission_required' || reason === 'app_launch_failed' || reason === 'stale_revision' || reason === 'unknown_button' ? reason : 'control_failed');
          }
          if (message.type === 'deck_snapshot') {
            const snapshot = JSON.parse(event.data) as { protocolVersion?: number; config?: unknown; independentNavigation?: boolean; selection?: { profileId?: string; pageId?: string } };
            const config = snapshot.config;
            if (snapshot.protocolVersion === 1 && validDeckConfig(config)) {
              setDeckConfig(config);
              const selectedProfile = config.profiles.find((profile) => profile.id === snapshot.selection?.profileId) ?? config.profiles.find((profile) => profile.id === config.activeProfileId);
              const selectedPage = selectedProfile?.pages.find((page) => page.id === snapshot.selection?.pageId) ?? selectedProfile?.pages.find((page) => page.id === selectedProfile.activePageId);
              setIndependentNavigation(snapshot.independentNavigation === true);
              setSelectedProfileId(selectedProfile?.id ?? null);
              setSelectedPageId(selectedPage?.id ?? null);
              if (snapshot.independentNavigation === true && selectedProfile && selectedPage) {
                void Storage.setItem(`${DEVICE_SELECTION_KEY}.${connectionId(next)}`, JSON.stringify({ profileId: selectedProfile.id, pageId: selectedPage.id }));
              }
              void Storage.setItem(`${DECK_CACHE_KEY}.${connectionId(next)}`, JSON.stringify(config));
              void SecureStore.getItemAsync(LEGACY_SOURCE_KEY).then((sourceId) => {
                if (sourceId && config.profiles.some((profile) => profile.id === `import-${sourceId}`)) {
                  return SecureStore.setItemAsync(`${LEGACY_IMPORTED_KEY}.${connectionId(next)}`, 'true');
                }
              }).catch(() => {});
            } else {
              setStatus('error');
            }
          }
          if (message.type === 'legacy_deck_request' && message.sourceId) {
            void legacyDeckForPairing(next).then((legacyDeck) => {
              if (legacyDeck && legacyDeck.sourceId === message.sourceId && socketRef.current === socket) {
                socket.send(JSON.stringify({ type: 'legacy_deck', legacyDeck }));
              }
            });
          }
          if (message.type === 'error' && message.message === 'unauthorized') {
            shouldReconnectRef.current = false;
            terminalErrorRef.current = true;
            setStatus('error');
            socket.close();
          }
          if (message.type === 'error' && message.message === 'update_required') {
            shouldReconnectRef.current = false;
            terminalErrorRef.current = true;
            setProtocolError('Update the Freeze desktop app to connect to this phone app.');
            setStatus('error');
            socket.close();
          }
        } catch {
          setStatus('error');
        }
      };
      socket.onerror = () => {
        if (socketRef.current === socket) setStatus('error');
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        pendingRequestsRef.current.clear();
        if (shouldReconnectRef.current) retry();
        else if (!terminalErrorRef.current) setStatus('disconnected');
      };
    } catch {
      socketRef.current = null;
      setStatus('error');
      retry();
    }
  }, []);

  useEffect(() => {
    openConnectionRef.current = openConnection;
    return () => { openConnectionRef.current = null; };
  }, [openConnection]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const pairedValue = await SecureStore.getItemAsync(PAIRED_KEY);
      if (pairedValue) {
        try {
          const savedDevices = JSON.parse(pairedValue) as PcConnection[];
          if (Array.isArray(savedDevices)) {
            const validDevices = savedDevices.filter((device) => device && typeof device.host === 'string' && device.host && Number.isInteger(device.port) && typeof device.token === 'string' && device.token);
            pairedDevicesRef.current = validDevices;
            setPairedDevices(validDevices);
          }
        } catch {
          void SecureStore.deleteItemAsync(PAIRED_KEY);
        }
      }
      const saved = await SecureStore.getItemAsync(STORAGE_KEY);
      const legacy = saved ? null : await SecureStore.getItemAsync(LEGACY_STORAGE_KEY);
      const value = saved ?? legacy;
      if (!active || !value) return;
      try {
        const parsed = JSON.parse(value) as PcConnection;
        if (parsed.host && parsed.port && parsed.token) {
          if (legacy) {
            await SecureStore.setItemAsync(STORAGE_KEY, legacy);
            await SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY);
          }
          if (!active) return;
          const device = { ...parsed, deviceName: parsed.deviceName || parsed.host };
          void persistPairedDevices([device, ...pairedDevicesRef.current.filter((item) => connectionId(item) !== connectionId(device))]);
          openConnection(device);
        }
      } catch {
        void SecureStore.deleteItemAsync(STORAGE_KEY);
        void SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY);
      }
    };
    void restore();
    return () => {
      active = false;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [openConnection, persistPairedDevices]);

  const connect = useCallback(async (next: PcConnection) => {
    const device = { ...next, deviceName: next.deviceName?.trim() || next.host };
    openConnection(device);
    const updated = [device, ...pairedDevicesRef.current.filter((item) => connectionId(item) !== connectionId(device))];
    await Promise.all([
      persistPairedDevices(updated),
      SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(device)),
    ]);
  }, [openConnection, persistPairedDevices]);

  const disconnect = useCallback(async () => {
    pendingRequestsRef.current.clear();
    shouldReconnectRef.current = false;
    terminalErrorRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close(1000, 'Disconnected by user');
    setConnection(null);
    setStatus('disconnected');
    setPlaybackState('unavailable');
    setMediaState(EMPTY_MEDIA_STATE);
    setIndependentNavigation(false);
    setSelectedProfileId(null);
    setSelectedPageId(null);
    setActionError(null);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }, []);

  const removePairedDevice = useCallback(async (id: string) => {
    if (connection && connectionId(connection) === id) await disconnect();
    await persistPairedDevices(pairedDevicesRef.current.filter((device) => connectionId(device) !== id));
  }, [connection, disconnect, persistPairedDevices]);

  const sendRequest = useCallback((type: string, idField: string, id: string | number) => {
    const socket = socketRef.current;
    if (status !== 'connected' || socket?.readyState !== WebSocket.OPEN || !deckConfig) return false;
    setActionError(null);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingRequestsRef.current.add(requestId);
    try {
      socket.send(JSON.stringify({ type, requestId, revision: deckConfig.revision, [idField]: id }));
    } catch {
      pendingRequestsRef.current.delete(requestId);
      setActionError('control_failed');
      return false;
    }
    return true;
  }, [deckConfig, status]);
  const sendButton = useCallback((buttonId: string) => sendRequest('invoke_button', 'buttonId', buttonId), [sendRequest]);
  const sendMediaCommand = useCallback((command: DeckMediaCommand) => sendRequest('invoke_media_command', 'command', command), [sendRequest]);
  const sendSystemVolume = useCallback((volumePercent: number) => sendRequest('set_system_volume', 'volumePercent', Math.round(Math.max(0, Math.min(100, volumePercent)))), [sendRequest]);
  const selectProfile = useCallback((profileId: string) => sendRequest('select_profile', 'profileId', profileId), [sendRequest]);
  const selectPage = useCallback((pageId: string) => sendRequest('select_page', 'pageId', pageId), [sendRequest]);
  // Tells the desktop how big the phone's widget area is, so its Now Playing preview matches.
  // The latest value is resent after every reconnect.
  const reportWidgetSurface = useCallback((surface: WidgetSurface) => {
    const previous = widgetSurfaceRef.current;
    if (previous && (Object.keys(surface) as (keyof WidgetSurface)[]).every((key) => previous[key] === surface[key])) return;
    widgetSurfaceRef.current = surface;
    const socket = socketRef.current;
    if (status === 'connected' && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'widget_surface', surface }));
  }, [status]);

  return (
    <ConnectionContext.Provider value={{ connection, pairedDevices, status, protocolError, playbackState, mediaState, deckConfig, independentNavigation, selectedProfileId, selectedPageId, actionError, connect, disconnect, removePairedDevice, sendButton, sendMediaCommand, sendSystemVolume, selectProfile, selectPage, reportWidgetSurface }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function usePcConnection() {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error('usePcConnection must be used inside ConnectionProvider');
  return value;
}
