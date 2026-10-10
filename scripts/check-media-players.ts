// Run: node scripts/check-media-players.ts
// The phone's side of choosing a media player: trusting the PC's list, deciding when to offer a switch, and
// not getting stuck on a play/pause state the PC never confirmed.
import assert from 'node:assert/strict';
import { canChoosePlayer, expire, offerSwitch, otherPlayersOpen, parsePlayers, playerColor, playerInitial, settle } from '../phone-app/src/media-players.ts';
import type { MediaPlayer, PlayersState } from '../phone-app/src/media-players.ts';

const player = (id: string, state: MediaPlayer['state'], name = id): MediaPlayer => ({ id, name, state });
const state = (controlling: string | null, ...players: MediaPlayer[]): PlayersState => ({ players, controlling, pinned: null, lost: null, canSwitch: true });

// --- Reading the PC's list
{
  const ok = parsePlayers({ type: 'media_players', players: [{ id: 'spotify.exe', name: 'Spotify', state: 'paused', title: 'Father Figure' }, { id: 'chrome.exe', name: 'Chrome', state: 'playing' }], controlling: 'chrome.exe', pinned: 'chrome.exe', lost: null });
  assert.deepEqual(ok?.players.map((item) => item.name), ['Spotify', 'Chrome']);
  assert.equal(ok?.controlling, 'chrome.exe');
  assert.equal(ok?.pinned, 'chrome.exe');
  // A controlled or pinned player that is not in the list is dropped, not trusted.
  const stray = parsePlayers({ players: [{ id: 'a', name: 'A', state: 'playing' }], controlling: 'ghost', pinned: 'ghost', lost: 'Spotify' });
  assert.deepEqual([stray?.controlling, stray?.pinned, stray?.lost], [null, null, 'Spotify']);
  assert.equal(parsePlayers({ players: [] })?.players.length, 0);
  // Anything malformed is refused whole.
  for (const bad of [null, 5, {}, { players: 'x' }, { players: [null] }, { players: [{ id: '', name: 'A', state: 'playing' }] }, { players: [{ id: 'a', name: 'A', state: 'dancing' }] }, { players: [{ id: 'a', name: 'A', state: 'playing' }, { id: 'a', name: 'B', state: 'paused' }] }, { players: Array.from({ length: 17 }, (_, index) => ({ id: `p${index}`, name: 'P', state: 'paused' })) }, { players: [{ id: 'a'.repeat(300), name: 'A', state: 'playing' }] }]) {
    assert.equal(parsePlayers(bad), null);
  }
  // Overlong titles are left out rather than shown cut.
  assert.equal(parsePlayers({ players: [{ id: 'a', name: 'A', state: 'playing', title: 'x'.repeat(500) }] })?.players[0].title, undefined);
}

// --- Where switching is not possible (macOS), none of it is offered
{
  const mac = parsePlayers({ players: [{ id: 'com.apple.Music', name: 'Music', state: 'paused' }], controlling: 'com.apple.Music', canSwitch: false });
  assert.equal(mac?.canSwitch, false);
  assert.equal(canChoosePlayer(mac), false);
  assert.equal(otherPlayersOpen(mac), false);
  // A PC that does not say is treated the same.
  assert.equal(parsePlayers({ players: [], controlling: null })?.canSwitch, false);
  assert.equal(parsePlayers({ players: [], canSwitch: 'yes' })?.canSwitch, false);
  assert.equal(parsePlayers({ players: [], canSwitch: true })?.canSwitch, true);
  // Even with two players reported and one starting, no toast.
  const before = { ...state('a', player('a', 'playing')), canSwitch: false };
  const after = { ...state('a', player('a', 'playing'), player('b', 'playing')), canSwitch: false };
  assert.equal(offerSwitch(before, after, new Set()).player, null);
  assert.equal(canChoosePlayer(null), false);
}

// --- When to offer a switch
{
  const spotifyOnly = state('spotify', player('spotify', 'playing'));
  const chromeStarts = state('spotify', player('spotify', 'playing'), player('chrome', 'playing', 'Chrome'));
  const first = offerSwitch(spotifyOnly, chromeStarts, new Set());
  assert.equal(first.player?.name, 'Chrome');
  // Offered once: while Chrome keeps playing, no second toast.
  assert.equal(offerSwitch(chromeStarts, chromeStarts, first.seen).player, null);
  // Once Chrome stops and starts again, it is offered again.
  const stopped = state('spotify', player('spotify', 'playing'), player('chrome', 'paused'));
  const afterStop = offerSwitch(chromeStarts, stopped, first.seen);
  assert.equal(afterStop.player, null);
  assert.equal(offerSwitch(stopped, chromeStarts, afterStop.seen).player?.name, 'Chrome');
  // The first report after connecting is a situation, not an event.
  assert.equal(offerSwitch(null, chromeStarts, new Set()).player, null);
  // ...but it counts as seen, so it does not pop up a moment later.
  assert.equal(offerSwitch(chromeStarts, chromeStarts, offerSwitch(null, chromeStarts, new Set()).seen).player, null);
  // Nothing to switch from: no offer. The controlled player itself is never offered.
  assert.equal(offerSwitch(spotifyOnly, state(null, player('spotify', 'playing'), player('chrome', 'playing')), new Set()).player, null);
  assert.equal(offerSwitch(state('spotify', player('spotify', 'paused')), state('spotify', player('spotify', 'playing')), new Set()).player, null);
  // After the person switches to Chrome, Spotify (already playing) is not offered back.
  const switched = state('chrome', player('spotify', 'playing'), player('chrome', 'playing'));
  assert.equal(offerSwitch(chromeStarts, switched, new Set()).player, null);
  // Two start at once: one offer, and the other is remembered.
  const twoNew = offerSwitch(spotifyOnly, state('spotify', player('spotify', 'playing'), player('a', 'playing'), player('b', 'playing')), new Set());
  assert.equal(twoNew.player?.id, 'a');
  assert.deepEqual([...twoNew.seen].sort(), ['a', 'b']);
}

// --- Not getting stuck on a guess
{
  const t0 = 10_000;
  const expected = { state: 'playing' as const, until: t0 + 1500 };
  // Inside the window, a report that disagrees is held back; one that agrees is shown.
  assert.deepEqual(settle(expected, 'paused', t0 + 200), { show: null, expected });
  assert.deepEqual(settle(expected, 'playing', t0 + 200), { show: 'playing', expected });
  // After the window the PC's report simply wins.
  assert.deepEqual(settle(expected, 'paused', t0 + 1600), { show: 'paused', expected: null });
  assert.deepEqual(settle(null, 'stopped', t0), { show: 'stopped', expected: null });
  // The key press did nothing and the PC says nothing new: when the window ends, go back to what it last said.
  assert.deepEqual(expire(expected, 'paused', t0 + 1600), { show: 'paused', expected: null });
  assert.deepEqual(expire(expected, null, t0 + 1600), { show: null, expected: null });
  assert.deepEqual(expire(expected, 'paused', t0 + 1000), { show: null, expected });
  assert.deepEqual(expire(null, 'paused', t0 + 5000), { show: null, expected: null });
}

// --- Small helpers
assert.equal(playerInitial('spotify'), 'S');
assert.equal(playerInitial('  éclair'), 'É');
assert.equal(playerInitial(''), '?');
assert.equal(playerColor('spotify.exe'), playerColor('spotify.exe'));
assert.ok(/^#[0-9a-f]{6}$/.test(playerColor('chrome.exe')));
assert.equal(otherPlayersOpen(null), false);
assert.equal(otherPlayersOpen(state('a', player('a', 'playing'))), false);
assert.equal(otherPlayersOpen(state('a', player('a', 'playing'), player('b', 'paused'))), true);
assert.equal(canChoosePlayer(state('a', player('a', 'playing'))), true);

console.log('check-media-players: ok');
