import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { AppWindow, Search } from 'lucide-react';

type InstalledApp = { name: string; path: string };

// App icons come from the PC one at a time, only for rows that scroll into view.
const iconCache = new Map<string, string | null>();
const waiting: (() => void)[] = [];
let loading = 0;

async function loadIcon(path: string): Promise<string | null> {
  if (iconCache.has(path)) return iconCache.get(path) ?? null;
  if (loading >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  loading++;
  try {
    const data = await invoke<string>('extract_app_icon', { app: path, useShortcutIcon: true });
    iconCache.set(path, data);
    return data;
  } catch {
    iconCache.set(path, null);
    return null;
  } finally {
    loading--;
    waiting.shift()?.();
  }
}

function AppRow({ app, onPick }: { app: InstalledApp; onPick: (app: InstalledApp) => void }) {
  const row = useRef<HTMLButtonElement>(null);
  const [icon, setIcon] = useState<string | null>(iconCache.get(app.path) ?? null);
  useEffect(() => {
    const element = row.current;
    if (!element || iconCache.has(app.path)) return;
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadIcon(app.path).then((data) => { if (alive) setIcon(data); });
    });
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); };
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
