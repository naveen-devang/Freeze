// How the widget layer (web-widgets.tsx) drives its web view, as a state machine with no React in it:
// step(state, event, now) returns the next state and the side effects to run. scripts/check-web-widgets.ts
// runs every case below, including the ones that used to leave widgets blank.
//
// Why a state machine: the layer used to send widgets when a `loaded` flag flipped, and the flag stayed
// true when the web view was destroyed, so a fresh web view whose load events were handled in one batch
// never received its widgets. Now a page is sent widgets only after it announces itself ({ ready }), every
// send is acknowledged ({ ack }), and an unanswered send reloads the page.

/** A web view with nothing to show (or hidden, or the app in the background) is freed after this long. */
export const IDLE_MS = 60_000;
/** How long a list may go unacknowledged before it is sent again. */
export const ACK_MS = 2_000;
/** How long a new page may take to announce itself. */
export const READY_MS = 8_000;
/** Reloads of a dead or silent page allowed per window; past that the layer stops for GIVE_UP_MS. */
export const MAX_RECOVERIES = 3;
export const RECOVERY_WINDOW_MS = 60_000;
export const GIVE_UP_MS = 30_000;

export type TimerKind = 'idle' | 'ack' | 'ready' | 'retry';

export type Props = {
  /** JSON of the web widgets to show; only read when hasWidgets. */
  list: string;
  hasWidgets: boolean;
  hour12: boolean;
};

export type State = {
  /** Whether a web view should exist, and which one (callbacks of an older one are ignored). */
  mounted: boolean;
  instance: number;
  props: Props;
  focused: boolean;
  appActive: boolean;
  /** The current page announced itself. */
  ready: boolean;
  /** Last request number sent to the page, the last it acknowledged, and what that request showed. */
  seq: number;
  acked: number;
  sentKey: string;
  /** Times the unacknowledged request was sent again. */
  attempts: number;
  /** Pause state last sent to the page, or null when it has none yet. */
  paused: boolean | null;
  /** Readings the page said its stats widgets need, and what was last handed to the stats feed. */
  needs: string[];
  publishedNeeds: string | null;
  /** The page may be dead (the app came back to the foreground): send the list again to find out. */
  verify: boolean;
  /** Reload times within the recent window, and when a stopped layer may try again. */
  recoveries: number[];
  retryAt: number;
  /** Timer tokens: a timer event only counts while its token is the current one. */
  timers: Record<TimerKind, number>;
  tokens: number;
};

export type Event =
  | { type: 'props'; props: Props }
  | { type: 'focus'; focused: boolean }
  | { type: 'app'; active: boolean }
  | { type: 'ready'; instance: number }
  | { type: 'ack'; instance: number; seq: number; needs: string[] }
  | { type: 'failure'; instance: number; reason: string }
  | { type: 'timer'; kind: TimerKind; token: number }
  | { type: 'unmount' };

export type Command =
  | { type: 'send'; list: string; hour12: boolean; force: boolean; seq: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'needs'; needs: string[] | null }
  | { type: 'schedule'; timer: TimerKind; ms: number; token: number }
  | { type: 'cancel'; timer: TimerKind };

export type Result = { state: State; commands: Command[] };

export const initialState = (): State => ({
  mounted: false, instance: 0, props: { list: '[]', hasWidgets: false, hour12: true }, focused: true, appActive: true,
  ready: false, seq: 0, acked: 0, sentKey: '', attempts: 0, paused: null, needs: [], publishedNeeds: null, verify: false,
  recoveries: [], retryAt: 0, timers: { idle: 0, ack: 0, ready: 0, retry: 0 }, tokens: 0,
});

const visible = (s: State) => s.focused && s.appActive;
// The page should be showing widgets right now.
const wanted = (s: State) => s.props.hasWidgets && visible(s);

function schedule(s: State, out: Command[], timer: TimerKind, ms: number) {
  const token = ++s.tokens;
  s.timers[timer] = token;
  out.push({ type: 'schedule', timer, ms, token });
}
function cancel(s: State, out: Command[], timer: TimerKind) {
  if (!s.timers[timer]) return;
  s.timers[timer] = 0;
  out.push({ type: 'cancel', timer });
}

// A fresh web view: nothing is known about its page until it announces itself.
function mountNew(s: State, out: Command[]) {
  s.mounted = true;
  s.instance += 1;
  s.ready = false;
  s.seq = 0;
  s.acked = 0;
  s.sentKey = '';
  s.attempts = 0;
  s.paused = null;
  s.verify = false;
  cancel(s, out, 'ack');
  cancel(s, out, 'retry');
  schedule(s, out, 'ready', READY_MS);
}

function unmountView(s: State, out: Command[]) {
  s.mounted = false;
  s.ready = false;
  s.sentKey = '';
  s.paused = null;
  s.verify = false;
  for (const timer of ['idle', 'ack', 'ready'] as const) cancel(s, out, timer);
}

// A dead, silent or failing page: reload it, unless it keeps failing.
function recover(s: State, out: Command[], now: number) {
  s.recoveries = s.recoveries.filter((time) => now - time < RECOVERY_WINDOW_MS);
  if (s.recoveries.length >= MAX_RECOVERIES) {
    unmountView(s, out);
    s.retryAt = now + GIVE_UP_MS;
    return;
  }
  s.recoveries.push(now);
  if (wanted(s)) mountNew(s, out);
  else unmountView(s, out);
}

// What the page should be showing: the widgets, or none when the page has none (it then draws nothing).
const desired = (s: State) => {
  const list = s.props.hasWidgets ? s.props.list : '[]';
  return { list, key: `${list}|${s.props.hour12}` };
};

// Sends what the page should show now and waits for its acknowledgement.
function send(s: State, out: Command[]) {
  const { list, key } = desired(s);
  s.sentKey = key;
  s.verify = false;
  s.seq += 1;
  s.attempts = 0;
  out.push({ type: 'send', list, hour12: s.props.hour12, force: false, seq: s.seq });
  schedule(s, out, 'ack', ACK_MS);
}

// Brings the web view, its timers and what the page shows in line with the state. Safe to run after any event.
function reconcile(s: State, out: Command[], now: number) {
  if (!s.mounted) {
    if (wanted(s)) {
      if (now >= s.retryAt) mountNew(s, out);
      else if (!s.timers.retry) schedule(s, out, 'retry', s.retryAt - now);
    }
  }
  if (s.mounted) {
    if (wanted(s)) cancel(s, out, 'idle');
    else if (!s.timers.idle) schedule(s, out, 'idle', IDLE_MS);
    if (s.ready) {
      if (desired(s).key !== s.sentKey || s.verify) send(s, out);
      const paused = !visible(s);
      if (s.paused !== paused) {
        s.paused = paused;
        out.push({ type: 'pause', paused });
      }
    }
  }
  // The PC samples what the widgets on screen need: nothing while hidden, backgrounded or gone.
  const publish = s.mounted && s.ready && wanted(s) ? s.needs.join() : null;
  if (publish !== s.publishedNeeds) {
    s.publishedNeeds = publish;
    out.push({ type: 'needs', needs: publish === null ? null : [...s.needs] });
  }
}

export function step(prev: State, event: Event, now: number): Result {
  const s: State = { ...prev, props: { ...prev.props }, needs: [...prev.needs], recoveries: [...prev.recoveries], timers: { ...prev.timers } };
  const out: Command[] = [];
  switch (event.type) {
    case 'props':
      s.props = { ...event.props };
      break;
    case 'focus':
    case 'app': {
      const was = visible(s);
      if (event.type === 'focus') s.focused = event.focused;
      else s.appActive = event.active;
      // Coming back to the page: it may have been frozen, killed or reloaded meanwhile, so ask it again.
      if (!was && visible(s)) s.verify = true;
      break;
    }
    case 'ready':
      if (event.instance !== s.instance || !s.mounted) break;
      // The page also announces itself again if it reloads on its own: it has lost every widget.
      s.ready = true;
      s.sentKey = '';
      s.paused = null;
      s.attempts = 0;
      s.acked = s.seq;
      cancel(s, out, 'ready');
      cancel(s, out, 'ack');
      break;
    case 'ack':
      // Only the newest request counts: an older answer says nothing about what the page shows now.
      if (event.instance !== s.instance || !s.mounted || event.seq !== s.seq) break;
      s.acked = event.seq;
      s.attempts = 0;
      s.needs = [...event.needs];
      cancel(s, out, 'ack');
      break;
    case 'failure':
      if (event.instance !== s.instance || !s.mounted) break;
      recover(s, out, now);
      break;
    case 'timer': {
      if (event.token !== s.timers[event.kind]) break;
      s.timers[event.kind] = 0;
      if (event.kind === 'idle') {
        if (s.mounted && !wanted(s)) unmountView(s, out);
      } else if (event.kind === 'ack') {
        if (s.mounted && s.ready && s.acked < s.seq) {
          if (s.attempts < 1) {
            // Once more, with whatever the page should show now; a second silence means the page is stuck.
            send(s, out);
            s.attempts = 1;
          } else recover(s, out, now);
        }
      } else if (event.kind === 'ready') {
        if (s.mounted && !s.ready) recover(s, out, now);
      }
      break;
    }
    case 'unmount':
      s.mounted = false;
      s.ready = false;
      for (const timer of ['idle', 'ack', 'ready', 'retry'] as const) cancel(s, out, timer);
      break;
  }
  if (event.type !== 'unmount') reconcile(s, out, now);
  else if (s.publishedNeeds !== null) {
    s.publishedNeeds = null;
    out.push({ type: 'needs', needs: null });
  }
  return { state: s, commands: out };
}
