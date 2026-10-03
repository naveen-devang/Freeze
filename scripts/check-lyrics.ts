// Run: node scripts/check-lyrics.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeLineAt, cleanArtist, cleanTitle, isGapLine, lyricsTrackKey, parseLrc, pickSearchResult, searchQueries, withIntroGap } from '../phone-app/src/lyrics.ts';

assert.equal(
  readFileSync(new URL('../phone-app/src/lyrics.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../pc-companion/src/lyrics.ts', import.meta.url), 'utf8'),
  'phone-app and pc-companion copies of lyrics.ts differ',
);

// LRC parsing: fractions of any length, repeated stamps, metadata tags, word-sync tags, gap lines.
const lines = parseLrc('[ar:The Weeknd]\n[00:13.13] Yeah\r\n[00:16.56] ♪\n[00:27.1]I\'ve been <00:27.50>tryna call\n[01:02.123][00:20.00] Twice\nno stamp\n[00:30:50] Colon fraction');
assert.deepEqual(lines, [
  { timeMs: 13130, text: 'Yeah' },
  { timeMs: 16560, text: '♪' },
  { timeMs: 20000, text: 'Twice' },
  { timeMs: 27100, text: 'I\'ve been tryna call' },
  { timeMs: 30500, text: 'Colon fraction' },
  { timeMs: 62123, text: 'Twice' },
]);
assert.ok(isGapLine(lines[1]));
assert.ok(isGapLine({ timeMs: 0, text: '' }));
assert.ok(!isGapLine(lines[0]));

// The active line is the last one that has started.
assert.equal(activeLineAt(lines, 0), -1);
assert.equal(activeLineAt(lines, 13129), -1);
assert.equal(activeLineAt(lines, 13130), 0);
assert.equal(activeLineAt(lines, 26000), 2);
assert.equal(activeLineAt(lines, 999_999), lines.length - 1);
assert.equal(activeLineAt([], 1000), -1);

// A late first line gets an intro gap; an early one doesn't.
assert.equal(withIntroGap(lines)[0].timeMs, 0);
assert.equal(withIntroGap(lines).length, lines.length + 1);
assert.equal(withIntroGap([{ timeMs: 4000, text: 'Hi' }]).length, 1);

// Video-style titles and channel names.
assert.equal(cleanTitle('Blinding Lights (Official Video)'), 'Blinding Lights');
assert.equal(cleanTitle('Song [4K] (Lyric Video) ft. Someone'), 'Song');
assert.equal(cleanTitle('Song (feat. Someone)'), 'Song');
assert.equal(cleanTitle('Song (Remastered 2011)'), 'Song (Remastered 2011)');
assert.equal(cleanTitle('Craft. Beer'), 'Craft. Beer');
assert.equal(cleanArtist('The Weeknd - Topic'), 'The Weeknd');
assert.equal(cleanArtist('TheWeekndVEVO'), 'TheWeeknd');
assert.deepEqual(searchQueries({ title: 'The Weeknd - Blinding Lights (Official Audio)', artist: 'TheWeekndVEVO' }), [
  { track: 'The Weeknd - Blinding Lights', artist: 'TheWeeknd' },
  { track: 'Blinding Lights', artist: 'The Weeknd' },
]);
assert.deepEqual(searchQueries({ title: 'Song', artist: 'Artist' }), [{ track: 'Song', artist: 'Artist' }]);

// Lookups are skipped for things that can't be songs.
assert.equal(lyricsTrackKey({ title: 'How to fix a bike', durationMs: 600_000 }), null);
assert.equal(lyricsTrackKey({ title: 'Clip', artist: 'A', durationMs: 20_000 }), null);
assert.equal(lyricsTrackKey({ title: 'Stream', artist: 'A', durationMs: 3_600_000 }), null);
assert.equal(lyricsTrackKey({ title: 'Song', artist: 'A' }), null);
assert.ok(lyricsTrackKey({ title: 'Song', artist: 'A', durationMs: 200_000 }));

// Search results: nearest duration within 3 s, synced before plain.
const synced = (duration: number, text = 'Line') => ({ duration, syncedLyrics: `[00:01.00] ${text}
[00:02.00] Two
[00:03.00] Three`, plainLyrics: `${text}
Two
Three` });
assert.deepEqual(pickSearchResult([synced(248, 'far'), synced(202, 'near'), synced(200, 'exact')], 200_400), { kind: 'synced', lines: [{ timeMs: 1000, text: 'exact' }, { timeMs: 2000, text: 'Two' }, { timeMs: 3000, text: 'Three' }] });
assert.equal(pickSearchResult([synced(210)], 200_000), null);
assert.deepEqual(pickSearchResult([{ duration: 200, plainLyrics: 'A\nB\nC' }, synced(201, 'sync')], 200_000)?.kind, 'synced');
assert.deepEqual(pickSearchResult([{ duration: 200, plainLyrics: 'A\r\n\r\nB\nC', syncedLyrics: null }], 200_000), { kind: 'plain', text: 'A\r\n\r\nB\nC' });
// Junk test entries are skipped in favour of real ones.
assert.equal(pickSearchResult([{ duration: 214, syncedLyrics: '[00:00.00]probe', plainLyrics: 'probe' }], 214_000), null);
assert.deepEqual(pickSearchResult([{ duration: 214, syncedLyrics: '[00:00.00]probe', plainLyrics: 'probe' }, synced(213, 'real')], 214_000)?.kind, 'synced');
assert.deepEqual(pickSearchResult([{ duration: 200, instrumental: true, syncedLyrics: null, plainLyrics: null }], 200_000), { kind: 'instrumental' });
// Synced lyrics made only of gap lines are not lyrics.
assert.equal(pickSearchResult([{ duration: 200, syncedLyrics: '[00:01.00] ♪' }], 200_000), null);

console.log('lyrics checks passed');
