import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { activeLineAt, fetchLyrics, isGapLine, lyricLineOpacity, lyricsLayout, lyricsTrackKey, withIntroGap, type Lyrics } from './lyrics';
import { widgetBlockSize, type WidgetSurface } from './now-playing-layout';
import { useElementSize } from './useElementSize';

type PreviewMedia = { title?: string | null; artist?: string | null; album?: string | null; playbackState: string; positionMs?: number | null; durationMs?: number | null; playbackRate?: number | null };

const LEAD_MS = 250;

// The phone's Lyrics widget drawn with CSS at the phone's block size, then scaled into the editor cell.
export function LyricsPreview({ media, surface, columns, rows, columnSpan, rowSpan }: { media: PreviewMedia; surface: WidgetSurface; columns: number; rows: number; columnSpan: number; rowSpan: number }) {
  const [frameRef, box] = useElementSize<HTMLDivElement>();
  const { width, height } = widgetBlockSize(surface, columns, rows, columnSpan, rowSpan);
  const layout = lyricsLayout(width, height);
  const scale = box.width && box.height ? Math.min(box.width / width, box.height / height) : 0;
  const track = useMemo(() => ({ title: media.title ?? undefined, artist: media.artist ?? undefined, album: media.album ?? undefined, durationMs: media.durationMs ?? undefined }), [media.title, media.artist, media.album, media.durationMs]);
  const key = lyricsTrackKey(track);
  const [result, setResult] = useState<{ key: string; lyrics: Lyrics } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchLyrics(track).then((lyrics) => { if (alive) setResult({ key, lyrics }); });
    return () => { alive = false; };
  }, [key, track]);
  const lyrics: Lyrics | 'loading' = !key ? { kind: 'none' } : result?.key === key ? result.lyrics : 'loading';
  const lines = useMemo(() => lyrics !== 'loading' && lyrics.kind === 'synced' ? withIntroGap(lyrics.lines) : null, [lyrics]);

  // Positions arrive once a second; count forward between them while playing.
  // Rate 0 while the player buffers: the lyrics wait with it.
  const rate = media.playbackState === 'playing' ? media.playbackRate ?? 1 : 0;
  const [clock, setClock] = useState({ positionMs: 0, at: 0 });
  const [now, setNow] = useState(0);
  useEffect(() => {
    setClock({ positionMs: media.positionMs ?? 0, at: performance.now() });
  }, [media.positionMs, rate]);
  // Re-render only when the next line is due, not on a fixed tick: the view changes once per line.
  useEffect(() => {
    if (rate <= 0 || !lines) return;
    const position = clock.positionMs + Math.max(0, performance.now() - clock.at) * rate + LEAD_MS;
    const next = lines.find((line) => line.timeMs > position);
    if (!next) return;
    const timeout = setTimeout(() => setNow(performance.now()), (next.timeMs - position) / rate + 5);
    return () => clearTimeout(timeout);
  }, [rate, lines, clock, now]);
  const position = clock.positionMs + Math.max(0, now - clock.at) * rate + LEAD_MS;
  const active = lines ? activeLineAt(lines, position) : -1;

  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [target, setTarget] = useState(0);
  useLayoutEffect(() => {
    const line = lineRefs.current[Math.max(0, active)];
    if (line) setTarget(layout.anchorY - line.offsetTop);
  }, [active, lines, layout.anchorY, layout.fontSize, width]);

  const hasMedia = media.playbackState !== 'unavailable' && Boolean(media.title || media.artist);
  const message = (text: string) => <div className="lyrics-preview-center" style={{ fontSize: layout.messageSize }}>{text}</div>;
  const dots = (label?: string) => <div className="lyrics-preview-center" style={{ fontSize: layout.messageSize }}>
    <span className="lyrics-preview-dots breathing" style={{ fontSize: layout.messageSize * 0.5 }}><i /><i /><i /></span>{label}
  </div>;

  return <div ref={frameRef} className="now-playing-preview-frame">
    <div className="now-playing-preview lyrics-preview" style={{ width, height, left: (box.width - width * scale) / 2, top: (box.height - height * scale) / 2, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
      {!hasMedia ? message('Nothing playing')
        : lyrics === 'loading' ? dots()
        : lines ? <div className="lyrics-preview-lines" style={{ padding: `0 ${layout.padding}px`, fontSize: layout.fontSize }}>
          {lines.map((line, index) => {
            const distance = active < 0 ? index + 1 : Math.abs(index - active);
            return <p key={`${index}:${line.timeMs}`} ref={(element) => { lineRefs.current[index] = element; }} style={{
              marginBottom: layout.lineGap,
              opacity: layout.compact && index < active ? 0 : lyricLineOpacity(distance),
              transform: `translateY(${target}px) scale(${index === active ? 1 : 0.96})`,
              transitionDelay: `${Math.max(0, Math.min(12, index - active + 1)) * 40}ms, 0ms`,
            }}>{isGapLine(line) ? <span className={`lyrics-preview-dots${index === active ? ' breathing' : ''}`} style={{ fontSize: layout.fontSize * 0.42 }}><i /><i /><i /></span> : line.text}</p>;
          })}
        </div>
        : lyrics.kind === 'plain' ? <div className="lyrics-preview-plain" style={{ fontSize: layout.messageSize * 1.05, padding: layout.messageSize }}>{lyrics.text}</div>
        : lyrics.kind === 'instrumental' ? dots('Instrumental')
        : message(lyrics.kind === 'error' ? 'Lyrics unavailable' : 'No lyrics found')}
    </div>
  </div>;
}
