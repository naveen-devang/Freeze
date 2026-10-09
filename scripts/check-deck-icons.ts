// Run: node scripts/check-deck-icons.ts
// An app icon read from the PC arrives a moment after the button is made. It may only land if nothing the user
// did in that moment makes it wrong.
import assert from 'node:assert/strict';
import { canReceiveIcon } from '../pc-companion/src/deck-icons.ts';

const app = (icon: string, path = '/Applications/Safari.app') => ({ id: 'b1', icon, action: { type: 'launch_app', app: path } });

assert.ok(canReceiveIcon(app('auto'), 'b1', 'app', '/Applications/Safari.app'));
// A refresh over a previous app icon is fine.
assert.ok(canReceiveIcon(app('app-icon'), 'b1', 'app', '/Applications/Safari.app'));
// The user picked their own icon: never overwritten.
assert.ok(!canReceiveIcon(app('Rocket'), 'b1', 'app', '/Applications/Safari.app'));
// The button now points elsewhere, or is another button.
assert.ok(!canReceiveIcon(app('auto', '/Applications/Mail.app'), 'b1', 'app', '/Applications/Safari.app'));
assert.ok(!canReceiveIcon(app('auto'), 'b2', 'app', '/Applications/Safari.app'));
// A file thumbnail only goes on a file button, and an app icon never on one.
assert.ok(canReceiveIcon({ id: 'b1', icon: 'auto', action: { type: 'launch_file', path: '/a.png' } }, 'b1', 'file', '/a.png'));
assert.ok(!canReceiveIcon({ id: 'b1', icon: 'auto', action: { type: 'launch_file', path: '/a.png' } }, 'b1', 'app', '/a.png'));
assert.ok(!canReceiveIcon({ id: 'b1', icon: 'auto', action: { type: 'media' } }, 'b1', 'file', '/a.png'));

console.log('check-deck-icons: ok');
