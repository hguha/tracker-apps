// Sync bookkeeping stamped onto every synced row. Kept in one place so create and
// update always agree on the shape (createdAt/updatedAt/deletedAt/clientRev).

export function syncStamp(now = Date.now()) {
  return { createdAt: now, updatedAt: now, deletedAt: null, clientRev: 1 }
}

export function touch(clientRev: number, now = Date.now()) {
  return { updatedAt: now, clientRev: clientRev + 1 }
}
