import { Copy, Trash2 } from 'lucide-react';

// The pieces every settings panel in the Deck editor is built from, so a widget, a button and a folder
// share one header, one gutter and one spacing. Each panel only decides which sections it has.
export function PanelHeader({ title, subtitle, noun, busy, onDuplicate, onDelete }: { title: string; subtitle: string; noun: string; busy: boolean; onDuplicate: () => void; onDelete: () => void }) {
  return <div className="panel-head">
    <div><h2>{title}</h2><p>{subtitle}</p></div>
    <div className="panel-tools">
      <button type="button" className="panel-icon-button" aria-label={`Duplicate ${noun}`} title="Duplicate" disabled={busy} onClick={onDuplicate}><Copy size={14} /></button>
      <button type="button" className="panel-icon-button danger" aria-label={`Delete ${noun}`} title="Delete" disabled={busy} onClick={onDelete}><Trash2 size={14} /></button>
    </div>
  </div>;
}

export function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel-section"><h3>{title}</h3>{children}</section>;
}
