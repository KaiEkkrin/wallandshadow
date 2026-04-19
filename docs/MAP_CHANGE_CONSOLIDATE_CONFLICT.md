# Possible conflict in consolidation?

Consider the following table of operations, time-ordered (earliest at the top), with operations on the same row happening concurrently:

| Writing client    | Consolidate              | Reading client |
|-------------------|--------------------------|----------------|
| Writes change 1   |                          |                |
| Writes change 2   |                          | Reads change 1 |
| Writes change 3   | Begins                   | Reads change 2 |
| Writes change 4   | Reads change 1-3         | Reads change 3 |
|                   | Writes new base change 5 | Reads change 4 |
| Writes change 6   | Commits                  |                |
| Exits             |                          | Reads change 6 |
| Full reload       |                          |                |

When the client reconnects with full reload, it must receive the base change (5), followed by the incremental changes 4 and 6 -- so, it must receive changes in order 5-4-6, otherwise it'll receive an inconsistent state with a client that didn't disconnect through this timeline. In other words, if the response to a request for full map state begins with the base change (5) and returns it plus every incremental change after it, the reconnected client will receive an inconsistent state (5, 6 only).
