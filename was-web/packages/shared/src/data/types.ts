// Legacy abstract timestamp type carried over from the Firestore era. Records
// read from PostgreSQL use numeric milliseconds; the object union branch is
// retained for schema rows that still carry an opaque server-side timestamp.
export type Timestamp = object;
