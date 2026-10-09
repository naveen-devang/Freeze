// Run: node scripts/check-deck-move.ts
// Moving, copying and reordering pages and profiles. Every result must still be a deck the PC would accept:
// unique ids and page names in a profile, switch buttons that point at real pages, and a default page that exists.
import assert from 'node:assert/strict';
import { MAX_PAGES, applyPageMove, planPageMove, reorderProfile } from '../pc-companion/src/deck-move.ts';
import type { MoveButton, MoveConfig, MovePage, MoveProfile } from '../pc-companion/src/deck-move.ts';

const media = (id: string): MoveButton => ({ id, action: { type: 'media', command: 'play_pause' } });
const toPage = (id: string, pageId: string): MoveButton => ({ id, action: { type: 'select_page', pageId } });
const page = (id: string, name: string, buttons: MoveButton[] = [], extra: Partial<MovePage> = {}): MovePage => ({ id, name, buttons, widgets: [], folders: [], ...extra });
const profile = (id: string, pages: MovePage[], extra: Partial<MoveProfile> = {}): MoveProfile => ({ id, name: id.toUpperCase(), pages, activePageId: pages[0].id, defaultPageId: pages[0].id, ...extra });
const deck = (...profiles: MoveProfile[]): MoveConfig => ({ profiles, activeProfileId: profiles[0].id });

// What the PC checks when a deck is saved.
function assertValid(config: MoveConfig) {
  for (const entry of config.profiles) {
    assert.ok(entry.pages.length >= 1 && entry.pages.length <= MAX_PAGES, `${entry.id}: page count`);
    const names = entry.pages.map((item) => item.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${entry.id}: page names are unique`);
    const ids = entry.pages.flatMap((item) => [item.id, ...item.buttons.map((b) => b.id), ...item.widgets.map((w) => w.id), ...item.folders.flatMap((f) => [f.id, ...f.buttons.map((b) => b.id), ...f.widgets.map((w) => w.id)])]);
    assert.equal(new Set(ids).size, ids.length, `${entry.id}: ids are unique`);
    const pageIds = new Set(entry.pages.map((item) => item.id));
    assert.ok(pageIds.has(entry.activePageId) && pageIds.has(entry.defaultPageId), `${entry.id}: active and default page exist`);
    for (const item of entry.pages) {
      for (const button of [...item.buttons, ...item.folders.flatMap((f) => f.buttons)]) {
        if (button.action.type === 'select_page') assert.ok(pageIds.has(button.action.pageId as string), `${entry.id}: ${button.id} points at a page that exists`);
      }
      const opened = item.buttons.filter((b) => b.action.type === 'open_folder').map((b) => b.action.folderId);
      assert.deepEqual([...opened].sort(), item.folders.map((f) => f.id).sort(), `${item.id}: every folder has one button`);
    }
  }
}
const names = (config: MoveConfig, id: string) => config.profiles.find((entry) => entry.id === id)!.pages.map((item) => item.name);
const move = (config: MoveConfig, request: Partial<Parameters<typeof planPageMove>[1]> & { pageId: string; toProfileId: string; index: number }, resolution?: Parameters<typeof applyPageMove>[2]) => {
  const full = { fromProfileId: 'a', copy: false, ...request };
  const plan = planPageMove(config, full);
  assert.ok(plan.ok, plan.ok ? '' : plan.reason);
  const result = applyPageMove(config, full, resolution);
  assert.ok(result);
  assertValid(result.config);
  return result;
};

// --- Reordering inside a profile
{
  const base = deck(profile('a', [page('p1', 'One'), page('p2', 'Two'), page('p3', 'Three')]));
  // Dropping "One" after "Two" (a line before index 2) puts it second.
  assert.deepEqual(names(move(base, { pageId: 'p1', toProfileId: 'a', index: 2 }).config, 'a'), ['Two', 'One', 'Three']);
  assert.deepEqual(names(move(base, { pageId: 'p3', toProfileId: 'a', index: 0 }).config, 'a'), ['Three', 'One', 'Two']);
  assert.deepEqual(names(move(base, { pageId: 'p1', toProfileId: 'a', index: 3 }).config, 'a'), ['Two', 'Three', 'One']);
  // Dropping where it already is changes nothing, and reports it.
  const stay = planPageMove(base, { fromProfileId: 'a', pageId: 'p2', toProfileId: 'a', index: 1, copy: false });
  assert.ok(stay.ok && stay.samePlace);
  assert.ok(planPageMove(base, { fromProfileId: 'a', pageId: 'p2', toProfileId: 'a', index: 2, copy: false }).ok);
  assert.equal(applyPageMove(base, { fromProfileId: 'a', pageId: 'p2', toProfileId: 'a', index: 2, copy: false })!.config, base);
  // The last page of a profile can still be reordered, since it never leaves.
  assert.ok(planPageMove(deck(profile('a', [page('only', 'Only')])), { fromProfileId: 'a', pageId: 'only', toProfileId: 'a', index: 0, copy: false }).ok);
}

// --- A plain move to another profile
{
  const base = deck(profile('a', [page('p1', 'One', [media('b1')]), page('p2', 'Two')]), profile('b', [page('q1', 'Docs')]));
  const result = move(base, { pageId: 'p1', toProfileId: 'b', index: 1 });
  assert.deepEqual(names(result.config, 'a'), ['Two']);
  assert.deepEqual(names(result.config, 'b'), ['Docs', 'One']);
  assert.equal(result.profileId, 'b');
  // The page that was first, active and default in A hands those over.
  assert.equal(result.config.profiles[0].activePageId, 'p2');
  assert.equal(result.config.profiles[0].defaultPageId, 'p2');
  // Nothing needed a decision.
  const plan = planPageMove(base, { fromProfileId: 'a', pageId: 'p1', toProfileId: 'b', index: 1, copy: false });
  assert.ok(plan.ok && !plan.needsDecision);
}

// --- Names and ids that collide in the new profile
{
  const base = deck(
    profile('a', [page('p1', 'Streaming', [media('same')], { widgets: [{ id: 'wid' }], folders: [{ id: 'fold', name: 'F', buttons: [media('fb')], widgets: [] }] }), page('p2', 'Two')]),
    profile('b', [page('p1', 'streaming', [media('same')], { widgets: [{ id: 'wid' }], folders: [{ id: 'fold', name: 'G', buttons: [], widgets: [] }] })]),
  );
  base.profiles[0].pages[0].buttons.push({ id: 'folder-button', action: { type: 'open_folder', folderId: 'fold' } });
  base.profiles[1].pages[0].buttons.push({ id: 'folder-button', action: { type: 'open_folder', folderId: 'fold' } });
  const moved = move(base, { pageId: 'p1', toProfileId: 'b', index: 1 }).config.profiles[1].pages[1];
  assert.equal(moved.name, 'Streaming 2');
  assert.notEqual(moved.id, 'p1');
  assert.ok(moved.buttons.some((b) => b.action.type === 'open_folder' && b.action.folderId === moved.folders[0].id), 'folder button follows its folder');
  assert.notEqual(moved.folders[0].id, 'fold');
}

// --- Buttons that switch to the moved page
{
  const base = deck(profile('a', [page('p1', 'One'), page('p2', 'Two', [toPage('go', 'p1')]), page('p3', 'Three', [], { folders: [{ id: 'f', name: 'F', buttons: [toPage('go2', 'p1')], widgets: [] }], buttons: [{ id: 'fb', action: { type: 'open_folder', folderId: 'f' } }] })]), profile('b', [page('q1', 'Docs')]));
  const request = { fromProfileId: 'a', pageId: 'p1', toProfileId: 'b', index: 0, copy: false };
  const plan = planPageMove(base, request);
  assert.ok(plan.ok && plan.needsDecision && plan.decisions.incoming.count === 2 && plan.decisions.outgoing.count === 0);
  assert.deepEqual(plan.decisions.incoming.targets.map((t) => t.id), ['p2', 'p3']);
  const removed = move(base, request, { incoming: 'remove', outgoing: 'remove' }).config.profiles[0];
  assert.equal(removed.pages[0].buttons.length, 0);
  assert.equal(removed.pages[1].folders[0].buttons.length, 0);
  const redirected = move(base, request, { incoming: { redirectTo: 'p3' }, outgoing: 'remove' }).config.profiles[0];
  assert.equal(redirected.pages[0].buttons[0].action.pageId, 'p3');
  assert.equal(redirected.pages[1].folders[0].buttons[0].action.pageId, 'p3');
}

// --- Switch buttons on the moved page
{
  const base = deck(profile('a', [page('p1', 'One', [toPage('self', 'p1'), toPage('away', 'p2')]), page('p2', 'Two')]), profile('b', [page('q1', 'Docs')]));
  const request = { fromProfileId: 'a', pageId: 'p1', toProfileId: 'b', index: 1, copy: false };
  const plan = planPageMove(base, request);
  assert.ok(plan.ok && plan.decisions.outgoing.count === 1 && plan.decisions.incoming.count === 0);
  assert.deepEqual(plan.decisions.outgoing.targets.map((t) => t.id), ['q1']);
  const kept = move(base, request, { incoming: 'remove', outgoing: { redirectTo: 'q1' } }).config.profiles[1].pages[1];
  assert.deepEqual(kept.buttons.map((b) => b.action.pageId), ['p1', 'q1']);
  const dropped = move(base, request, { incoming: 'remove', outgoing: 'remove' }).config.profiles[1].pages[1];
  assert.deepEqual(dropped.buttons.map((b) => b.id), ['self']);
  // A button aimed at itself follows the page even when its id had to change.
  const clash = deck(profile('a', [page('p1', 'One', [toPage('self', 'p1')]), page('p2', 'Two')]), profile('b', [page('p1', 'Other')]));
  const renamed = move(clash, { pageId: 'p1', toProfileId: 'b', index: 1 }).config.profiles[1].pages[1];
  assert.equal(renamed.buttons[0].action.pageId, renamed.id);
}

// --- The last page, a full profile, and pages that vanished
{
  const single = deck(profile('a', [page('only', 'Only')]), profile('b', [page('q1', 'Docs')]));
  const blocked = planPageMove(single, { fromProfileId: 'a', pageId: 'only', toProfileId: 'b', index: 0, copy: false });
  assert.ok(!blocked.ok && blocked.copyOnly);
  assert.equal(applyPageMove(single, { fromProfileId: 'a', pageId: 'only', toProfileId: 'b', index: 0, copy: false }), null);
  assert.equal(names(move(single, { pageId: 'only', toProfileId: 'b', index: 1, copy: true }).config, 'a').length, 1);
  assert.deepEqual(names(move(single, { pageId: 'only', toProfileId: 'b', index: 1, copy: true }).config, 'b'), ['Docs', 'Only']);

  const full = deck(profile('a', [page('p1', 'One'), page('p2', 'Two')]), profile('b', Array.from({ length: MAX_PAGES }, (_, index) => page(`q${index}`, `Q${index}`))));
  const refused = planPageMove(full, { fromProfileId: 'a', pageId: 'p1', toProfileId: 'b', index: 0, copy: false });
  assert.ok(!refused.ok && /32/.test(refused.reason));
  // Reordering inside a full profile is still fine.
  assert.ok(planPageMove(full, { fromProfileId: 'b', pageId: 'q0', toProfileId: 'b', index: 5, copy: false }).ok);

  assert.ok(!planPageMove(single, { fromProfileId: 'a', pageId: 'gone', toProfileId: 'b', index: 0, copy: false }).ok);
  assert.ok(!planPageMove(single, { fromProfileId: 'a', pageId: 'only', toProfileId: 'gone', index: 0, copy: false }).ok);
}

// --- Copying
{
  const base = deck(profile('a', [page('p1', 'One', [toPage('self', 'p1'), toPage('other', 'p2')]), page('p2', 'Two')]), profile('b', [page('q1', 'One')]));
  // In the same profile: named "One copy", keeps pointing at real pages, original untouched.
  const same = move(base, { pageId: 'p1', toProfileId: 'a', index: 1, copy: true });
  assert.deepEqual(names(same.config, 'a'), ['One', 'One copy', 'Two']);
  const copy = same.config.profiles[0].pages[1];
  assert.deepEqual(copy.buttons.map((b) => b.action.pageId), [copy.id, 'p2']);
  assert.notEqual(copy.buttons[0].id, 'self');
  // Into another profile: a taken name gets "copy"; a free name is kept; buttons to pages left behind need a decision.
  const plan = planPageMove(base, { fromProfileId: 'a', pageId: 'p1', toProfileId: 'b', index: 1, copy: true });
  assert.ok(plan.ok && plan.needsDecision && plan.decisions.incoming.count === 0 && plan.decisions.outgoing.count === 1);
  const across = move(base, { pageId: 'p1', toProfileId: 'b', index: 1, copy: true }, { incoming: 'remove', outgoing: 'remove' });
  assert.deepEqual(names(across.config, 'b'), ['One', 'One copy']);
  assert.deepEqual(names(across.config, 'a'), ['One', 'Two']);
  assert.deepEqual(names(move(base, { pageId: 'p2', toProfileId: 'b', index: 0, copy: true }).config, 'b'), ['Two', 'One']);
}

// --- Defaults follow the right page
{
  const base = deck(profile('a', [page('p1', 'One'), page('p2', 'Two'), page('p3', 'Three')], { activePageId: 'p2', defaultPageId: 'p3' }), profile('b', [page('q1', 'Docs')]));
  const result = move(base, { pageId: 'p3', toProfileId: 'b', index: 1 }).config.profiles[0];
  assert.equal(result.defaultPageId, 'p1');
  assert.equal(result.activePageId, 'p2');
  // Reordering never changes which page is the default.
  const reordered = move(base, { pageId: 'p3', toProfileId: 'a', index: 0 }).config.profiles[0];
  assert.equal(reordered.defaultPageId, 'p3');
}

// --- Reordering profiles
{
  const base = deck(profile('a', [page('p', 'P')]), profile('b', [page('p', 'P')]), profile('c', [page('p', 'P')]));
  const order = (config: MoveConfig) => config.profiles.map((entry) => entry.id).join('');
  assert.equal(order(reorderProfile(base, 'a', 2)), 'bac');
  assert.equal(order(reorderProfile(base, 'c', 0)), 'cab');
  assert.equal(order(reorderProfile(base, 'a', 3)), 'bca');
  assert.equal(reorderProfile(base, 'b', 1), base);
  assert.equal(reorderProfile(base, 'b', 2), base);
  assert.equal(reorderProfile(base, 'missing', 0), base);
  assert.equal(base.activeProfileId, 'a');
}

console.log('check-deck-move: ok');
