// Moving and reordering pages and profiles. Kept apart from the editor so scripts/check-deck-move.ts can test
// every case: what a move breaks (buttons that switch to a page in another profile), what it renames, and what
// it leaves behind.
type Action = { type: string; [key: string]: unknown };
export type MoveButton = { id: string; action: Action };
export type MoveWidget = { id: string };
export type MoveFolder = { id: string; name: string; buttons: MoveButton[]; widgets: MoveWidget[] };
export type MovePage = { id: string; name: string; buttons: MoveButton[]; widgets: MoveWidget[]; folders: MoveFolder[] };
export type MoveProfile = { id: string; name: string; pages: MovePage[]; activePageId: string; defaultPageId: string };
export type MoveConfig = { profiles: MoveProfile[]; activeProfileId: string };

export const MAX_PAGES = 32;

let idCounter = 0;
export const freshId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// Labels and names are limited in bytes on the PC side, so cut at a character boundary within `max` bytes.
export function fitBytes(text: string, max: number): string {
  let out = '';
  for (const character of text.trim()) {
    if (new TextEncoder().encode(out + character).length > max) break;
    out += character;
  }
  return out;
}

// "Name copy", "Name copy 2"… (or "Name 2", "Name 3"… when `style` is 'number') that no name in `taken` already uses.
export function copyName(name: string, taken: string[], max: number, style: 'copy' | 'number' = 'copy'): string {
  const used = new Set(taken.map((item) => item.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = style === 'copy' ? (n === 1 ? ' copy' : ` copy ${n}`) : ` ${n + 1}`;
    const candidate = `${fitBytes(name, max - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

function retarget<B extends MoveButton>(button: B, patch: Record<string, unknown>): B {
  return { ...button, action: { ...button.action, ...patch } };
}

// A copy of a page whose buttons, widgets and folders all get new ids (ids must be unique within a profile).
export function clonePage<P extends MovePage>(source: P, name: string): P {
  const folderIds = new Map(source.folders.map((folder) => [folder.id, freshId('folder')]));
  const cloneButton = <B extends MoveButton>(button: B): B => ({
    ...button,
    id: freshId('button'),
    ...(button.action.type === 'open_folder' ? { action: { ...button.action, folderId: folderIds.get(button.action.folderId as string) ?? button.action.folderId } } : {}),
  });
  const cloneWidget = <W extends MoveWidget>(widget: W): W => ({ ...widget, id: freshId('widget') });
  return {
    ...source,
    id: freshId('page'),
    name,
    buttons: source.buttons.map(cloneButton),
    widgets: source.widgets.map(cloneWidget),
    folders: source.folders.map((folder) => ({ ...folder, id: folderIds.get(folder.id)!, buttons: folder.buttons.map(cloneButton), widgets: folder.widgets.map(cloneWidget) })),
  };
}

const buttonsOfPage = (page: MovePage): MoveButton[] => [...page.buttons, ...page.folders.flatMap((folder) => folder.buttons)];
const idsOfPage = (page: MovePage): string[] => [page.id, ...page.buttons.map((b) => b.id), ...page.widgets.map((w) => w.id), ...page.folders.flatMap((f) => [f.id, ...f.buttons.map((b) => b.id), ...f.widgets.map((w) => w.id)])];
const idsOfProfile = (profile: MoveProfile): Set<string> => new Set(profile.pages.flatMap(idsOfPage));

export type MoveRequest = {
  fromProfileId: string;
  pageId: string;
  toProfileId: string;
  // Where the page lands among the destination's pages, counted before the page leaves its old spot.
  index: number;
  copy: boolean;
};

export type MoveDecisions = {
  // Buttons on other pages that switch to the moved page, which they can no longer reach.
  incoming: { count: number; targets: { id: string; name: string }[] };
  // Buttons on the moved page that switch to a page it leaves behind.
  outgoing: { count: number; targets: { id: string; name: string }[] };
};
export type Resolution = { incoming: 'remove' | { redirectTo: string }; outgoing: 'remove' | { redirectTo: string } };

export type MovePlan =
  | { ok: false; reason: string; copyOnly?: boolean }
  | { ok: true; samePlace: boolean; decisions: MoveDecisions; needsDecision: boolean };

function find<C extends MoveConfig>(config: C, request: MoveRequest) {
  const from = config.profiles.find((profile) => profile.id === request.fromProfileId);
  const to = config.profiles.find((profile) => profile.id === request.toProfileId);
  const page = from?.pages.find((entry) => entry.id === request.pageId);
  return { from, to, page };
}

function targetIndex(request: MoveRequest, fromIndex: number, length: number): number {
  const wanted = Math.max(0, Math.min(request.index, length));
  return request.copy || request.fromProfileId !== request.toProfileId ? wanted : wanted > fromIndex ? wanted - 1 : wanted;
}

export function planPageMove<C extends MoveConfig>(config: C, request: MoveRequest): MovePlan {
  const { from, to, page } = find(config, request);
  if (!from || !to || !page) return { ok: false, reason: 'That page is no longer there.' };
  const same = from.id === to.id;
  const fromIndex = from.pages.indexOf(page);
  if (same && !request.copy) {
    return { ok: true, samePlace: targetIndex(request, fromIndex, to.pages.length) === fromIndex, decisions: { incoming: { count: 0, targets: [] }, outgoing: { count: 0, targets: [] } }, needsDecision: false };
  }
  if (!request.copy && from.pages.length <= 1) return { ok: false, copyOnly: true, reason: `${from.name} needs at least one page, so “${page.name}” can only be copied.` };
  if (to.pages.length >= MAX_PAGES) return { ok: false, reason: `${to.name} already has ${MAX_PAGES} pages.` };

  const leftBehind = from.pages.filter((entry) => entry.id !== page.id);
  const destination = to.pages;
  // Buttons on other pages that point at this page stop working once it is in another profile.
  const incomingCount = request.copy || same ? 0 : from.pages.filter((entry) => entry.id !== page.id).flatMap(buttonsOfPage).filter((button) => button.action.type === 'select_page' && button.action.pageId === page.id).length;
  // Buttons on this page that point at a page it leaves behind (itself is fine).
  const outgoingCount = same ? 0 : buttonsOfPage(page).filter((button) => button.action.type === 'select_page' && button.action.pageId !== page.id && leftBehind.some((entry) => entry.id === button.action.pageId)).length;
  const decisions: MoveDecisions = {
    incoming: { count: incomingCount, targets: leftBehind.map(({ id, name }) => ({ id, name })) },
    outgoing: { count: outgoingCount, targets: destination.map(({ id, name }) => ({ id, name })) },
  };
  return { ok: true, samePlace: false, decisions, needsDecision: incomingCount > 0 || outgoingCount > 0 };
}

export type MoveResult<C> = { config: C; pageId: string; profileId: string; summary: string };

// Carries out a move or copy. Returns the config unchanged for a drop that changes nothing.
export function applyPageMove<C extends MoveConfig>(config: C, request: MoveRequest, resolution: Resolution = { incoming: 'remove', outgoing: 'remove' }): MoveResult<C> | null {
  const plan = planPageMove(config, request);
  if (!plan.ok) return null;
  const { from, to, page } = find(config, request)!;
  if (!from || !to || !page) return null;
  const same = from.id === to.id;
  const fromIndex = from.pages.indexOf(page);
  const index = targetIndex(request, fromIndex, to.pages.length);
  if (plan.samePlace) return { config, pageId: page.id, profileId: to.id, summary: '' };

  let moved: MovePage = page;
  if (request.copy) {
    const taken = to.pages.map((entry) => entry.name);
    moved = clonePage(page, !same && !taken.some((name) => name.toLowerCase() === page.name.toLowerCase()) ? page.name : copyName(page.name, taken, 24));
  } else if (!same) {
    // Moving keeps ids where it can; whatever collides in the new profile gets a new one.
    const taken = idsOfProfile(to);
    const rename = (id: string, prefix: string) => (taken.has(id) ? freshId(prefix) : id);
    const folderIds = new Map(page.folders.map((folder) => [folder.id, rename(folder.id, 'folder')]));
    const fixButton = (button: MoveButton): MoveButton => {
      const next = { ...button, id: rename(button.id, 'button') };
      return next.action.type === 'open_folder' ? retarget(next, { folderId: folderIds.get(next.action.folderId as string) ?? next.action.folderId }) : next;
    };
    const fixWidget = (widget: MoveWidget): MoveWidget => ({ ...widget, id: rename(widget.id, 'widget') });
    moved = {
      ...page,
      id: rename(page.id, 'page'),
      name: to.pages.some((entry) => entry.name.toLowerCase() === page.name.toLowerCase()) ? copyName(page.name, to.pages.map((entry) => entry.name), 24, 'number') : page.name,
      buttons: page.buttons.map(fixButton),
      widgets: page.widgets.map(fixWidget),
      folders: page.folders.map((folder) => ({ ...folder, id: folderIds.get(folder.id)!, buttons: folder.buttons.map(fixButton), widgets: folder.widgets.map(fixWidget) })),
    };
  }

  // Buttons on the moved page that switch pages: ones aimed at the page itself follow it; ones aimed at pages
  // left behind are removed or pointed at a page in the new profile, as chosen.
  if (!same || request.copy) {
    // In the same profile every page is still reachable, so only the page's own reference needs to follow it.
    const leftBehind = same ? new Set<string>() : new Set(from.pages.filter((entry) => entry.id !== page.id).map((entry) => entry.id));
    const keep = (button: MoveButton): MoveButton | null => {
      if (button.action.type !== 'select_page') return button;
      const target = button.action.pageId as string;
      if (target === page.id) return retarget(button, { pageId: moved.id });
      if (!leftBehind.has(target)) return button;
      return resolution.outgoing === 'remove' ? null : retarget(button, { pageId: resolution.outgoing.redirectTo });
    };
    moved = { ...moved, buttons: moved.buttons.flatMap((button) => keep(button) ?? []), folders: moved.folders.map((folder) => ({ ...folder, buttons: folder.buttons.flatMap((button) => keep(button) ?? []) })) };
  }

  const profiles = config.profiles.map((profile) => {
    let pages = profile.pages;
    let activePageId = profile.activePageId;
    let defaultPageId = profile.defaultPageId;
    if (profile.id === from.id && !request.copy) {
      pages = pages.filter((entry) => entry.id !== page.id);
      if (!same) {
        // Other pages' switch buttons that aimed at the page can no longer reach it.
        const fix = (button: MoveButton): MoveButton | null => button.action.type === 'select_page' && button.action.pageId === page.id
          ? resolution.incoming === 'remove' ? null : retarget(button, { pageId: resolution.incoming.redirectTo })
          : button;
        pages = pages.map((entry) => ({ ...entry, buttons: entry.buttons.flatMap((button) => fix(button) ?? []), folders: entry.folders.map((folder) => ({ ...folder, buttons: folder.buttons.flatMap((button) => fix(button) ?? []) })) }));
        if (activePageId === page.id) activePageId = pages[0].id;
        if (defaultPageId === page.id) defaultPageId = pages[0].id;
      }
    }
    if (profile.id === to.id) {
      const next = pages.slice();
      next.splice(Math.min(index, next.length), 0, moved);
      pages = next;
    }
    return { ...profile, pages, activePageId, defaultPageId };
  });
  const summary = request.copy ? `Copied “${page.name}” to ${to.name}` : same ? `Moved “${page.name}” in ${to.name}` : `Moved “${page.name}” to ${to.name}`;
  return { config: { ...config, profiles } as C, pageId: moved.id, profileId: to.id, summary };
}

// Puts a profile at `index` in the list (counted before it leaves its old spot).
export function reorderProfile<C extends MoveConfig>(config: C, profileId: string, index: number): C {
  const from = config.profiles.findIndex((profile) => profile.id === profileId);
  if (from < 0) return config;
  const wanted = Math.max(0, Math.min(index, config.profiles.length));
  const to = wanted > from ? wanted - 1 : wanted;
  if (to === from) return config;
  const profiles = config.profiles.slice();
  const [profile] = profiles.splice(from, 1);
  profiles.splice(to, 0, profile);
  return { ...config, profiles };
}
