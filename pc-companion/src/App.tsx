import { useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppWindow,
  Check,
  ChevronDown,
  Command,
  Copy,
  FolderOpen,
  Headphones,
  Layers,
  Keyboard,
  Layers2,
  LayoutDashboard,
  ListOrdered,
  Mic,
  Monitor,
  Music,
  PanelsTopLeft,
  Pause,
  Play,
  QrCode,
  Plus,
  Trash2,
  Save,
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

type ConnectionInfo = {
  host: string;
  deviceName: string;
  port: number;
  token: string;
  activeDevices: number;
  serverOnline: boolean;
  isMacos: boolean;
  androidUsbEnabled: boolean;
};

type MediaCommand = 'play_pause' | 'next_track' | 'previous_track' | 'volume_up' | 'volume_down' | 'mute';
type DeckStep = { type: 'media'; command: MediaCommand } | { type: 'hotkey'; keys: string[] } | { type: 'launch_app'; app: string };
type DeckAction = DeckStep | { type: 'launch_app'; app: string } | { type: 'sequence'; steps: DeckStep[] } | { type: 'select_profile'; profileId: string } | { type: 'select_page'; pageId: string };
type DeckButton = { id: string; label: string; icon: string; iconSvg?: string; appIconData?: string; action: DeckAction };
type PlaybackState = 'playing' | 'paused' | 'stopped' | 'unavailable';
type LucideRegistry = Record<string, typeof Command>;
type DeckPage = { id: string; name: string; rows: number; columns: number; buttons: DeckButton[] };
type DeckProfile = { id: string; name: string; pages: DeckPage[]; activePageId: string };
type DeckConfig = { schemaVersion: number; revision: number; profiles: DeckProfile[]; activeProfileId: string };
type LegacyImportSummary = { sourceId: string; pages: number; buttons: number; requested: boolean; ready: boolean };

function App() {
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [transport, setTransport] = useState<'wifi' | 'usb'>('wifi');
  const [usbEnabled, setUsbEnabled] = useState(false);
  const [usbBusy, setUsbBusy] = useState(false);
  const [usbError, setUsbError] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [screen, setScreen] = useState<'overview' | 'deck'>('overview');
  const [deckConfig, setDeckConfig] = useState<DeckConfig | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('unavailable');
  const [legacyImports, setLegacyImports] = useState<LegacyImportSummary[]>([]);
  const [importError, setImportError] = useState('');

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
    const timer = window.setInterval(refresh, 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

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
    } catch (error) {
      setUsbError(String(error));
    } finally {
      setUsbBusy(false);
    }
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
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
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
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className={`status-dot ${online ? "online" : ""}`} />
            <div>
              <strong>
                {online ? "Companion ready" : loadError ? "Unavailable" : "Starting"}
              </strong>
              <span>Freeze for desktop</span>
            </div>
          </div>
          <span className="version">0.1.0</span>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <span>{screen === 'overview' ? 'Overview' : 'Deck'}</span>
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
          {screen === 'deck' ? <DesktopDeckEditor config={deckConfig} onSaved={setDeckConfig} playbackState={playbackState} isMacos={connection?.isMacos ?? false} /> : <>
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
                  <span>Requires USB debugging and Android Platform-Tools.</span>
                </div>
                <button className="secondary-button" onClick={() => void enableAndroidUsb()} disabled={!connection || usbBusy}>
                  {usbBusy ? 'Setting up…' : usbEnabled ? 'Reconnect USB' : 'Set up USB'}
                </button>
              </div>
              {usbError ? <p className="usb-error" role="alert">{usbError}</p> : null}
              {transport === 'usb' && usbEnabled ? <p className="pair-note">Connect the Android phone by USB, then scan this code. Keep USB debugging enabled while using Freeze.</p> : null}
              <p className="pair-note">iPhone USB data control needs a compatible MFi accessory. Use Wi-Fi on iOS.</p>
              <button className="secondary-button reset-pairing-button" onClick={() => void rotatePairingKey()}>Reset pairing key</button>
              {pairingError ? <p className="usb-error" role="alert">{pairingError}</p> : null}
              <p className="pair-note">
                Keep the QR code private. Anyone who scans it can control this PC.
              </p>
              {connection?.isMacos && (
                <p className="pair-note mac-note">
                  Allow Freeze under System Settings → Privacy &amp; Security → Accessibility to send controls. macOS does not expose other apps’ global playback state, so the phone reflects the last Play/Pause command sent from Freeze.
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

function DesktopDeckEditor({ config: savedConfig, onSaved, playbackState, isMacos }: { config: DeckConfig | null; onSaved: (config: DeckConfig) => void; playbackState: PlaybackState; isMacos: boolean }) {
  const [workingConfig, setWorkingConfig] = useState<DeckConfig | null>(savedConfig);
  const [profileId, setProfileId] = useState('');
  const [pageId, setPageId] = useState('');
  const [buttonId, setButtonId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [editingPageId, setEditingPageId] = useState('');
  const [pageNameDraft, setPageNameDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draggingButtonId, setDraggingButtonId] = useState('');
  const [dragOverButtonId, setDragOverButtonId] = useState('');
  const buttonDrag = useRef<{ id: string; pointerId: number; x: number; y: number; active: boolean } | null>(null);

  useEffect(() => { setWorkingConfig(savedConfig); }, [savedConfig]);
  const config = workingConfig ?? savedConfig;

  useEffect(() => {
    if (!config) return;
    const profile = config.profiles.find((item) => item.id === (profileId || config.activeProfileId)) ?? config.profiles[0];
    const page = profile.pages.find((item) => item.id === (pageId || profile.activePageId)) ?? profile.pages[0];
    setProfileId(profile.id);
    setPageId(page.id);
    if (!page.buttons.some((button) => button.id === buttonId)) setButtonId(page.buttons[0]?.id ?? '');
  }, [config, profileId, pageId, buttonId]);

  const activeProfile = config?.profiles.find((item) => item.id === profileId) ?? config?.profiles[0];
  const activePage = activeProfile?.pages.find((item) => item.id === pageId) ?? activeProfile?.pages[0];
  useEffect(() => { if (activeProfile) setProfileName(activeProfile.name); }, [activeProfile?.id, activeProfile?.name]);

  if (!config || !activeProfile || !activePage) return <div className="deck-loading">Loading your PC deck…</div>;
  const deck = config;
  const profile = activeProfile;
  const page = activePage;
  const selected = page.buttons.find((button) => button.id === buttonId) ?? null;

  async function save(next: DeckConfig) {
    setBusy(true);
    setError('');
    try {
      const saved = await invoke<DeckConfig>('save_deck_config', { config: next });
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

  function addPage() {
    if (profile.pages.length >= 8) return setError('Profiles can have up to 8 pages.');
    const id = `page-${Date.now()}`;
    const nextPage = { id, name: `Page ${profile.pages.length + 1}`, rows: 2, columns: 3, buttons: [] };
    const nextProfile = { ...profile, pages: [...profile.pages, nextPage], activePageId: id };
    const next = { ...deck, profiles: deck.profiles.map((item) => item.id === profile.id ? nextProfile : item), activeProfileId: profile.id };
    setPageId(id);
    void save(next);
  }

  function addButton() {
    if (page.buttons.length >= page.rows * page.columns) return setError('This page is full. Increase its rows or columns to add more buttons.');
    const id = `button-${Date.now()}`;
    const nextButton: DeckButton = { id, label: 'New button', icon: 'auto', action: { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] } };
    replacePage({ ...page, buttons: [...page.buttons, nextButton] });
    setButtonId(id);
  }

  function reorderButton(draggedId: string, targetId: string) {
    if (draggedId === targetId || busy) return;
    const index = page.buttons.findIndex((item) => item.id === draggedId);
    const destination = page.buttons.findIndex((item) => item.id === targetId);
    if (index < 0 || destination < 0) return;
    const buttons = [...page.buttons];
    const [dragged] = buttons.splice(index, 1);
    buttons.splice(destination, 0, dragged);
    replacePage({ ...page, buttons });
  }

  function startButtonDrag(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || busy) return;
    buttonDrag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveButtonDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = buttonDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    drag.active = true;
    event.preventDefault();
    setDraggingButtonId(drag.id);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-deck-button]');
    const targetId = target?.dataset.deckButton ?? '';
    if (targetId !== dragOverButtonId) setDragOverButtonId(targetId);
  }

  function finishButtonDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = buttonDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    buttonDrag.current = null;
    if (drag.active) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-deck-button]');
      if (target?.dataset.deckButton) reorderButton(drag.id, target.dataset.deckButton);
      setButtonId(drag.id);
    }
    setDraggingButtonId('');
    setDragOverButtonId('');
  }

  function cancelButtonDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (buttonDrag.current?.pointerId !== event.pointerId) return;
    buttonDrag.current = null;
    setDraggingButtonId('');
    setDragOverButtonId('');
  }

  function duplicateButton() {
    if (!selected) return;
    if (page.buttons.length >= page.rows * page.columns) return setError('This page is full. Increase its rows or columns to add more buttons.');
    const id = `button-${Date.now()}`;
    const index = page.buttons.findIndex((item) => item.id === selected.id);
    const buttons = [...page.buttons];
    buttons.splice(index + 1, 0, { ...selected, id, label: `${selected.label} copy`.slice(0, 24) });
    replacePage({ ...page, buttons });
    setButtonId(id);
  }

  function addProfile() {
    if (deck.profiles.length >= 32) return setError('You can create up to 32 profiles.');
    const id = `profile-${Date.now()}`;
    const nextProfile: DeckProfile = { id, name: `Profile ${deck.profiles.length + 1}`, pages: [{ id: `${id}-main`, name: 'Main', rows: 2, columns: 3, buttons: [] }], activePageId: `${id}-main` };
    const next = { ...deck, activeProfileId: id, profiles: [...deck.profiles, nextProfile] };
    setProfileId(id);
    setPageId(nextProfile.activePageId);
    setButtonId('');
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
    const next = { ...deck, activeProfileId: remaining[0].id, profiles: remaining };
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
    replacePage({ ...page, buttons: page.buttons.map((button) => button.id === selected.id ? { ...button, ...patch } : button) }, profile, false);
  }

  function resizePage(dimension: 'rows' | 'columns', value: string) {
    const nextValue = Number(value);
    if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 6) return;
    const rows = dimension === 'rows' ? nextValue : page.rows;
    const columns = dimension === 'columns' ? nextValue : page.columns;
    if (page.buttons.length > rows * columns) return setError(`This page already has ${page.buttons.length} buttons. Keep at least ${Math.ceil(page.buttons.length / (dimension === 'rows' ? columns : rows))} ${dimension}.`);
    setError('');
    replacePage({ ...page, [dimension]: nextValue });
  }

  function actionType(action: DeckAction): string {
    if (action.type === 'sequence') return 'sequence';
    if (action.type === 'select_page' || action.type === 'select_profile') return action.type;
    return action.type;
  }

  return <>
    <div className="page-heading">
      <div><h1>Deck</h1><p>Build the controls saved on this PC and shared with connected phones.</p></div>
      <div className="heading-actions">{deck.profiles.length > 1 ? <button className="secondary-button" onClick={deleteProfile} disabled={busy}><Trash2 size={14} /> Delete profile</button> : null}{profile.pages.length > 1 ? <button className="secondary-button" onClick={deletePage} disabled={busy}><Trash2 size={14} /> Delete page</button> : null}<button className="primary-button" onClick={addProfile} disabled={busy}><Plus size={15} /> New profile</button></div>
    </div>
    {error ? <p className="usb-error" role="alert">{error}</p> : null}
    <section className="deck-toolbar">
      <label>Profile<DeckSelect value={profile.id} disabled={busy} options={deck.profiles.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => { const nextProfile = deck.profiles.find((item) => item.id === value)!; setProfileId(nextProfile.id); setPageId(nextProfile.activePageId); setButtonId(''); void save({ ...deck, activeProfileId: nextProfile.id }); }} /></label>
      <label>Profile name<input value={profileName} maxLength={32} disabled={busy} onChange={(event) => setProfileName(event.target.value)} onBlur={renameProfile} /></label>
      <div className="page-control"><label>Pages<div className="page-switcher">{profile.pages.map((item) => item.id === editingPageId ? <input key={item.id} className="page-tab-editor" aria-label={`Rename ${item.name}`} value={pageNameDraft} maxLength={24} style={{ width: `${Math.max(8, pageNameDraft.length + 2)}ch` }} autoFocus disabled={busy} onChange={(event) => setPageNameDraft(event.target.value)} onBlur={() => renamePage(item.id, pageNameDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /> : <button key={item.id} className={`transport-tab ${page.id === item.id ? 'selected' : ''}`} disabled={busy} title="Double-click to rename" onDoubleClick={() => { setPageId(item.id); setPageNameDraft(item.name); setEditingPageId(item.id); }} onClick={() => { setPageId(item.id); if (page.id !== item.id) setButtonId(''); if (profile.activePageId !== item.id) void save({ ...deck, activeProfileId: profile.id, profiles: deck.profiles.map((entry) => entry.id === profile.id ? { ...entry, activePageId: item.id } : entry) }); }}>{item.name}</button>)}</div></label><button className="add-page-button" onClick={addPage} disabled={busy || profile.pages.length >= 8} aria-label="Add page" title="Add page"><Plus size={16} /></button></div>
    </section>
    <section className="deck-editor-layout">
      <div className="deck-canvas-wrap">
        <div className="deck-canvas-heading"><div><h2>{profile.name} / {page.name}</h2><p>{page.buttons.length} of {page.rows * page.columns} slots · Drag to rearrange</p></div><div className="heading-actions"><label className="grid-size-control">Rows<DeckSelect value={String(page.rows)} disabled={busy} options={Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(value) => resizePage('rows', value)} /></label><label className="grid-size-control">Columns<DeckSelect value={String(page.columns)} disabled={busy} options={Array.from({ length: 6 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onChange={(value) => resizePage('columns', value)} /></label>{selected ? <button className="secondary-button" onClick={duplicateButton} disabled={busy || page.buttons.length >= page.rows * page.columns}><Copy size={13} /> Duplicate</button> : null}<button className="secondary-button" onClick={addButton} disabled={busy || page.buttons.length >= page.rows * page.columns}><Plus size={14} /> Add button</button></div></div>
        <div className="deck-canvas" style={{ gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))` }}>{Array.from({ length: page.rows * page.columns }, (_, index) => {
          const button = page.buttons[index];
          return button ? <button
          key={button.id}
          type="button"
          data-deck-button={button.id}
          className={`deck-button ${selected?.id === button.id ? 'selected' : ''} ${dragOverButtonId === button.id ? 'drop-target' : ''} ${draggingButtonId === button.id ? 'dragging' : ''}`}
          onClick={() => setButtonId(button.id)}
          onPointerDown={(event) => startButtonDrag(event, button.id)}
          onPointerMove={moveButtonDrag}
          onPointerUp={finishButtonDrag}
          onPointerCancel={cancelButtonDrag}
          onLostPointerCapture={cancelButtonDrag}
          onKeyDown={(event) => { if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const index = page.buttons.findIndex((item) => item.id === button.id); const target = page.buttons[index + (event.key === 'ArrowLeft' ? -1 : 1)]; if (target) reorderButton(button.id, target.id); } }}
          title="Drag to rearrange · Alt+Left/Right to move by one slot"
        ><span>{iconForButton(button, playbackState)}</span><strong>{buttonLabel(button, playbackState)}</strong><small>{actionType(button.action).replace('_', ' ')}</small></button> : <button key={`empty-${index}`} type="button" className="deck-button deck-slot" onClick={addButton} disabled={busy || page.buttons.length >= page.rows * page.columns} aria-label={`Add button in slot ${index + 1}`}><Plus size={17} /><span>Add button</span></button>;
        })}
        </div>
      </div>
      <div className="button-properties"><div className="properties-heading"><div><h2>Button settings</h2><p>{selected ? 'Edit the selected control' : 'Select a button to configure it'}</p></div>{selected ? <button className="icon-button" aria-label="Remove button" onClick={() => { const next = { ...config, profiles: config.profiles.map((entry) => entry.id === profile.id ? { ...entry, pages: entry.pages.map((candidate) => candidate.id === page.id ? { ...candidate, buttons: candidate.buttons.filter((item) => item.id !== selected.id) } : candidate) } : entry) }; setButtonId(''); void save(next); }}><Trash2 size={15} /></button> : null}</div>
        {selected ? <ButtonProperties key={selected.id} button={selected} busy={busy} isMacos={isMacos} onChange={updateButton} /> : <div className="properties-empty">Select a button from the deck grid.</div>}
        {selected ? <button className="primary-button save-button" onClick={() => void save(deck)} disabled={busy}><Save size={14} /> {busy ? 'Saving…' : 'Save deck'}</button> : null}
      </div>
    </section>
  </>;
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
        return <button type="button" key={name} className={`icon-picker-option ${name === value ? 'selected' : ''}`} title={name} aria-label={name} onClick={() => { const svg = renderToStaticMarkup(createElement(Icon, { size: 24, color: '#f4f4f5', strokeWidth: 2 })).replace(/stroke="currentColor"/g, 'stroke="#f4f4f5"'); onChange(name, svg); setOpen(false); }}><Icon size={17} /><span>{name}</span></button>;
      })}</div>
      {matches.length > visible.length ? <button type="button" className="icon-picker-more" onClick={() => setLimit((current) => current + 72)}>Show more ({matches.length - visible.length} remaining)</button> : null}
    </div> : null}
  </div>;
}

function ButtonProperties({ button, busy, isMacos, onChange }: { button: DeckButton; busy: boolean; isMacos: boolean; onChange: (patch: Partial<DeckButton>) => void }) {
  const action = button.action;
  const kind = action.type === 'sequence' ? 'sequence' : action.type;
  const keys = action.type === 'hotkey' ? action.keys.join('+') : '';
  const app = action.type === 'launch_app' ? action.app : '';
  const media = action.type === 'media' ? action.command : 'play_pause';
  const sequence = action.type === 'sequence' ? action.steps.map((step) => step.type === 'hotkey' ? step.keys.join('+') : step.type === 'launch_app' ? `APP:${step.app}` : `MEDIA:${step.command}`).join(', ') : 'CTRL+SHIFT+M, CTRL+S';
  const [sequenceDraft, setSequenceDraft] = useState(sequence);
  const [sequenceError, setSequenceError] = useState('');
  const [iconError, setIconError] = useState('');
  const [extractingIcon, setExtractingIcon] = useState(false);
  useEffect(() => { setSequenceDraft(sequence); setSequenceError(''); }, [sequence]);
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
  const isWindowsShortcut = !isMacos && app.toLowerCase().endsWith('.lnk');
  const setKind = (value: string) => {
    const next: DeckAction = value === 'media' ? { type: 'media', command: 'play_pause' } : value === 'launch_app' ? { type: 'launch_app', app: '' } : value === 'sequence' ? { type: 'sequence', steps: [{ type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] }, { type: 'hotkey', keys: ['CTRL', 'S'] }] } : value === 'select_profile' ? { type: 'select_profile', profileId: 'default' } : value === 'select_page' ? { type: 'select_page', pageId: 'main' } : { type: 'hotkey', keys: ['CTRL', 'SHIFT', 'M'] };
    onChange({ action: next, ...(value === 'launch_app' ? {} : { icon: 'auto', iconSvg: undefined, appIconData: undefined }) });
  };
  return <div className="property-fields">
    <label>Button label<input value={button.label} onChange={(event) => onChange({ label: event.target.value })} maxLength={24} disabled={busy} /></label>
    <label>Icon<IconPicker value={button.icon} disabled={busy} onChange={(name, svg) => onChange({ icon: name, iconSvg: svg, appIconData: undefined })} /></label>
    <label>Action<DeckSelect value={kind} onChange={setKind} disabled={busy} options={[['media', 'Media'], ['hotkey', 'Keyboard shortcut'], ['launch_app', 'Launch app'], ['sequence', 'Sequence'], ['select_profile', 'Select profile'], ['select_page', 'Select page']].map(([value, label]) => ({ value, label }))} /></label>
    {kind === 'media' ? <label>Media command<DeckSelect value={media} onChange={(value) => onChange({ action: { type: 'media', command: value as MediaCommand } })} disabled={busy} options={[['play_pause', 'Play / Pause'], ['next_track', 'Next track'], ['previous_track', 'Previous track'], ['volume_up', 'Volume up'], ['volume_down', 'Volume down'], ['mute', 'Mute']].map(([value, label]) => ({ value, label }))} /></label> : null}
    {kind === 'hotkey' ? <label>Keys<input value={keys} onChange={(event) => onChange({ action: { type: 'hotkey', keys: event.target.value.toUpperCase().split('+').map((key) => key.trim()).filter(Boolean) } })} placeholder="CTRL+SHIFT+M" disabled={busy} /></label> : null}
    {kind === 'launch_app' && action.type === 'launch_app' ? <><label>App path or name<div className="app-path-picker"><input value={app} onChange={(event) => setAppTarget(event.target.value)} placeholder="Application, shortcut, or app name" disabled={busy} /><button type="button" className="app-browse-button" aria-label="Browse for an application" title="Browse for an application" disabled={busy} onClick={() => void browseApp()}><FolderOpen size={15} /></button></div></label><button type="button" className="secondary-button app-icon-button" disabled={busy || extractingIcon || !app.trim()} onClick={() => void extractIcon(true)}>{extractingIcon ? 'Reading icon…' : button.appIconData ? isWindowsShortcut ? 'Refresh shortcut icon' : 'Refresh app icon' : isWindowsShortcut ? 'Use shortcut icon' : 'Use original app icon'}</button>{isWindowsShortcut && button.appIconData ? <button type="button" className="secondary-button app-icon-button" disabled={busy || extractingIcon} onClick={() => void extractIcon(false)}>Reset to app icon</button> : null}{iconError ? <small className="form-error">{iconError}</small> : null}</> : null}
    {kind === 'sequence' ? <label>Keyboard steps<textarea value={sequenceDraft} onChange={(event) => setSequenceDraft(event.target.value)} onBlur={() => { const steps = parseSequenceText(sequenceDraft); if (!steps) { setSequenceError('Use 1–10 valid keyboard shortcuts separated by commas.'); return; } setSequenceError(''); onChange({ action: { type: 'sequence', steps } }); }} placeholder="CTRL+SHIFT+M, CTRL+S" disabled={busy} /><small>Enter 1–10 shortcuts separated by commas.</small>{sequenceError ? <small className="form-error">{sequenceError}</small> : null}</label> : null}
    {kind === 'select_profile' ? <label>Profile ID<input value={action.type === 'select_profile' ? action.profileId : ''} onChange={(event) => onChange({ action: { type: 'select_profile', profileId: event.target.value } })} disabled={busy} /></label> : null}
    {kind === 'select_page' ? <label>Page ID<input value={action.type === 'select_page' ? action.pageId : ''} onChange={(event) => onChange({ action: { type: 'select_page', pageId: event.target.value } })} disabled={busy} /></label> : null}
  </div>;
}

function parseSequenceText(value: string): DeckStep[] | null {
  const steps = value.split(',').map((part) => part.trim());
  if (steps.length < 1 || steps.length > 10 || steps.some((step) => !step)) return null;
  const modifiers = new Set(['CTRL', 'ALT', 'SHIFT', 'META']);
  const special = new Set(['SPACE', 'ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE', 'HOME', 'END', 'PAGE_UP', 'PAGE_DOWN', 'UP', 'DOWN', 'LEFT', 'RIGHT']);
  const result: DeckStep[] = [];
  for (const step of steps) {
    const keys = step.toUpperCase().replace(/ /g, '').split('+');
    if (keys.length < 2 || keys.length > 5 || keys.slice(0, -1).some((key) => !modifiers.has(key)) || new Set(keys.slice(0, -1)).size !== keys.length - 1) return null;
    const last = keys[keys.length - 1];
    if (!/^[A-Z0-9]$/.test(last) && !special.has(last) && !/^F([1-9]|1[0-2])$/.test(last)) return null;
    result.push({ type: 'hotkey', keys });
  }
  return result;
}

export default App;
