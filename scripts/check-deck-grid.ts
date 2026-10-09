// Run: node scripts/check-deck-grid.ts
// Where things go on the Deck grid: what fits, how new items shrink to the space they get, and what is refused.
import assert from 'node:assert/strict';
import { buttonPlacement, canPlaceWidgetItem, defaultSpan, firstWidgetPlacement, fitPlacement, swapPlacements } from '../pc-companion/src/deck-grid.ts';

const at = (row: number, column: number, rowSpan = 1, columnSpan = 1) => ({ row, column, rowSpan, columnSpan });
const screen = (rows: number, columns: number, buttons: { id: string; placement?: ReturnType<typeof at> }[] = [], widgets: { id: string; placement: ReturnType<typeof at> }[] = []) => ({ rows, columns, buttons, widgets });

// Starting sizes.
assert.deepEqual(defaultSpan('clock'), { rows: 1, columns: 2 });
assert.deepEqual(defaultSpan('now_playing'), { rows: 2, columns: 2 });
assert.deepEqual(defaultSpan('lyrics'), { rows: 2, columns: 3 });
assert.deepEqual(defaultSpan('pc_stats'), { rows: 1, columns: 1 });
assert.deepEqual(defaultSpan('plugin'), { rows: 1, columns: 1 });

// Buttons without a saved position fill the grid row by row.
const loose = screen(2, 2, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
assert.deepEqual(loose.buttons.map((button) => buttonPlacement(loose, button)), [at(0, 0), at(0, 1), at(1, 0)]);

// What fits: inside the grid, not over another item, and a moved item does not collide with itself.
const busy = screen(2, 3, [{ id: 'a', placement: at(0, 0) }], [{ id: 'w', placement: at(0, 1, 2, 1) }]);
assert.ok(canPlaceWidgetItem(busy, '', at(0, 2, 2, 1)));
assert.ok(!canPlaceWidgetItem(busy, '', at(0, 0)));
assert.ok(!canPlaceWidgetItem(busy, '', at(1, 1)));
assert.ok(canPlaceWidgetItem(busy, 'w', at(0, 1, 2, 1)));
assert.ok(!canPlaceWidgetItem(busy, '', at(2, 0)) && !canPlaceWidgetItem(busy, '', at(0, 3)) && !canPlaceWidgetItem(busy, '', at(-1, 0)));
assert.ok(!canPlaceWidgetItem(busy, '', at(0, 2, 0, 1)) && !canPlaceWidgetItem(busy, '', at(0.5, 2)));

// First free spot, in reading order, for any size.
assert.deepEqual(firstWidgetPlacement(busy), at(0, 2));
assert.deepEqual(firstWidgetPlacement(screen(2, 3, [{ id: 'a', placement: at(0, 0) }, { id: 'b', placement: at(0, 1) }, { id: 'c', placement: at(0, 2) }])), at(1, 0));
assert.deepEqual(firstWidgetPlacement(busy, 2, 1), at(0, 2, 2, 1));
assert.equal(firstWidgetPlacement(busy, 2, 2), null);
assert.equal(firstWidgetPlacement(screen(1, 1, [{ id: 'a', placement: at(0, 0) }])), null);

// A new item takes the biggest size up to what it wants.
const empty = screen(2, 3);
assert.deepEqual(fitPlacement(empty, { rows: 2, columns: 3 }, null), at(0, 0, 2, 3));
assert.deepEqual(fitPlacement(empty, { rows: 1, columns: 2 }, at(1, 1)), at(1, 1, 1, 2));
// ...shrinking when the chosen cell is near an edge or an item...
assert.deepEqual(fitPlacement(empty, { rows: 1, columns: 2 }, at(1, 2)), at(1, 2, 1, 1));
assert.deepEqual(fitPlacement(empty, { rows: 2, columns: 2 }, at(1, 1)), at(1, 1, 1, 2));
assert.deepEqual(fitPlacement(busy, { rows: 2, columns: 2 }, at(0, 2)), at(0, 2, 2, 1));
// ...and never bigger than the grid itself.
assert.deepEqual(fitPlacement(screen(1, 2), { rows: 2, columns: 3 }, null), at(0, 0, 1, 2));
// With no chosen cell, it goes to the first spot where the largest size fits.
assert.deepEqual(fitPlacement(busy, { rows: 2, columns: 2 }, null), at(0, 2, 2, 1));
assert.deepEqual(fitPlacement(screen(2, 3, [{ id: 'a', placement: at(0, 0) }]), { rows: 1, columns: 2 }, null), at(0, 1, 1, 2));
// A taken cell is refused outright; a full grid has no room.
assert.equal(fitPlacement(busy, { rows: 1, columns: 1 }, at(0, 0)), null);
assert.equal(fitPlacement(screen(1, 1, [{ id: 'a', placement: at(0, 0) }]), { rows: 1, columns: 1 }, null), null);

// Swapping two items trades places, or refuses when they would collide or leave the grid.
const items = [{ id: 'a', placement: at(0, 0) }, { id: 'b', placement: at(0, 1) }, { id: 'c', placement: at(1, 0, 1, 2) }];
assert.deepEqual(swapPlacements(2, 2, items, 'a', 'b')?.get('a'), at(0, 1));
assert.equal(swapPlacements(2, 2, items, 'a', 'c'), null);
assert.equal(swapPlacements(2, 2, items, 'a', 'a'), null);
assert.equal(swapPlacements(2, 2, items, 'a', 'missing'), null);

console.log('check-deck-grid: ok');
