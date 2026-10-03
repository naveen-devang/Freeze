// Shared with pc-companion/src/lyrics.ts. Keep the two files identical:
// scripts/check-lyrics.ts fails when they differ.

export type LyricLine = { timeMs: number; text: string };
export type Lyrics =
  | { kind: 'synced'; lines: LyricLine[] }
  | { kind: 'plain'; text: string }
  | { kind: 'instrumental' }
  | { kind: 'none' }
  | { kind: 'error' };
export type LyricsTrack = { title?: string; artist?: string; album?: string; durationMs?: number };

type LrclibRecord = { trackName?: unknown; artistName?: unknown; duration?: unknown; instrumental?: unknown; plainLyrics?: unknown; syncedLyrics?: unknown };

const API = 'https://lrclib.net/api';
// LRCLIB asks clients to identify themselves. Browsers can't set User-Agent, so use its alternative header.
const HEADERS = { 'Lrclib-Client': 'Freeze (https://github.com/naveen-devang/Freeze)' };
const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;
const DURATION_TOLERANCE_S = 3;
const CACHE_SIZE = 20;
// LRCLIB is crowd-sourced and holds test entries (e.g. one line of "probe"); fewer real lines than this is junk.
const MIN_LYRIC_LINES = 3;
const cache = new Map<string, Promise<Lyrics>>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Sizes for a lyrics widget block in px. The phone widget and the desktop preview both use it, so they match.
// Short blocks (about one grid row) pin the active line to the top, showing it and the next line only.
export function lyricsLayout(width: number, height: number) {
  const compact = height < 150;
  const fontSize = compact ? clamp(Math.min(width * 0.09, height * 0.17), 11, 20) : clamp(Math.min(width * 0.075, height * 0.11), 14, 30);
  const padding = fontSize * 0.6;
  return {
    compact,
    fontSize,
    padding,
    lineGap: fontSize * 0.55,
    // Where the active line's top sits.
    anchorY: compact ? padding : height * 0.32,
    messageSize: clamp(Math.min(width * 0.06, height * 0.12), 11, 18),
  };
}

// Apple Music-style falloff: the active line is solid, neighbours fade with distance.
export const lyricLineOpacity = (distance: number) => [1, 0.35, 0.27, 0.21][distance] ?? 0.15;

// One key per track; null when a lookup can't succeed (videos without an artist, clips, long streams).
export function lyricsTrackKey(track: LyricsTrack): string | null {
  const title = track.title?.trim();
  const artist = track.artist?.trim();
  const duration = track.durationMs;
  if (!title || !artist || !duration || duration < 30_000 || duration > 15 * 60_000) return null;
  return [title, artist, track.album?.trim() ?? '', Math.round(duration / 1000)].join('\u0000');
}

// A line with no words (LRCLIB writes instrumental breaks as "♪") shows as the gap dots.
export const isGapLine = (line: LyricLine) => line.text.replace(/[♪♫♩♬\s]/g, '') === '';

export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    // Word-sync tags (<mm:ss.xx>) are dropped; v1 is line-synced.
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    for (const [, minutes, seconds] of stamps) {
      lines.push({ timeMs: Math.round((Number(minutes) * 60 + Number(seconds.replace(':', '.'))) * 1000), text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

// A long wait before the first line gets its own gap, so the intro shows the dots too.
export function withIntroGap(lines: LyricLine[]): LyricLine[] {
  return lines.length > 0 && lines[0].timeMs >= 5000 && !isGapLine(lines[0]) ? [{ timeMs: 0, text: '' }, ...lines] : lines;
}

// Index of the line playing at `positionMs`, or -1 before the first line.
export function activeLineAt(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].timeMs <= positionMs) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

const TITLE_NOISE = /\s*[([]([^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|mv|hd|hq|4k|explicit|clean)\b[^)\]]*)[)\]]/gi;
const FEATURING = /\s*[([]?\s*\b(feat\.?|ft\.?|featuring)\s.*$/i;

// Strips video-style decoration: "Song (Official Video) [4K] ft. X" -> "Song".
export function cleanTitle(title: string): string {
  return title.replace(TITLE_NOISE, '').replace(FEATURING, '').replace(/\s+/g, ' ').trim();
}

// "ArtistVEVO", "Artist - Topic" and "Artist Official" are channel names, not artists.
export function cleanArtist(artist: string): string {
  return artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s+Official$/i, '').replace(FEATURING, '').trim();
}

// Search attempts after an exact miss: the cleaned names, then "Artist - Song" titles split apart.
export function searchQueries(track: LyricsTrack): { track: string; artist: string }[] {
  const title = cleanTitle(track.title ?? '');
  const artist = cleanArtist(track.artist ?? '');
  const queries = [{ track: title, artist }];
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) queries.push({ track: cleanTitle(dash[2]), artist: cleanArtist(dash[1]) });
  return queries.filter((query, index) => query.track && query.artist && queries.findIndex((other) => other.track === query.track && other.artist === query.artist) === index);
}

function fromRecord(record: LrclibRecord): Lyrics | null {
  if (typeof record.syncedLyrics === 'string') {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.filter((line) => !isGapLine(line)).length >= MIN_LYRIC_LINES) return { kind: 'synced', lines };
  }
  if (record.instrumental === true) return { kind: 'instrumental' };
  if (typeof record.plainLyrics === 'string' && record.plainLyrics.split(/\r?\n/).filter((line) => line.trim()).length >= MIN_LYRIC_LINES) return { kind: 'plain', text: record.plainLyrics.trim() };
  return null;
}

// Picks the search result whose duration is closest to the track, preferring synced lyrics.
export function pickSearchResult(results: LrclibRecord[], durationMs: number): Lyrics | null {
  const near = results
    .filter((record) => typeof record.duration === 'number' && Math.abs(record.duration - durationMs / 1000) <= DURATION_TOLERANCE_S)
    .sort((a, b) => Math.abs((a.duration as number) - durationMs / 1000) - Math.abs((b.duration as number) - durationMs / 1000));
  const parsed = near.map(fromRecord).filter((lyrics): lyrics is Lyrics => lyrics !== null);
  return parsed.find((lyrics) => lyrics.kind === 'synced') ?? parsed.find((lyrics) => lyrics.kind === 'instrumental') ?? parsed[0] ?? null;
}

// LRCLIB answers 503 now and then; one retry after a short pause rides that out.
async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
  try {
    return await getJsonOnce(path, params);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return getJsonOnce(path, params);
  }
}

async function getJsonOnce(path: string, params: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Built by hand: React Native's URLSearchParams has been incomplete across versions.
    const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    const response = await fetch(`${API}${path}?${query}`, { headers: HEADERS, signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(track: LyricsTrack): Promise<Lyrics> {
  const durationMs = track.durationMs ?? 0;
  const exact = await getJson('/get', {
    track_name: track.title ?? '',
    artist_name: track.artist ?? '',
    album_name: track.album ?? '',
    duration: String(Math.round(durationMs / 1000)),
  });
  // Plain lyrics are a fallback: keep looking for synced ones first.
  let plain = exact && typeof exact === 'object' ? fromRecord(exact as LrclibRecord) : null;
  if (plain && plain.kind !== 'plain') return plain;
  for (const query of searchQueries(track)) {
    const results = await getJson('/search', { track_name: query.track, artist_name: query.artist });
    const found = Array.isArray(results) ? pickSearchResult(results as LrclibRecord[], durationMs) : null;
    if (found && found.kind !== 'plain') return found;
    plain ??= found;
  }
  return plain ?? { kind: 'none' };
}

// Looks a track up on LRCLIB. Results stay in memory for the last few tracks; failures are retried next time.
export function fetchLyrics(track: LyricsTrack): Promise<Lyrics> {
  const key = lyricsTrackKey(track);
  if (!key) return Promise.resolve({ kind: 'none' });
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const pending = lookup(track).catch((): Lyrics => {
    cache.delete(key);
    return { kind: 'error' };
  });
  cache.set(key, pending);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return pending;
}
