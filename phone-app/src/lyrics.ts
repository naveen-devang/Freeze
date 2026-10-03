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
// What a lookup tried, step by step, for the widget's debug readout.
export type LyricsTrace = { key: string | null; steps: string[] };

type LrclibRecord = { trackName?: unknown; artistName?: unknown; duration?: unknown; instrumental?: unknown; plainLyrics?: unknown; syncedLyrics?: unknown };

const API = 'https://lrclib.net/api';
// LRCLIB asks clients to identify themselves. Browsers can't set User-Agent, so use its alternative header.
const HEADERS = { 'Lrclib-Client': 'Freeze (https://github.com/naveen-devang/Freeze)' };
const TIMEOUT_MS = 8000;
// Waits before the 2nd and 3rd attempt. A Retry-After from LRCLIB wins, up to MAX_RETRY_WAIT_MS.
const RETRY_DELAYS_MS = [1000, 3000];
const MAX_RETRY_WAIT_MS = 10_000;
const DURATION_TOLERANCE_S = 3;
// The same title and artist this far off in length is another cut of the song (music videos run long): shown unsynced.
const LOOSE_DURATION_TOLERANCE_S = 90;
const CACHE_SIZE = 20;
// LRCLIB is crowd-sourced and holds test entries (e.g. one line of "probe"); fewer real lines than this is junk.
const MIN_LYRIC_LINES = 3;
const cache = new Map<string, Promise<Lyrics>>();
const traces = new Map<string, string[]>();

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

// Unicode clean-up: one form for accents and full-width characters, no invisible characters, single spaces.
export function normalizeText(text: string): string {
  let value = text;
  try {
    value = value.normalize('NFKC');
  } catch {
    // Engines without normalization data keep the text as it came.
  }
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

// One key per track; null when a lookup can't succeed (no title, clips, long streams).
// The duration is optional: some players never publish one, and the lookup then matches by name.
export function lyricsTrackKey(track: LyricsTrack): string | null {
  const title = normalizeText(track.title ?? '');
  const duration = track.durationMs;
  if (!title || (duration !== undefined && (duration < 30_000 || duration > 15 * 60_000))) return null;
  return [title, normalizeText(track.artist ?? ''), normalizeText(track.album ?? ''), duration ? Math.round(duration / 1000) : ''].join('\u0000');
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

// Words are bounded by spaces, brackets or the ends, so a letter of any script next to "ft" is never a boundary.
const TITLE_NOISE = /\s*[([](?:[^)\]]*?[\s,/&+-])?(?:official|video|audio|lyrics?|lyrical|visuali[sz]er|mv|hd|hq|4k|explicit|clean|full song)(?=$|[\s)\].,:/&+-])[^)\]]*[)\]]/gi;
const FROM_FILM = /\s*[([]\s*from\s[^)\]]*[)\]]/gi;
const FEATURING = /(?:^|[\s([])(?:feat\.?|ft\.?|featuring)\s.*$/i;
const VIDEO_PREFIX = /^(?:full\s+(?:video|song|audio)|lyrical(?:\s+video)?|video\s+song|official\s+(?:music\s+)?(?:video|audio))\s*[:|\-–—]\s*/i;
const HASHTAGS = /(?:^|\s)#[^\s#]+/g;
const EMOJI = /[\u{1f000}-\u{1faff}\u{2600}-\u{27bf}\u{fe0f}\u{200d}]/gu;
const FIRST_ARTIST = /\s*(?:,|&|;|\/|\sx\s|\sand\s|\swith\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s).*$/i;
// Unbracketed video words at the end: "Song M/V", "Song Official MV", "Song Performance Video".
const TRAILING_NOISE = /\s+(?:official\s+)?(?:m\/v|mv|music\s+video|lyrics?\s+video|performance\s+video|special\s+video|visuali[sz]er|video|audio)$/i;
// A quoted song name inside a video title, as K-pop and J-pop uploads write it: ARTIST 'Song' MV, ARTIST「Song」.
// An ASCII or curly quote opens after a space, bracket or dash and closes before one, so apostrophes
// inside words ("Don't", "It's Me") neither open nor close it. Corner brackets are always quotes.
const QUOTED = /(?:^|[\s([\-–—:])['‘"“](.{2,}?)['’"”](?=$|[\s)\].,:!?\-–—])|[「『](.+?)[」』]/;
// A native-script name in brackets after an artist: "MEOVV(미야오)" -> "MEOVV".
const BRACKETED = /\s*[([][^)\]]*[)\]]/g;

// Strips video-style decoration: 'Full Video: Song (From "Film") | Actor | #tag [4K] ft. X' -> "Song".
export function cleanTitle(title: string): string {
  const firstSegment = normalizeText(title).replace(EMOJI, '').replace(HASHTAGS, ' ').split('|').map((part) => part.trim()).find(Boolean) ?? '';
  return firstSegment.replace(VIDEO_PREFIX, '').replace(TITLE_NOISE, '').replace(FROM_FILM, '').replace(FEATURING, '').replace(/\s+/g, ' ').trim().replace(TRAILING_NOISE, '').trim();
}

// "ArtistVEVO", "Artist - Topic" and "Artist Official" are channel names, not artists.
export function cleanArtist(artist: string): string {
  return normalizeText(artist).replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s+Official$/i, '').replace(FEATURING, '').trim();
}

// "MEOVV(미야오) - 'In my hands' M/V" -> { title: "In my hands", artist: "MEOVV" }.
export function quotedSong(title: string): { title: string; artist: string } | null {
  // Matched before the feat./noise clean-up, which would cut "'Song (Feat. X)' MV" off at "Feat.".
  const segment = normalizeText(title).replace(EMOJI, '').replace(HASHTAGS, ' ').split('|').map((part) => part.trim()).find(Boolean) ?? '';
  const text = segment.replace(VIDEO_PREFIX, '');
  const match = text.match(QUOTED);
  if (!match || match.index === undefined) return null;
  const artist = text.slice(0, match.index).replace(BRACKETED, '').replace(/[\s\-–—:]+$/, '').trim();
  return { title: cleanTitle(match[1] ?? match[2]), artist: cleanArtist(artist) };
}

export type SearchQuery = { label: string; params: Record<string, string> };

// The searches tried after an exact miss, most specific first, without duplicates.
// Every result is checked against the track before it is used (see pickSearchResult), so broad searches are safe.
export function searchQueries(track: LyricsTrack): SearchQuery[] {
  const title = cleanTitle(track.title ?? '');
  const artist = cleanArtist(track.artist ?? '');
  const firstArtist = artist.replace(FIRST_ARTIST, '').trim();
  const queries: SearchQuery[] = [];
  const add = (label: string, trackName: string, artistName: string | null) => {
    if (!trackName || artistName === '') return;
    queries.push({ label, params: artistName === null ? { track_name: trackName } : { track_name: trackName, artist_name: artistName } });
  };
  add('title + artist', title, artist);
  // A quoted song name is the strongest hint a video title carries, so it goes next.
  const quoted = quotedSong(track.title ?? '');
  if (quoted) {
    add('quoted title + artist before it', quoted.title, quoted.artist);
    // "aespa エスパ" -> "aespa": uploads often follow the artist with its name in another script.
    add('quoted title + artist before it, Latin part', quoted.title, quoted.artist.replace(/(?:\s+[^\s\x00-\x7f]+)+$/, ''));
    add('quoted title + artist', quoted.title, artist);
    add('quoted title only', quoted.title, null);
  }
  add('title + first artist', title, firstArtist);
  // "Artist - Song" (most uploads) or "Song - Film" (soundtracks): try the halves both ways.
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    add('right half + left half as artist', cleanTitle(dash[2]), cleanArtist(dash[1]));
    add('left half only', cleanTitle(dash[1]), null);
    add('right half only', cleanTitle(dash[2]), null);
  }
  add('title only', title, null);
  if (title) queries.push({ label: 'free text', params: { q: `${title} ${firstArtist}`.trim() } });
  return queries.filter((query, index) => queries.findIndex((other) => JSON.stringify(other.params) === JSON.stringify(query.params)) === index);
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

// Lyrics shown without timing, for matches that can't be trusted to sync.
function asPlain(lyrics: Lyrics | null): Lyrics | null {
  if (lyrics?.kind === 'synced') return { kind: 'plain', text: lyrics.lines.filter((line) => !isGapLine(line)).map((line) => line.text).join('\n') };
  return lyrics?.kind === 'plain' ? lyrics : null;
}

// Lower-case with ASCII and CJK punctuation as spaces; letters of every script are kept.
const comparable = (text: string) => normalizeText(text).toLowerCase().replace(/[\s!-/:-@[-`{-~\u2010-\u205e\u3000-\u303f]+/g, ' ').trim();

const squash = (text: string) => comparable(text).replace(/ /g, '');
const ARTIST_SEPARATOR = /\s*(?:,|&|;|\/|×|、|및|\sx\s|\sand\s|\swith\s|\svs\.?\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s)\s*/i;

// What a result is checked against: everything the PC reported about the track.
export type MatchContext = { durationMs?: number; titles: string[]; text: string; artists: string[] };

export function matchContext(track: LyricsTrack): MatchContext {
  const quoted = quotedSong(track.title ?? '');
  const title = cleanTitle(track.title ?? '');
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const artist = cleanArtist(track.artist ?? '');
  return {
    durationMs: track.durationMs,
    titles: [title, quoted?.title, dash?.[1], dash?.[2]].filter((value): value is string => Boolean(value)).map((value) => comparable(cleanTitle(value))),
    // Title, channel and album together: an artist named anywhere in them counts ("Song | Arijit Singh" on a label's channel).
    text: ` ${comparable([track.title, track.artist, track.album].filter(Boolean).join(' '))} `,
    artists: [artist, quoted?.artist, dash?.[1]].filter((value): value is string => Boolean(value)).map(squash).filter((value) => value.length >= 2),
  };
}

// The result's title once both are cleaned up: 'Song (From "Film")' is "Song", but "Song (Dance Mix)" is
// another version. A title of 3+ characters found whole inside a video title counts too.
export function titleMatches(record: LrclibRecord, context: MatchContext) {
  const found = typeof record.trackName === 'string' ? comparable(cleanTitle(record.trackName)) : '';
  return Boolean(found) && (context.titles.includes(found) || (found.length >= 3 && context.text.includes(` ${found} `)));
}

// Any of the result's artists is named in what the PC reported. Latin names must match whole words;
// names in other scripts are found anywhere, and "TheWeekndVEVO" matches "The Weeknd" with spaces ignored.
export function artistMatches(record: LrclibRecord, context: MatchContext) {
  if (typeof record.artistName !== 'string') return false;
  return normalizeText(record.artistName).split(ARTIST_SEPARATOR).some((part) => {
    const name = comparable(part);
    if (name.length < 2) return false;
    if (context.artists.includes(squash(part))) return true;
    return /^[ -~]+$/.test(name) ? context.text.includes(` ${name} `) : context.text.includes(name);
  });
}

const durationGap = (record: LrclibRecord, durationMs?: number) => !durationMs ? 0 : typeof record.duration === 'number' ? Math.abs(record.duration - durationMs / 1000) : Infinity;
const KIND_RANK: Record<Lyrics['kind'], number> = { synced: 0, instrumental: 1, plain: 2, none: 3, error: 3 };

type Rated = { lyrics: Lyrics; gap: number; title: boolean; artist: boolean };

function rate(results: LrclibRecord[], context: MatchContext): Rated[] {
  return results.flatMap((record) => {
    const lyrics = fromRecord(record);
    // Synced lines running past the end of the track belong to a longer version.
    if (!lyrics || (lyrics.kind === 'synced' && context.durationMs && lyrics.lines[lyrics.lines.length - 1].timeMs > context.durationMs + 5000)) return [];
    return [{ lyrics, gap: durationGap(record, context.durationMs), title: titleMatches(record, context), artist: artistMatches(record, context) }];
  }).sort((a, b) => Number(b.artist) - Number(a.artist) || Number(b.title) - Number(a.title) || KIND_RANK[a.lyrics.kind] - KIND_RANK[b.lyrics.kind] || a.gap - b.gap);
}

// A result to show in sync. With a duration: within 3 s and the right title or artist, the right artist
// ranking first. Without one, nothing confirms the recording, so title and artist must both match.
export function pickSearchResult(results: LrclibRecord[], context: MatchContext): Lyrics | null {
  const accepted = rate(results, context).filter((rated) => context.durationMs
    ? rated.gap <= DURATION_TOLERANCE_S && (rated.title || rated.artist)
    : rated.title && rated.artist);
  return accepted[0]?.lyrics ?? null;
}

// The same song at another length (a music video with an intro, a radio edit): title and artist both
// match within 90 s, shown unsynced because its timing would be off.
export function pickLooseResult(results: LrclibRecord[], context: MatchContext): Lyrics | null {
  const accepted = rate(results, context).filter((rated) => rated.title && rated.artist && rated.gap <= LOOSE_DURATION_TOLERANCE_S).sort((a, b) => a.gap - b.gap);
  for (const rated of accepted) {
    const plain = asPlain(rated.lyrics);
    if (plain) return plain;
  }
  return null;
}

class RetriableError extends Error {
  waitMs?: number;
  constructor(message: string, waitMs?: number) {
    super(message);
    this.waitMs = waitMs;
  }
}

// LRCLIB answers 503 now and then: up to three attempts, waiting 1 s then 3 s, or as long as it asks.
async function getJson(path: string, params: Record<string, string>, steps: string[]): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getJsonOnce(path, params);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !(error instanceof RetriableError)) throw error;
      const wait = Math.min(MAX_RETRY_WAIT_MS, error.waitMs ?? delay);
      steps.push(`  ${error.message}; retrying in ${wait} ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function getJsonOnce(path: string, params: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Built by hand: React Native's URLSearchParams has been incomplete across versions.
    const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    let response: Response;
    try {
      response = await fetch(`${API}${path}?${query}`, { headers: HEADERS, signal: controller.signal });
    } catch {
      throw new RetriableError(controller.signal.aborted ? 'timed out' : 'network error');
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new RetriableError(`LRCLIB responded ${response.status}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
    }
    // 404 is "no match"; any other 4xx means LRCLIB can't answer this request, which counts the same.
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const describe = (params: Record<string, string>) => Object.entries(params).map(([key, value]) => `${key}="${value}"`).join(' ');

async function lookup(track: LyricsTrack, steps: string[]): Promise<Lyrics> {
  const durationMs = track.durationMs;
  const title = normalizeText(track.title ?? '');
  const artist = normalizeText(track.artist ?? '');
  const album = normalizeText(track.album ?? '');
  // Fallbacks, best first: plain lyrics from a close match, then unsynced text from a looser one.
  let plain: Lyrics | null = null;
  let loosePlain: Lyrics | null = null;
  const accept = (label: string, lyrics: Lyrics | null): Lyrics | null => {
    if (lyrics && lyrics.kind !== 'plain') {
      steps.push(`matched: ${label} (${lyrics.kind})`);
      return lyrics;
    }
    plain ??= lyrics;
    return null;
  };

  const exactAttempts: Record<string, string>[] = [];
  if (artist && durationMs) {
    const duration = String(Math.round(durationMs / 1000));
    exactAttempts.push({ track_name: title, artist_name: artist, album_name: album, duration });
    if (album) exactAttempts.push({ track_name: title, artist_name: artist, duration });
  } else if (artist) {
    exactAttempts.push({ track_name: title, artist_name: artist });
  }
  for (const params of exactAttempts) {
    const record = await getJson('/get', params, steps);
    const lyrics = record && typeof record === 'object' && !Array.isArray(record) ? fromRecord(record as LrclibRecord) : null;
    steps.push(`get ${describe(params)} -> ${lyrics?.kind ?? 'no match'}`);
    const found = accept('exact', lyrics);
    if (found) return found;
  }

  const context = matchContext(track);
  for (const query of searchQueries(track)) {
    const results = await getJson('/search', query.params, steps);
    const list = Array.isArray(results) ? results as LrclibRecord[] : [];
    const lyrics = pickSearchResult(list, context);
    steps.push(`search ${query.label}: ${describe(query.params)} -> ${list.length} results, ${lyrics?.kind ?? 'none usable'}`);
    const found = accept(query.label, lyrics);
    if (found) return found;
    loosePlain ??= pickLooseResult(list, context);
  }
  const fallback: Lyrics = plain ?? loosePlain ?? { kind: 'none' };
  steps.push(`result: ${fallback.kind}${fallback === loosePlain ? ' (unsynced: length or version uncertain)' : ''}`);
  return fallback;
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
  const steps: string[] = [];
  traces.set(key, steps);
  const pending = lookup(track, steps).catch((error: unknown): Lyrics => {
    steps.push(`failed: ${error instanceof Error ? error.message : String(error)}`);
    cache.delete(key);
    return { kind: 'error' };
  });
  cache.set(key, pending);
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
    traces.delete(oldest);
  }
  return pending;
}

// The steps the latest lookup for this track took, for the widget's debug readout.
export function lyricsTrace(track: LyricsTrack): LyricsTrace {
  const key = lyricsTrackKey(track);
  return { key, steps: key ? [...(traces.get(key) ?? [])] : [] };
}
