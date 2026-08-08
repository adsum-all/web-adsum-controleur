// Offline-first check-in queue. Each scan or manual entry is stored locally and
// survives a reload or a loss of network. Pending items are pushed to the API
// when connectivity is available, so the controller never blocks at the door.
//
// Three properties this file exists to guarantee, each of which was broken and each
// of which loses an attendance when it is:
//
// A pending entry is never discarded. The queue used to be trimmed to its last five
// hundred rows without looking at their status, and entries already synced counted
// towards that quota. At a large gathering the oldest rows went, and among them
// check-ins recorded during a network outage that had never reached the server.
//
// A check-in is attributed to whoever recorded it. The entry now carries its author,
// and the sync only pushes what the signed-in controller recorded. On a shared
// terminal at the door, entries typed by one controller and synchronised after
// another signs in were previously written to the base under the second one's name.
//
// The caller learns what actually happened. `syncQueue` returns the outcome and each
// item keeps its own status, so a screen can say "recorded" only when the server said
// so, rather than whenever the request finished.

import { ApiError, checkin, checkinManuel, deviceId } from "./api.js";

const KEY = "adsum.controleur.queue";

//: Terminal entries kept for the controller to review. Pending entries are never
//: counted against this: they are the ones that still owe somebody a presence.
const MAX_TERMINEES = 500;

export type QueueStatus = "pending" | "synced" | "rejected";

export interface QueueItem {
  id: string;
  kind: "qr" | "manual";
  qrToken?: string;
  membreId?: string;
  evenementId: string;
  label: string;
  matricule?: string;
  ts: number;
  status: QueueStatus;
  error?: string;
  /** Who recorded it, so a later sync cannot sign it in somebody else's name. */
  controleurId?: string;
  /** Which terminal, for the audit trail on a shared device. */
  appareilId?: string;
}

export function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

/** Persist the queue, sacrificing only entries the server has already settled. */
function saveQueue(items: QueueItem[]): void {
  const enAttente = items.filter((i) => i.status === "pending");
  const terminees = items.filter((i) => i.status !== "pending").slice(-MAX_TERMINEES);
  const conserves = [...enAttente, ...terminees].sort((a, b) => a.ts - b.ts);
  try {
    localStorage.setItem(KEY, JSON.stringify(conserves));
  } catch {
    // Storage full. Drop the settled entries rather than the ones still owing a
    // presence, and if even that fails, keep the pending ones alone: losing the
    // history is recoverable, losing a check-in is not.
    try {
      localStorage.setItem(KEY, JSON.stringify(enAttente));
    } catch {
      /* nothing left to try; the in-memory queue survives until the next reload */
    }
  }
}

/** Who is signed in, read from the token so an entry can be attributed at creation. */
function sujetDuJeton(token: string): string | undefined {
  try {
    const charge = token.split(".")[1];
    if (!charge) return undefined;
    const json = JSON.parse(atob(charge.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
    return typeof json.sub === "string" ? json.sub : undefined;
  } catch {
    return undefined;
  }
}

export function enqueue(
  item: Omit<QueueItem, "id" | "ts" | "status">,
  token?: string,
): QueueItem {
  const items = loadQueue();
  const cree: QueueItem = {
    ...item,
    id: crypto.randomUUID(),
    ts: Date.now(),
    status: "pending",
    controleurId: item.controleurId ?? (token ? sujetDuJeton(token) : undefined),
    appareilId: item.appareilId ?? deviceId(),
  };
  items.push(cree);
  saveQueue(items);
  // The created entry is returned, not the whole queue: the caller needs to follow
  // this one check-in through the sync and report its real fate.
  return cree;
}

export function pendingCount(items: QueueItem[] = loadQueue()): number {
  return items.filter((i) => i.status === "pending").length;
}

/** Entries waiting for a controller who is not the one signed in. */
export function attenteAutreControleur(token: string, items: QueueItem[] = loadQueue()): number {
  const moi = sujetDuJeton(token);
  if (!moi) return 0;
  return items.filter((i) => i.status === "pending" && i.controleurId && i.controleurId !== moi).length;
}

export interface SyncOutcome {
  synced: number;
  rejected: number;
  remaining: number;
  /** Held back because they belong to another controller's session. */
  differes: number;
}

export async function syncQueue(token: string): Promise<SyncOutcome> {
  const items = loadQueue();
  const moi = sujetDuJeton(token);
  let synced = 0;
  let rejected = 0;
  let differes = 0;

  for (const item of items) {
    if (item.status !== "pending") continue;
    // An entry recorded by somebody else waits for them. Pushing it now would write
    // their check-in to the base under the current controller's name, and the audit
    // trail would show a mutation by a person who never made it.
    if (moi && item.controleurId && item.controleurId !== moi) {
      differes += 1;
      continue;
    }
    try {
      if (item.kind === "qr" && item.qrToken) {
        await checkin(token, item.qrToken, item.evenementId);
      } else if (item.kind === "manual" && item.membreId) {
        await checkinManuel(token, item.membreId, item.evenementId);
      } else {
        item.status = "rejected";
        item.error = "entrée incomplète";
        rejected += 1;
        continue;
      }
      item.status = "synced";
      delete item.error;
      synced += 1;
    } catch (err) {
      // A refusal is final and must be shown: an expired token, a closed file, a
      // malformed payload. Retrying it forever would hide it behind a queue that
      // never empties. Anything else is transient and stays pending.
      if (err instanceof ApiError && (err.status === 422 || err.status === 409 || err.status === 404)) {
        item.status = "rejected";
        item.error = err.message;
        rejected += 1;
      }
    }
  }
  saveQueue(items);
  return { synced, rejected, remaining: pendingCount(items), differes };
}

/** Re-read one entry after a sync, to report what actually became of it. */
export function relire(id: string): QueueItem | undefined {
  return loadQueue().find((i) => i.id === id);
}

export function clearSynced(): QueueItem[] {
  const items = loadQueue().filter((i) => i.status !== "synced");
  saveQueue(items);
  return items;
}
