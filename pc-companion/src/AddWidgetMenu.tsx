import { useEffect, useRef } from 'react';
import { Clock, Gauge, MicVocal, Music, Package } from 'lucide-react';

export type WidgetChoice = { kind: 'clock' } | { kind: 'now_playing' } | { kind: 'lyrics' } | { kind: 'pc_stats' } | { kind: 'plugin'; pluginId: string; widgetId: string };
type PluginOption = { pluginId: string; widgetId: string; label: string };

// One picker for every widget type, opened from the toolbar or from an empty cell.
export function AddWidgetMenu({ anchor, plugins, onPick, onClose }: { anchor: DOMRect; plugins: PluginOption[]; onPick: (choice: WidgetChoice) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('button')?.focus();
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const width = 270;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left));
  const below = anchor.bottom + 6;
  const top = below + 320 > window.innerHeight ? Math.max(8, anchor.top - 326) : below;
  const option = (key: string, icon: React.ReactNode, title: string, detail: string, choice: WidgetChoice) =>
    <button key={key} type="button" role="menuitem" className="add-widget-option" onClick={() => onPick(choice)}>{icon}<span><strong>{title}</strong><small>{detail}</small></span></button>;
  return <div ref={ref} className="add-widget-menu" role="menu" style={{ left, top, width }}>
    {option('clock', <Clock size={18} />, 'Clock', '26 faces, many with your own color', { kind: 'clock' })}
    {option('now_playing', <Music size={18} />, 'Now Playing', 'Artwork, controls and volume for this PC', { kind: 'now_playing' })}
    {option('pc_stats', <Gauge size={18} />, 'PC stats', 'CPU, GPU, RAM and temperatures, 16 styles', { kind: 'pc_stats' })}
    {option('lyrics', <MicVocal size={18} />, 'Lyrics', 'Synced lyrics for what this PC is playing', { kind: 'lyrics' })}
    {plugins.map((plugin) => option(`${plugin.pluginId}::${plugin.widgetId}`, <Package size={18} />, plugin.label, 'Plugin widget', { kind: 'plugin', pluginId: plugin.pluginId, widgetId: plugin.widgetId }))}
  </div>;
}
