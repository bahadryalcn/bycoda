# SQLite public extension ABI headers

These two SQLite3.53.2 public headers were copied byte-for-byte from the cached
upstream SQLite sources distributed with libsqlite3-sys0.38.2. Their original
public-domain notices are preserved. ORIGIN.json records exact hashes/version.

The Node physical-store package uses only the public sqlite3_api_routines ABI
supplied by the SQLite library which loads its extension. It does not compile or
link another SQLite engine and does not inspect private Node/SQLite object
layouts. Host runtime capability and actual connection checks remain explicit.
