# Task: Delete Map Changes Subcollection on Map Deletion

## Problem

When a map is deleted via `deleteMap()` in [was-web/src/services/extensions.ts](../was-web/src/services/extensions.ts), only the map document itself and its denormalized references (in the adventure and profile) are removed. The `changes/` subcollection at `adventures/{adventureId}/maps/{mapId}/changes/` is **not deleted**.

Firestore does not cascade-delete subcollections. Every deleted map leaves behind potentially hundreds of change documents, accumulating Firestore storage and read costs indefinitely. The existing TODO comment in `deleteMapTransaction` (around line 353) acknowledges this:

```typescript
// TODO: We also need to remove the sub-collection of changes.
// Maybe, write a Function to do this deletion instead?
// https://firebase.google.com/docs/firestore/manage-data/delete-data
```

## Why It Can't Be Fixed Client-Side

The client-side `deleteMapTransaction` runs inside a Firestore web SDK transaction. Subcollection deletion requires:
1. Listing all documents in the subcollection (a collection query)
2. Deleting each one in batches

The Firestore web SDK does not support collection queries inside `runTransaction`, and a transaction is bounded to 500 document writes. Subcollections with hundreds of change documents can't be cleaned up atomically client-side.

## Recommended Solution

Add a `deleteMap` Cloud Function (server-side, Admin SDK) that handles the subcollection cleanup. Two viable approaches:

### Option A: Explicit callable function (simpler)

Add a new callable Cloud Function `deleteMapChanges(adventureId, mapId)` that the client calls immediately after the map document is deleted. The function uses the Admin SDK to list and batch-delete all documents in `changes/`:

```typescript
// In was-web/functions/src/index.ts
export const deleteMapChanges = functions.https.onCall(async (data, context) => {
  // Auth check: caller must own the adventure
  const { adventureId, mapId } = data;
  // ... verify ownership ...
  const changesRef = admin.firestore()
    .collection('adventures').doc(adventureId)
    .collection('maps').doc(mapId)
    .collection('changes');
  await deleteCollection(changesRef, 100);
});
```

The client calls this from `deleteMap()` after the transaction completes.

### Option B: Firestore `onDelete` trigger (cleaner, no client change needed)

Add a Firestore trigger that fires when a map document is deleted:

```typescript
export const onMapDeleted = functions.firestore
  .document('adventures/{adventureId}/maps/{mapId}')
  .onDelete(async (snap, context) => {
    const { adventureId, mapId } = context.params;
    const changesRef = admin.firestore()
      .collection('adventures').doc(adventureId)
      .collection('maps').doc(mapId)
      .collection('changes');
    await deleteCollection(changesRef, 100);
  });
```

This requires no client-side changes and fires automatically.

### Batch delete helper

Both options need a helper to batch-delete a collection (Firestore limits batch deletes to 500 documents):

```typescript
async function deleteCollection(
  ref: FirebaseFirestore.CollectionReference,
  batchSize: number
): Promise<void> {
  const db = ref.firestore;
  while (true) {
    const snapshot = await ref.limit(batchSize).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}
```

## Recommendation

**Option B** (Firestore trigger) is cleaner because:
- No client-side changes required
- Cleanup is guaranteed even if the client crashes after deleting the map
- Simpler to test (trigger fires on any map deletion, including administrative deletions)

## Files to Modify

| File | Change |
|---|---|
| `was-web/functions/src/index.ts` | Add `onMapDeleted` Firestore trigger |
| `was-web/functions/src/services/extensions.ts` | Add `deleteCollection` helper, or inline it |
| `was-web/src/services/extensions.ts` | Remove the TODO comment once fixed |

## Testing

1. Create a map, add several changes (incremental), then delete the map
2. Verify in the Firebase Emulator UI (http://localhost:4000 → Firestore) that the `changes/` subcollection is gone
3. Add a unit/integration test in `was-web/unit/services/functions.test.ts` that deletes a map and then checks the changes subcollection is empty

## Notes

- The `deleteAdventure` function requires all maps to be deleted first (enforced by a check in `deleteAdventureTransaction`), so fixing `deleteMap` is sufficient — there is no separate orphan risk from adventure deletion.
- The trigger approach may have known reliability issues in the Firebase emulator (Storage triggers are noted as unreliable in CI, but Firestore triggers generally work better). Test in the emulator before relying on it.
