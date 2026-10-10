import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { AppWindow, Search } from 'lucide-react';

type InstalledApp = { name: string; path: string };

// App icons come from the PC, only for rows that are on screen. Rows scrolled past before their turn drop out of
// the queue, and the newest visible row goes first, so scrolling a long list never builds up a backlog.
const iconCache = new Map<string, string | null>();
type Waiting = { path: string; run: () => void; cancelled: boolean };
const waiting: Waiting[] = [];
let loading = 0;
const MAX_PARALLEL = 3;

function pump() {
  while (loading < MAX_PARALLEL) {
    const next = waiting.pop();
    if (!next) return;
    if (!next.cancelled) next.run();
  }
}

// Asks for an icon; the returned function withdraws the request if it has not started.
function requestIcon(path: string, done: (icon: string | null) => void): () => void {
  if (iconCache.has(path)) {
    done(iconCache.get(path) ?? null);
    return () => {};
  }
  const entry: Waiting = {
    path,
    cancelled: false,
    run: () => {
      loading++;
      invoke<string>('extract_app_icon', { app: path, useShortcutIcon: true })
        .then((data) => { iconCache.set(path, data); return data; })
        .catch(() => { iconCache.set(path, null); return null; })
        .then((data) => { loading--; done(data); pump(); });
    },
  };
  waiting.push(entry);
  pump();
  return () => { entry.cancelled = true; };
}

function AppRow({ app, onPick }: { app: InstalledApp; onPick: (app: InstalledApp) => void }) {
  const row = useRef<HTMLButtonElement>(null);
  const [icon, setIcon] = useState<string | null>(iconCache.get(app.path) ?? null);
  useEffect(() => {
    const element = row.current;
    if (!element || iconCache.has(app.path)) return;
    let withdraw = () => {};
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      withdraw();
      withdraw = () => {};
      if (visible) withdraw = requestIcon(app.path, (data) => { if (alive) setIcon(data); });
    });
    observer.observe(element);
    return () => { alive = false; withdraw(); observer.disconnect(); };
  }, [app.path]);
  return <button ref={row} type="button" className="app-picker-row" onClick={() => onPick(app)}>
    <span className="app-picker-icon">{icon ? <img src={icon} alt="" /> : <AppWindow size={16} />}</span>
    <span><strong>{app.name}</strong><small>{app.path}</small></span>
  </button>;
}

// Lists the apps installed on this PC. "Browse" is still there for anything the list doesn't show.
export function AppPicker({ isMacos, onPick, onClose }: { isMacos: boolean; onPick: (path: string, name: string, icon: string | null) => void; onClose: () => void }) {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    let alive = true;
    invoke<InstalledApp[]>('list_installed_apps').then((list) => { if (alive) setApps(list); }).catch((cause) => { if (alive) { setApps([]); setError(String(cause)); } });
    return () => { alive = false; };
  }, []);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (apps ?? []).filter((app) => !needle || app.name.toLowerCase().includes(needle) || app.path.toLowerCase().includes(needle));
  }, [apps, query]);

  async function browse() {
    try {
      const path = await openFileDialog({
        title: 'Choose an application',
        multiple: false,
        directory: false,
        filters: [isMacos ? { name: 'Applications', extensions: ['app'] } : { name: 'Applications and shortcuts', extensions: ['exe', 'lnk'] }],
      });
      if (typeof path === 'string') onPick(path, path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.replace(/\.(app|exe|lnk)$/i, '') ?? '', null);
    } catch (cause) {
      setError(`Could not open the file picker: ${String(cause)}`);
    }
  }

  return <div className="deck-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="deck-dialog app-picker" role="dialog" aria-modal="true" aria-label="Choose an app">
      <h2>Choose an app</h2>
      <label className="deck-library-search"><Search size={14} /><input autoFocus value={query} placeholder="Search installed apps" aria-label="Search installed apps" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && shown[0]) onPick(shown[0].path, shown[0].name, iconCache.get(shown[0].path) ?? null); }} /></label>
      <div className="app-picker-list">
        {apps === null ? <p className="deck-library-empty">Looking for installed apps…</p>
          : shown.length ? shown.map((app) => <AppRow key={app.path} app={app} onPick={(entry) => onPick(entry.path, entry.name, iconCache.get(entry.path) ?? null)} />)
            : <p className="deck-library-empty">{query.trim() ? `No installed app matches “${query.trim()}”.` : 'No installed apps were found.'} You can still browse for one.</p>}
      </div>
      {error ? <p className="usb-error" role="alert">{error}</p> : null}
      <div className="deck-dialog-foot spread"><button type="button" className="secondary-button" onClick={() => void browse()}>Browse for a file…</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div>
    </div>
  </div>;
}
