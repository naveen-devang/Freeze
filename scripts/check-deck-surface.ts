// Run: node scripts/check-deck-surface.ts
// A page and a folder are both one grid of buttons and widgets. This checks how the phone reads that grid:
// which item covers each cell, and which layouts it refuses.
import assert from 'node:assert/strict';
import { buttonPlacement, surfaceOccupancy, validSurfaceLayout } from '../phone-app/src/deck-layout.ts';
import type { DeckButton, DeckWidget } from '../phone-app/src/connection.tsx';

const place = (row: number, column: number, rowSpan = 1, columnSpan = 1) => ({ row, column, rowSpan, columnSpan });
const button = (id: string, placement?: ReturnType<typeof place>): DeckButton => ({ id, label: id, icon: 'auto', placement, action: { type: 'media', command: 'play_pause' } });
const clock = (id: string, placement: ReturnType<typeof place>): DeckWidget => ({ id, type: 'clock', placement });

// Buttons and widgets share the cells; a widget can span several.
{
  const surface = { rows: 2, columns: 3, buttons: [button('a', place(0, 0))], widgets: [clock('w', place(0, 1, 2, 2))] };
  assert.ok(validSurfaceLayout(surface));
  const occupied = surfaceOccupancy(surface);
  assert.equal(occupied.size, 5);
  assert.deepEqual([0, 1, 2, 4, 5].map((cell) => occupied.get(cell)?.type), ['button', 'widget', 'widget', 'widget', 'widget']);
  assert.equal(occupied.get(3), undefined);
}

// A button and a widget may not overlap, and nothing may leave the grid.
assert.ok(!validSurfaceLayout({ rows: 2, columns: 2, buttons: [button('a', place(0, 0))], widgets: [clock('w', place(0, 0))] }));
assert.ok(!validSurfaceLayout({ rows: 1, columns: 2, buttons: [], widgets: [clock('w', place(0, 1, 1, 2))] }));
assert.ok(!validSurfaceLayout({ rows: 1, columns: 1, buttons: [button('a'), button('b')], widgets: [] }));

// Buttons without a saved position fill the grid row by row.
{
  const surface = { rows: 2, columns: 2, buttons: [button('a'), button('b'), button('c')], widgets: [] };
  assert.ok(validSurfaceLayout(surface));
  assert.deepEqual(surface.buttons.map((item, index) => buttonPlacement(2, item, index)), [place(0, 0), place(0, 1), place(1, 0)]);
}

console.log('check-deck-surface: ok');
