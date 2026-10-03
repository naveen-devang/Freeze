import { Music, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { nowPlayingLayout, widgetBlockSize, type WidgetSurface } from './now-playing-layout';
import { useElementSize } from './useElementSize';

// Used until a phone reports its widget area: an iPhone Pro Max in landscape on a widget-only page.
export const REFERENCE_WIDGET_SURFACE: WidgetSurface = { width: 790, height: 385, gap: 10, inset: 5, fixedRowHeight: null };

type PreviewMedia = { title?: string | null; artist?: string | null; album?: string | null; playbackState: string; positionMs?: number | null; durationMs?: number | null; artworkDataUrl?: string | null };

const timeLabel = (milliseconds: number) => `${Math.floor(milliseconds / 60_000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;

// Lays the widget out at the phone's block size with the phone's own layout rules,
// then scales the whole card to fit the editor cell, so both screens show the same thing.
export function NowPlayingPreview({ media, surface, columns, rows, columnSpan, rowSpan }: { media: PreviewMedia; surface: WidgetSurface; columns: number; rows: number; columnSpan: number; rowSpan: number }) {
  const [frameRef, box] = useElementSize<HTMLDivElement>();
  const { width, height } = widgetBlockSize(surface, columns, rows, columnSpan, rowSpan);
  const layout = nowPlayingLayout(width, height);
  const scale = box.width && box.height ? Math.min(box.width / width, box.height / height) : 0;
  const on = (row: (typeof layout.show)[number]) => layout.show.includes(row);
  const stacked = layout.mode !== 'row';
  const textAlign = stacked ? 'center' : 'left';
  const supportingText = media.artist || media.album || (media.playbackState === 'unavailable' ? 'Waiting for media' : media.playbackState === 'paused' ? 'Paused' : 'System media');
  const duration = media.durationMs && media.durationMs > 0 ? media.durationMs : 0;
  const position = Math.max(0, Math.min(duration, media.positionMs ?? 0));
  const artRadius = Math.max(5, layout.artSize * 0.13);
  const PlayIcon = media.playbackState === 'playing' ? Pause : Play;
  return <div ref={frameRef} className="now-playing-preview-frame">
    <div className="now-playing-preview" style={{ width, height, left: (box.width - width * scale) / 2, top: (box.height - height * scale) / 2, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
      {media.artworkDataUrl ? <><span className="now-playing-preview-backdrop"><img src={media.artworkDataUrl} alt="" /></span><span className="now-playing-preview-tint" /></> : null}
      <div className="now-playing-preview-content" style={{ flexDirection: stacked ? 'column' : 'row', padding: layout.padding, gap: layout.gap }}>
        <span className="now-playing-preview-art" style={{ width: layout.artSize, height: layout.artSize, borderRadius: artRadius }}>{media.artworkDataUrl ? <img src={media.artworkDataUrl} alt="" /> : <Music size={Math.max(12, layout.artSize * 0.43)} />}</span>
        <div className="now-playing-preview-copy" style={{ gap: layout.gap, textAlign, ...(stacked ? { width: '100%' } : { flex: 1 }) }}>
          <strong style={{ fontSize: layout.titleSize, lineHeight: 1.25 }}>{media.title || media.artist || 'No media'}</strong>
          {on('detail') ? <small style={{ fontSize: layout.detailSize, lineHeight: 1.3 }}>{supportingText}</small> : null}
          {on('album') && media.album && media.album !== supportingText ? <small className="now-playing-preview-album" style={{ fontSize: layout.detailSize, lineHeight: 1.3 }}>{media.album}</small> : null}
          {on('progress') ? <span className="now-playing-preview-progress" style={{ height: layout.barHeight + 2 }}><i style={{ height: layout.barHeight }}><i style={{ width: `${duration ? position / duration * 100 : 0}%` }} /></i></span> : null}
          {on('times') && duration ? <span className="now-playing-preview-times" style={{ fontSize: layout.timeSize, lineHeight: 1.3 }}><small>{timeLabel(position)}</small><small>{timeLabel(duration)}</small></span> : null}
          {on('controls') ? <span className="now-playing-preview-controls" style={{ height: layout.primaryControlSize, gap: layout.gap * 1.3 }}>
            <i style={{ width: layout.controlSize, height: layout.controlSize }}><SkipBack size={layout.controlSize * 0.5} /></i>
            <i className="primary" style={{ width: layout.primaryControlSize, height: layout.primaryControlSize }}><PlayIcon size={layout.primaryControlSize * 0.55} /></i>
            <i style={{ width: layout.controlSize, height: layout.controlSize }}><SkipForward size={layout.controlSize * 0.5} /></i>
            {layout.volumeButton ? <i style={{ width: layout.controlSize, height: layout.controlSize }}><Volume2 size={layout.controlSize * 0.5} /></i> : null}
          </span> : null}
        </div>
      </div>
    </div>
  </div>;
}
