// Run: node scripts/check-quiet-processes.ts
// On Windows a helper process opens a console window unless it is told not to. A window flashing up (or one per
// icon in the app picker) makes the app unusable, so every Windows helper process must go through `quiet`, or set
// the no-window flag itself. This reads the Rust sources and fails when one does not.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'pc-companion', 'src-tauri', 'src');
// Programs that run with a console on Windows. explorer.exe and the user's own app are GUI programs and stay as they are.
const CONSOLE_PROGRAMS = /^(powershell|pwsh|py|python|python3|cmd|hostname|where|reg|wmic|taskkill|tasklist|nvidia-smi|ping|ipconfig|netsh|sc|adb)(\.exe)?$/i;
const CREATE_NO_WINDOW = /creation_flags\(\s*(0x0800_0000|CREATE_NO_WINDOW)\s*\)/;

export function unquiet(source: string): string[] {
  const problems: string[] = [];
  const calls = [...source.matchAll(/Command::new\(\s*"([^"]+)"\s*\)/g)];
  for (const call of calls) {
    const program = call[1];
    if (!CONSOLE_PROGRAMS.test(program)) continue;
    const start = call.index ?? 0;
    const line = source.slice(0, start).split('\n').length;
    // Wrapped right where it is made: quiet(&mut Command::new("..."))
    if (source.slice(Math.max(0, start - 20), start).includes('quiet(&mut ')) continue;
    // Or kept in a variable that goes through quiet before the end of the function.
    const variable = /let\s+mut\s+(\w+)\s*=\s*$/.exec(source.slice(Math.max(0, start - 60), start));
    const rest = source.slice(start);
    const next = rest.slice(1).search(/\n\s*(pub(\([^)]*\))?\s+)?(async\s+)?fn\s/);
    const body = next === -1 ? rest : rest.slice(0, next + 1);
    if (variable && new RegExp(`quiet\\(&mut ${variable[1]}\\)`).test(body)) continue;
    if (CREATE_NO_WINDOW.test(body)) continue;
    problems.push(`line ${line}: Command::new("${program}") can open a console window`);
  }
  return problems;
}

// --- The check itself, on the real sources
for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.rs'))) {
  const problems = unquiet(readFileSync(join(SRC, file), 'utf8'));
  assert.deepEqual(problems, [], `${file}: ${problems.join('; ')}`);
}

// --- The checker catches what it should
assert.equal(unquiet('fn a() { let o = Command::new("powershell.exe").output(); }').length, 1);
assert.equal(unquiet('fn a() { quiet(&mut Command::new("powershell.exe")).output(); }').length, 0);
assert.equal(unquiet('fn a() { let mut command = Command::new("py.exe");\n command.arg(1);\n quiet(&mut command).spawn(); }').length, 0);
assert.equal(unquiet('fn a() { let mut command = Command::new("py.exe");\n command.spawn(); }\nfn b() { quiet(&mut command); }').length, 1);
assert.equal(unquiet('fn a() { let mut command = Command::new("adb.exe");\n command.creation_flags(0x0800_0000); }').length, 0);
assert.equal(unquiet('fn a() { Command::new("explorer.exe").arg(p).spawn(); }').length, 0);
assert.equal(unquiet('fn a() { Command::new("hostname").output(); }').length, 1);

console.log('check-quiet-processes: ok');
