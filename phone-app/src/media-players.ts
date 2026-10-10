// Which media players the PC reports, and the small decisions the phone makes about them. No screen code in
// here, so scripts/check-media-players.ts can test every case.

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'unavailable';
export type MediaPlayer = { id: string; name: string; state: PlaybackState; title?: string; artist?: string };
// `canSwitch` is false where the PC reports one app only (macOS), and for a PC that does not say.
// `controlling` is the player the buttons and the widget follow, `pinned` is set when the person chose one,
// and `lost` names a pinned player that closed (until they choose again).
export type PlayersState = { players: MediaPlayer[]; controlling: string | null; pinned: string | null; lost: string | null; canSwitch: boolean };

const STATES: PlaybackState[] = ['playing', 'paused', 'stopped', 'unavailable'];
const MAX_PLAYERS = 16;

const text = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

// A media_players message from the PC, or null if it is not one the phone should trust.
export function parsePlayers(message: unknown): PlayersState | null {
  if (!message || typeof message !== 'object') return null;
  const value = message as Record<string, unknown>;
  if (!Array.isArray(value.players) || value.players.length > MAX_PLAYERS) return null;
  const players: MediaPlayer[] = [];
  for (const entry of value.players) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    const id = text(item.id, 256);
    const name = text(item.name, 64);
    if (!id || !name || typeof item.state !== 'string' || !STATES.includes(item.state as PlaybackState)) return null;
    if (players.some((known) => known.id === id)) return null;
    players.push({ id, name, state: item.state as PlaybackState, title: text(item.title, 240), artist: text(item.artist, 240) });
  }
  const known = (id: unknown) => typeof id === 'string' && players.some((player) => player.id === id) ? id : null;
  return { players, controlling: known(value.controlling), pinned: known(value.pinned), lost: text(value.lost, 64) ?? null, canSwitch: value.canSwitch === true };
}

// Whether to offer switching: a player other than the one being controlled has just started playing. It is
// offered once per player and again only after that player has stopped, and never on the first report after
// connecting (that is a situation, not an event).
export function offerSwitch(previous: PlayersState | null, next: PlayersState, seen: ReadonlySet<string>): { player: MediaPlayer | null; seen: Set<string> } {
  // Where switching is not possible, nothing is offered.
  if (!next.canSwitch) return { player: null, seen: new Set() };
  const playingElsewhere = next.players.filter((player) => player.state === 'playing' && player.id !== next.controlling);
  const stillSeen = new Set([...seen].filter((id) => playingElsewhere.some((player) => player.id === id)));
  let offer: MediaPlayer | null = null;
  for (const player of playingElsewhere) {
    if (stillSeen.has(player.id)) continue;
    stillSeen.add(player.id);
    const wasPlaying = previous?.players.some((old) => old.id === player.id && old.state === 'playing') ?? true;
    if (!offer && previous && next.controlling && !wasPlaying) offer = player;
  }
  return { player: offer, seen: stillSeen };
}

// A press on play/pause is shown at once, and trusted for a moment; after that the PC's own report wins.
export type Expectation = { state: PlaybackState; until: number } | null;

// The state to show for a report from the PC, or null to keep the pressed state a little longer.
export function settle(expected: Expectation, reported: PlaybackState, now: number): { show: PlaybackState | null; expected: Expectation } {
  if (!expected) return { show: reported, expected: null };
  if (now > expected.until) return { show: reported, expected: null };
  return { show: reported === expected.state ? reported : null, expected };
}

// The pressed state ran out without the PC confirming it (the key did nothing, or it took too long): go back
// to the last thing the PC actually said. This is what stops a wrong guess from lasting.
export function expire(expected: Expectation, lastReported: PlaybackState | null, now: number): { show: PlaybackState | null; expected: Expectation } {
  if (!expected || now <= expected.until) return { show: null, expected };
  return { show: lastReported, expected: null };
}

export function playerInitial(name: string): string {
  const letter = [...name.trim()][0];
  return letter ? letter.toUpperCase() : '?';
}

const PALETTE = ['#1db954', '#f59e0b', '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf', '#fb923c', '#94a3b8'];
// The same player always gets the same color.
export function playerColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

// Whether to show the choice of player at all: more than a name label.
export const canChoosePlayer = (state: PlayersState | null): boolean => state?.canSwitch === true;

export const otherPlayersOpen = (state: PlayersState | null): boolean => canChoosePlayer(state) && (state?.players.length ?? 0) > 1;
