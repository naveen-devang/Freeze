// Run: node scripts/check-lyrics.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeLineAt, artistMatches, cleanArtist, cleanTitle, isGapLine, latinArtist, latinPart, lyricsTrackKey, matchAlias, matchContext, nativePart, nativeSongTitle, normalizeText, parseLrc, pickLooseResult, pickSearchResult, quotedSong, romanize, searchQueries, soundKey, timingVersions, titleMatches, withIntroGap } from '../phone-app/src/lyrics.ts';

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

// Unicode clean-up: decomposed accents, full-width letters, invisible characters, odd spacing.
assert.equal(normalizeText('Beyonce\u0301'), 'Beyoncé');
assert.equal(normalizeText('ＹＯＡＳＯＢＩ'), 'YOASOBI');
assert.equal(normalizeText('Ha\u200blo\ufeff \u00a0 Song\u00ad'), 'Halo Song');
assert.equal(normalizeText('夜に駆ける'), '夜に駆ける');

// Video-style titles from real uploads.
const titles: [string, string][] = [
  ['Blinding Lights (Official Video)', 'Blinding Lights'],
  ['Song [4K] (Lyric Video) ft. Someone', 'Song'],
  ['Song (feat. Someone)', 'Song'],
  ['Song (Official)', 'Song'],
  ['Song (Remastered 2011)', 'Song (Remastered 2011)'],
  ['Song (Remix)', 'Song (Remix)'],
  ['Craft. Beer', 'Craft. Beer'],
  ['Kesariya - Brahmāstra | Ranbir Kapoor | Alia Bhatt | Pritam | Arijit Singh', 'Kesariya - Brahmāstra'],
  ['Full Video: Kesariya | Brahmāstra', 'Kesariya'],
  ['Lyrical: Tum Hi Ho | Aashiqui 2', 'Tum Hi Ho'],
  ['Kesariya (From "Brahmastra")', 'Kesariya'],
  ['Apna Bana Le - Bhediya | Varun Dhawan, Kriti Sanon | Sachin-Jigar, Arijit Singh', 'Apna Bana Le - Bhediya'],
  ['NewJeans (뉴진스) \'Super Shy\' Official MV', 'NewJeans (뉴진스) \'Super Shy\''],
  ['夜に駆ける (Official Music Video)', '夜に駆ける'],
  ['🔥 Song Name 🔥 #shorts #trending', 'Song Name'],
  ['Ｓｏｎｇ\u200b (Ｏｆｆｉｃｉａｌ Ｖｉｄｅｏ)', 'Song'],
];
for (const [raw, expected] of titles) assert.equal(cleanTitle(raw), expected, raw);
assert.equal(cleanTitle('Song M/V'), 'Song');
assert.equal(cleanTitle('Song Official MV'), 'Song');
assert.equal(cleanTitle('Video Killed the Radio Star'), 'Video Killed the Radio Star');

// Quoted song names in K-pop / J-pop uploads; apostrophes inside words never count as quotes.
const quoted: [string, ReturnType<typeof quotedSong>][] = [
  ["MEOVV(미야오) - 'In my hands' M/V", { title: 'In my hands', artist: 'MEOVV' }],
  ["aespa エスパ 'KISS N TELL' MV", { title: 'KISS N TELL', artist: 'aespa エスパ' }],
  ["aespa 에스파 'Switchblade (Feat. Ty Dolla $ign)' MV", { title: 'Switchblade', artist: 'aespa 에스파' }],
  ["ILLIT (아일릿) 'It's Me' Official MV", { title: "It's Me", artist: 'ILLIT' }],
  ['YOASOBI「アイドル」Official Music Video', { title: 'アイドル', artist: 'YOASOBI' }],
  ['NewJeans (뉴진스) ‘Super Shy’ Official MV', { title: 'Super Shy', artist: 'NewJeans' }],
  ["Don't Start Now", null],
  ["Rock 'n' Roll Song", null],
];
for (const [raw, expected] of quoted) assert.deepEqual(quotedSong(raw), expected, raw);
assert.deepEqual(searchQueries({ title: "aespa エスパ 'KISS N TELL' MV", artist: 'SMTOWN' }).slice(1, 5).map((query) => query.params), [
  { track_name: 'KISS N TELL', artist_name: 'aespa エスパ' },
  { track_name: 'KISS N TELL', artist_name: 'aespa' },
  { track_name: 'KISS N TELL', artist_name: 'SMTOWN' },
  { track_name: 'KISS N TELL' },
]);
assert.equal(cleanArtist('The Weeknd - Topic'), 'The Weeknd');
assert.equal(cleanArtist('TheWeekndVEVO'), 'TheWeeknd');
assert.equal(cleanArtist('Arijit Singh feat. Someone'), 'Arijit Singh');

// Search steps, most specific first.
const steps = (title: string, artist: string) => searchQueries({ title, artist }).map((query) => [query.label, query.params]);
assert.deepEqual(steps('Song', 'Artist'), [
  ['title + artist', { track_name: 'Song', artist_name: 'Artist' }],
  ['title only', { track_name: 'Song' }],
  ['free text', { q: 'Song Artist' }],
]);
assert.deepEqual(steps('Starboy', 'The Weeknd, Daft Punk'), [
  ['title + artist', { track_name: 'Starboy', artist_name: 'The Weeknd, Daft Punk' }],
  ['title + first artist', { track_name: 'Starboy', artist_name: 'The Weeknd' }],
  ['title only', { track_name: 'Starboy' }],
  ['free text', { q: 'Starboy The Weeknd' }],
]);
assert.deepEqual(steps('Kesariya - Brahmāstra | Ranbir Kapoor', 'Sony Music India').map(([label]) => label), [
  'title + artist', 'right half + left half as artist', 'left half only', 'right half only', 'title only', 'free text',
]);
assert.deepEqual(searchQueries({ title: 'Kesariya - Brahmāstra | Ranbir Kapoor', artist: 'Sony Music India' })[2].params, { track_name: 'Kesariya' });
assert.deepEqual(steps('The Weeknd - Blinding Lights (Official Audio)', 'TheWeekndVEVO').slice(0, 2), [
  ['title + artist', { track_name: 'The Weeknd - Blinding Lights', artist_name: 'TheWeeknd' }],
  ['right half + left half as artist', { track_name: 'Blinding Lights', artist_name: 'The Weeknd' }],
]);
assert.deepEqual(steps('Song', '').map(([label]) => label), ['title only', 'free text']);

// Track keys: a missing duration still allows a lookup; clips, long streams and untitled media don't.
assert.ok(lyricsTrackKey({ title: 'Song', artist: 'A' }));
assert.ok(lyricsTrackKey({ title: 'Song' }));
assert.notEqual(lyricsTrackKey({ title: 'Song', artist: 'A' }), lyricsTrackKey({ title: 'Song', artist: 'A', durationMs: 200_000 }));
assert.equal(lyricsTrackKey({ title: 'Clip', artist: 'A', durationMs: 20_000 }), null);
assert.equal(lyricsTrackKey({ title: 'Stream', artist: 'A', durationMs: 3_600_000 }), null);
assert.equal(lyricsTrackKey({ artist: 'A', durationMs: 200_000 }), null);
assert.equal(lyricsTrackKey({ title: 'Beyonce\u0301', durationMs: 200_000 }), lyricsTrackKey({ title: 'Beyoncé', durationMs: 200_000 }));

const asLines = (lyrics: ReturnType<typeof pickSearchResult>) => lyrics?.kind === 'synced' ? lyrics.lines.map((line) => line.text) : null;
// Search results are checked against the track: duration, title and artist.
const record = (trackName: string, artistName: string, duration: number | null, text = 'Line') =>
  ({ trackName, artistName, duration, syncedLyrics: `[00:01.00] ${text}\n[00:02.00] Two\n[00:03.00] Three`, plainLyrics: `${text}\nTwo\nThree` });
const pick = (results: object[], track: Parameters<typeof matchContext>[0]) => pickSearchResult(results, matchContext(track));
const loosePick = (results: object[], track: Parameters<typeof matchContext>[0]) => pickLooseResult(results, matchContext(track));
const song = { title: 'Song', artist: 'Artist', durationMs: 200_400 };

// Nearest duration within 3 s wins, synced before plain.
assert.deepEqual(asLines(pick([record('Song', 'Artist', 248, 'far'), record('Song', 'Artist', 202, 'near'), record('Song', 'Artist', 200, 'exact')], song)), ['exact', 'Two', 'Three']);
assert.equal(pick([record('Song', 'Artist', 210)], song), null);
assert.equal(pick([record('Song', 'Artist', null)], song), null);
assert.equal(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, plainLyrics: 'A\nB\nC' }, record('Song', 'Artist', 201, 'sync')], song)?.kind, 'synced');
assert.deepEqual(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, plainLyrics: 'A\r\n\r\nB\nC', syncedLyrics: null }], song), { kind: 'plain', text: 'A\r\n\r\nB\nC' });
assert.deepEqual(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, instrumental: true, syncedLyrics: null, plainLyrics: null }], song), { kind: 'instrumental' });
// Junk test entries and gap-only lyrics are not lyrics.
assert.equal(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:00.00]probe', plainLyrics: 'probe' }], song), null);
assert.equal(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:00.00]probe', plainLyrics: 'probe' }, record('Song', 'Artist', 200, 'real')], song)?.kind, 'synced');
assert.equal(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:01.00] ♪' }], song), null);
// Synced lines running past the end of the track are a longer version.
assert.equal(pick([{ trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:01.00] A\n[00:02.00] B\n[03:40.00] C' }], song), null);

// Within 3 s a result needs the right title or artist; the right artist ranks first.
assert.equal(pick([record('Other Song', 'Someone Else', 200)], song), null);
assert.equal(pick([record('Switchblade', 'Some Rock Band', 200, 'wrong'), record('Switchblade', 'aespa', 201, 'right')], { title: "aespa 에스파 'Switchblade' MV", artist: 'SMTOWN', durationMs: 200_000 })?.kind, 'synced');
assert.deepEqual(asLines(pick([record('Switchblade', 'Some Rock Band', 200, 'wrong'), record('Switchblade', 'aespa', 201, 'right')], { title: "aespa 에스파 'Switchblade' MV", artist: 'SMTOWN', durationMs: 200_000 })), ['right', 'Two', 'Three']);
// A label channel: the artist is only named in the video title.
assert.equal(pick([record('Kesariya', 'Arijit Singh', 268)], { title: 'Kesariya - Brahmāstra | Ranbir Kapoor | Pritam | Arijit Singh', artist: 'Sony Music India', durationMs: 268_000 })?.kind, 'synced');
// A channel name with the spaces dropped still names the artist.
assert.equal(pick([record('Blinding Lights', 'The Weeknd', 400)], { title: 'Blinding Lights (Official Video)', artist: 'TheWeekndVEVO' })?.kind, 'synced');

// Without a duration, title and artist must both match.
assert.equal(pick([record('Song', 'Someone Else', 200)], { title: 'Song', artist: 'Artist' }), null);
assert.equal(pick([record('song', 'artist', null)], { title: 'Song', artist: 'Artist' })?.kind, 'synced');
assert.equal(pick([record('Kesariya (From "Brahmastra")', 'Arijit Singh', 270)], { title: 'Kesariya', artist: 'Arijit Singh' })?.kind, 'synced');
assert.equal(pick([record('Kesariya (Dance Mix)', 'Arijit Singh', 197)], { title: 'Kesariya', artist: 'Arijit Singh' }), null);
assert.equal(pick([record('Kesariyaa', 'Arijit Singh', 270)], { title: 'Kesariya', artist: 'Arijit Singh' }), null);
assert.equal(pick([record('Kesariya', 'Arijit Singh', 270)], { title: 'Full Video: Kesariya | Brahmāstra', artist: 'Sony Music India' }), null);

// The same song at another length (a music video with an intro) is shown unsynced, only with title and artist both matching.
const switchbladeVideo = { title: "aespa 에스파 'Switchblade (Feat. Ty Dolla $ign)' MV", artist: 'SMTOWN', durationMs: 200_000 };
const otherSwitchblade = record('Switchblade', 'Some Rock Band', 214, 'You are no victim');
const aespaSwitchblade = record('Switchblade (feat. Ty Dolla $ign)', 'aespa & Ty Dolla $ign', 182, 'Take it back');
assert.equal(pick([otherSwitchblade, aespaSwitchblade], switchbladeVideo), null);
const switchbladePlain = loosePick([otherSwitchblade, aespaSwitchblade], switchbladeVideo);
assert.equal(switchbladePlain?.kind === 'plain' && switchbladePlain.text, 'Take it back\nTwo\nThree');
// Its synced timing still comes along, for the widget to offer.
assert.equal(switchbladePlain?.kind === 'plain' && switchbladePlain.versions?.length, 1);
assert.equal(loosePick([otherSwitchblade], switchbladeVideo), null);
assert.equal(loosePick([record('Song', 'Artist', 300)], { title: 'Song', artist: 'Artist', durationMs: 200_000 }), null);
const nearest = loosePick([record('Song', 'Artist', 280, 'far'), record('Song', 'Artist', 230, 'near')], { title: 'Song', artist: 'Artist', durationMs: 200_000 });
assert.equal(nearest?.kind === 'plain' && nearest.text, 'near\nTwo\nThree');

// Artist names: whole words for Latin names, anywhere for other scripts, any of several artists.
const artistOf = (artistName: string, track: Parameters<typeof matchContext>[0]) => artistMatches({ artistName }, matchContext(track));
assert.ok(artistOf('aespa 및 Ty Dolla $ign', { title: "aespa 'Switchblade' MV", artist: 'SMTOWN' }));
assert.ok(artistOf('Pritam, Arijit Singh', { title: 'Kesariya | Arijit Singh', artist: 'Sony Music India' }));
assert.ok(artistOf('미야오', { title: 'MEOVV(미야오) - In my hands', artist: 'THEBLACKLABEL' }));
assert.ok(!artistOf('Rain', { title: 'Brainstorm', artist: 'Someone' }));
assert.ok(!artistOf('A', { title: 'A Song', artist: 'B' }));
assert.ok(titleMatches({ trackName: 'In My Hands' }, matchContext({ title: "MEOVV(미야오) - 'In my hands' M/V" })));
assert.ok(!titleMatches({ trackName: 'Me' }, matchContext({ title: "ILLIT 'It's Me' MV" })));

// Timing versions, from aespa 'KISS N TELL' as LRCLIB holds it: eleven entries with the album's timing
// (first line 8.0 s) under all sorts of listed lengths, two of them the music video's 190 s, and one
// entry timed to the video (first line 17.1 s) listed at the album's 166 s.
const stamp = (totalS: number) => `[${String(Math.floor(totalS / 60)).padStart(2, '0')}:${(totalS % 60).toFixed(2).padStart(5, '0')}]`;
// Four lines spread evenly from the first to the last sung line.
const timed = (firstS: number, lastS: number) => [0, 1, 2, 3].map((step) => `${stamp(firstS + (lastS - firstS) * step / 3)} line ${step}`).join('\n');
assert.equal(stamp(160.28), '[02:40.28]');
const kissNTell = (duration: number | null, firstS: number, lastS: number) => ({ trackName: 'KISS N TELL', artistName: 'aespa', duration, syncedLyrics: timed(firstS, lastS), plainLyrics: 'line 0\nline 1\nline 2\nline 3' });
const kissEntries = [
  ...[166, 166, 166, 190, 190, 218, 75, 230, 160, 154, null].map((duration) => kissNTell(duration, 8, 160.28)),
  kissNTell(166, 17.1, 161.16),
];
const firstLine = (lyrics: ReturnType<typeof pickSearchResult>) => lyrics?.kind === 'synced' ? lyrics.lines[0].timeMs : null;
assert.deepEqual(timingVersions(kissEntries.map((entry) => parseLrc(entry.syncedLyrics))).map((version) => [version.firstMs, version.entries]), [[8000, 11], [17100, 1]]);
// The music video (its title says MV) takes the timing that starts later, by its intro.
const kissVideo = pick(kissEntries, { title: "aespa エスパ 'KISS N TELL' MV", artist: 'SMTOWN', durationMs: 190_000 });
assert.equal(firstLine(kissVideo), 17100);
assert.match(kissVideo?.kind === 'synced' ? kissVideo.reason ?? '' : '', /music video/);
assert.equal(kissVideo?.kind === 'synced' && kissVideo.versions?.length, 2);
// The song itself (Spotify, 166 s) takes the timing most matching entries share.
assert.equal(firstLine(pick(kissEntries, { title: 'KISS N TELL', artist: 'aespa', durationMs: 166_000 })), 8000);
// No video words in the title, but 24 s longer than the length the entries list: still a video.
assert.equal(firstLine(pick(kissEntries, { title: 'KISS N TELL', artist: 'aespa', durationMs: 190_000 })), 17100);
// A video whose extras are only at the end has one timing, and keeps it.
assert.equal(firstLine(pick(kissEntries.slice(0, 11), { title: "aespa 'KISS N TELL' MV", artist: 'SMTOWN', durationMs: 190_000 })), 8000);
// A timing starting over a minute late is someone's mistake, not an intro.
assert.equal(firstLine(pick([...kissEntries.slice(0, 11), kissNTell(166, 75, 100)], { title: "aespa 'KISS N TELL' MV", artist: 'SMTOWN', durationMs: 190_000 })), 8000);

// Song names in another script. Loanword titles are compared by sound: Hangul, kana and Devanagari are
// spelled out in Latin letters, then reduced to a consonant key both sides share.
assert.equal(romanize('캐치 캐치'), 'kaechi kaechi');
assert.equal(romanize('アイドル'), 'aidoru');
assert.equal(romanize('केसरिया'), 'kasraya');
assert.equal(romanize('夜に駆ける'), null);
for (const [native, english] of [['캐치 캐치', 'Catch Catch'], ['하입보이', 'Hype Boy'], ['해야', 'HEYA'], ['뚜두뚜두', 'DDU-DU DDU-DU'], ['넥스트 레벨', 'Next Level'], ['러브 다이브', 'LOVE DIVE'], ['アイドル', 'Idol'], ['केसरिया', 'Kesariya']]) {
  assert.equal(soundKey(romanize(native) ?? ''), soundKey(english), `${native} ~ ${english}`);
}
for (const [native, other] of [['좋은 날', 'Good Day'], ['캐치 캐치', 'SMILEY'], ['넥스트 레벨', 'Lucid Dream']]) {
  assert.notEqual(soundKey(romanize(native) ?? ''), soundKey(other), `${native} !~ ${other}`);
}
// Titles in two scripts split into halves.
assert.equal(latinPart('좋은 날(Good Day)'), 'Good Day');
assert.equal(latinPart('해야 (HEYA)'), 'HEYA');
assert.equal(latinPart('뚜두뚜두_DDU-DU DDU-DU'), 'DDU-DU DDU-DU');
assert.equal(latinPart('YENA(최예나)'), 'YENA');
assert.equal(latinPart('캐치 캐치'), '');
assert.equal(nativePart('해야 (HEYA)'), '해야');
// The song name and the artist's Latin name, from the video title before the channel.
assert.equal(nativeSongTitle({ title: "YENA(최예나) - '캐치 캐치' M/V" }), '캐치 캐치');
assert.equal(nativeSongTitle({ title: '[MV] IU(아이유) _ 좋은 날(Good Day)' }), '좋은 날(Good Day)');
assert.equal(nativeSongTitle({ title: 'Blinding Lights' }), null);
assert.equal(latinArtist({ title: "YENA(최예나) - '캐치 캐치' M/V", artist: 'YENA(최예나)' }), 'YENA');
assert.equal(latinArtist({ title: '[MV] IU(아이유) _ 좋은 날(Good Day)', artist: '1theK (원더케이)' }), 'IU');
assert.equal(latinArtist({ title: '좋은 날', artist: 'IU' }), 'IU');

// Finding the Latin title among the artist's songs, only when exactly one fits.
const yenaSongs = [{ title: 'SMILEY (feat. BIBI)', durationS: 174 }, { title: 'Catch Catch', durationS: 180 }, { title: 'Catch Catch', durationS: 189 }, { title: 'NEMONEMO', durationS: 178 }];
assert.deepEqual(matchAlias('캐치 캐치', yenaSongs, 205_000), { title: 'Catch Catch', how: 'sounds the same (kaechi kaechi)' });
assert.deepEqual(matchAlias('해야', [{ title: '해야 (HEYA)', durationS: 189 }, { title: 'LOVE DIVE', durationS: 177 }]), { title: 'HEYA', how: 'title in both scripts' });
// A short sound key ("해야" has none) needs a fitting length too, and a unique one.
assert.equal(matchAlias('해야', [{ title: 'HEYA', durationS: 189 }, { title: 'After LIKE', durationS: 177 }]), null);
assert.equal(matchAlias('해야', [{ title: 'HEYA', durationS: 189 }, { title: 'After LIKE', durationS: 177 }], 190_000)?.title, 'HEYA');
assert.equal(matchAlias('해야', [{ title: 'HEYA', durationS: 189 }, { title: 'Aye', durationS: 190 }], 190_000), null);
// A real translation only by a unique catalogued length.
const iuSongs = [{ title: 'Good Day', durationS: 234 }, { title: 'BBIBBI', durationS: 208 }, { title: 'Love wins all', durationS: 271 }];
assert.equal(matchAlias('좋은 날', iuSongs, 236_000), null);
assert.deepEqual(matchAlias('좋은 날', iuSongs, 236_000, [233.52]), { title: 'Good Day', how: 'same length as the recording under its native title' });
assert.equal(matchAlias('좋은 날', [...iuSongs, { title: 'Ending Scene', durationS: 233 }], 236_000, [233.52]), null);

// "A - B" where A is the artist in another script: a song named like A must not stand in, unsynced, for B.
const iuWrong = { trackName: '아이유', artistName: 'IU', duration: 200, syncedLyrics: '[00:01.00] Woogie on and on\n[00:02.00] Two\n[00:03.00] Three', plainLyrics: 'Woogie on and on\nTwo\nThree' };
assert.equal(loosePick([iuWrong], { title: '아이유 - 좋은 날', artist: 'IU', durationMs: 234_000 }), null);
assert.equal(pick([iuWrong], { title: '아이유 - 좋은 날', artist: 'IU' }), null);
// The found Latin title counts as the song's title when checking results.
assert.ok(titleMatches({ trackName: 'Catch Catch' }, matchContext({ title: "YENA(최예나) - '캐치 캐치' M/V" }, { title: 'Catch Catch', artist: 'YENA' }), true));
assert.equal(cleanTitle('[MV] IU(아이유) _ 좋은 날(Good Day)'), 'IU(아이유) - 좋은 날(Good Day)');

console.log('lyrics checks passed');
