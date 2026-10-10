// The phone's colors in both looks. Plain data with no React Native imports, so scripts/check-theme.ts can read
// it. Dark is the original look, value for value; light mirrors the desktop app's tokens (pc-companion/src/App.css).
export type ThemeMode = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';

export type Colors = {
  bg: string;
  panel: string;
  panelRaised: string;
  pressed: string;
  border: string;
  borderStrong: string;
  borderActive: string;
  borderFocus: string;
  text: string;
  /** Text and icons on a `accent` button. */
  onAccent: string;
  muted: string;
  faint: string;
  accent: string;
  mint: string;
  /** Text on a `mint` fill. */
  onMint: string;
  red: string;
  blue: string;
  /** How much of the album art shows through behind the Now Playing card (under `tint`). */
  artOpacity: number;
  star: string;
  warn: string;
  /** The same warning as a dot or fill, where it can be as vivid as it likes. */
  warnFill: string;
  warnBorder: string;
  goodBg: string;
  goodBorder: string;
  playingBorder: string;
  /** Behind a sheet or dialog. */
  scrim: string;
  /** Over blurred album art. */
  tint: string;
  /** Floating controls over the deck. */
  float: string;
  floatSoft: string;
};

export const darkColors: Colors = {
  bg: '#09090b',
  panel: '#111113',
  panelRaised: '#18181b',
  pressed: '#27272a',
  border: '#27272a',
  borderStrong: '#3f3f46',
  borderActive: '#52525b',
  borderFocus: '#71717a',
  text: '#fafafa',
  onAccent: '#18181b',
  muted: '#a1a1aa',
  faint: '#71717a',
  accent: '#e4e4e7',
  mint: '#4ade80',
  onMint: '#052e16',
  red: '#f87171',
  blue: '#93c5fd',
  artOpacity: 0.3,
  star: '#facc15',
  warn: '#eab308',
  warnFill: '#eab308',
  warnBorder: '#4a3f10',
  goodBg: '#111a14',
  goodBorder: '#28392d',
  playingBorder: '#14532d',
  scrim: 'rgba(0,0,0,0.6)',
  tint: 'rgba(9, 9, 11, 0.78)',
  float: 'rgba(24,24,27,0.93)',
  floatSoft: 'rgba(24, 24, 27, 0.7)',
};

export const lightColors: Colors = {
  bg: '#ffffff',
  panel: '#fafafa',
  panelRaised: '#f4f4f5',
  pressed: '#e4e4e7',
  border: '#e4e4e7',
  borderStrong: '#d4d4d8',
  borderActive: '#a1a1aa',
  borderFocus: '#8a8a94',
  text: '#18181b',
  onAccent: '#fafafa',
  muted: '#52525b',
  faint: '#686872',
  accent: '#27272a',
  mint: '#15803d',
  onMint: '#ffffff',
  red: '#b91c1c',
  blue: '#2b82ff',
  artOpacity: 0.38,
  star: '#f59e0b',
  warn: '#955a06',
  warnFill: '#f59e0b',
  warnBorder: '#e0b64a',
  goodBg: '#ecfdf3',
  goodBorder: '#b7e4c7',
  playingBorder: '#86d9a5',
  scrim: 'rgba(24,24,27,0.4)',
  tint: 'rgba(255, 255, 255, 0.66)',
  float: 'rgba(255,255,255,0.93)',
  floatSoft: 'rgba(255, 255, 255, 0.7)',
};

export function parseMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** A button icon the PC saved as SVG was saved in the dark deck's light ink: it takes the theme's ink. */
export function inkIcon(svg: string, scheme: Scheme): string {
  return scheme === 'light' ? svg.replace(/stroke="#f4f4f5"/gi, 'stroke="#18181b"') : svg;
}
