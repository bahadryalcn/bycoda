/* Public SQLite extension ABI only. Never link another engine or inspect Node. */
#define SQLITE_CORE 1
#include "sqlite3ext.h"
#include <stddef.h>

#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif
#include <windows.h>
#include <stdio.h>

typedef void *(*UserDataFunction)(sqlite3_context *);
typedef void (*ResultErrorFunction)(sqlite3_context *, const char *, int);
typedef struct {
  UserDataFunction user_data;
  ResultErrorFunction result_error;
} Bootstrap;
typedef struct {
  sqlite3 *(*context_db_handle)(sqlite3_context *);
  int (*file_control)(sqlite3 *, const char *, int, void *);
  ResultErrorFunction result_error;
  void (*result_text)(sqlite3_context *, const char *, int, void (*)(void *));
  void (*free)(void *);
} ConnectionApi;
typedef struct {
  ConnectionApi api;
  sqlite3 *database;
} IdentityContext;

/* SQLite callbacks need one engine-specific user_data accessor to recover their
 * per-connection context. Slots are bounded and immutable after publication.
 * No global SQLite API table is replaced by another connection/library. */
#define BOOTSTRAP_LIMIT 16
static SRWLOCK bootstrap_lock = SRWLOCK_INIT;
static Bootstrap bootstraps[BOOTSTRAP_LIMIT];
static unsigned int bootstrap_count = 0;

static void identity_at(unsigned int slot, sqlite3_context *sql_context) {
  Bootstrap bootstrap;
  IdentityContext *context;
  HANDLE borrowed = INVALID_HANDLE_VALUE;
  FILE_ID_INFO physical;
  BY_HANDLE_FILE_INFORMATION metadata;
  char identifier[33];
  char output[160];
  unsigned int index;
  int code;
  AcquireSRWLockShared(&bootstrap_lock);
  bootstrap = bootstraps[slot];
  ReleaseSRWLockShared(&bootstrap_lock);
  context = (IdentityContext *)bootstrap.user_data(sql_context);
  if (context == NULL || context->api.context_db_handle(sql_context) != context->database) {
    bootstrap.result_error(sql_context, "BYCODA_SQLITE_IDENTITY_CONTEXT_MISMATCH", -1);
    return;
  }
  code = context->api.file_control(context->database, "main", SQLITE_FCNTL_WIN32_GET_HANDLE, &borrowed);
  if (code != SQLITE_OK || borrowed == NULL || borrowed == INVALID_HANDLE_VALUE) {
    context->api.result_error(sql_context, "BYCODA_SQLITE_IDENTITY_HANDLE_UNAVAILABLE", -1);
    return;
  }
  if (!GetFileInformationByHandle(borrowed, &metadata) ||
      !GetFileInformationByHandleEx(borrowed, FileIdInfo, &physical, sizeof(physical)) ||
      (metadata.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ||
      GetFileType(borrowed) != FILE_TYPE_DISK) {
    context->api.result_error(sql_context, "BYCODA_SQLITE_IDENTITY_FILE_UNAVAILABLE", -1);
    return;
  }
  for (index = 0; index < 16; ++index) {
    sprintf_s(identifier + index * 2, sizeof(identifier) - index * 2,
        "%02x", physical.FileId.Identifier[index]);
  }
  sprintf_s(output, sizeof(output),
      "{\"version\":1,\"physicalFileId\":\"windows-file:%016llx:%s\",\"links\":%u}",
      (unsigned long long)physical.VolumeSerialNumber, identifier,
      (unsigned int)metadata.nNumberOfLinks);
  context->api.result_text(sql_context, output, -1, SQLITE_TRANSIENT);
  /* HANDLE is borrowed from the live SQLite connection; NEVER CloseHandle. */
}

#define DECLARE_CALLBACK(N) \
  static void identity_##N(sqlite3_context *context, int argc, sqlite3_value **argv) { \
    (void)argc; (void)argv; identity_at(N, context); \
  }
DECLARE_CALLBACK(0) DECLARE_CALLBACK(1) DECLARE_CALLBACK(2) DECLARE_CALLBACK(3)
DECLARE_CALLBACK(4) DECLARE_CALLBACK(5) DECLARE_CALLBACK(6) DECLARE_CALLBACK(7)
DECLARE_CALLBACK(8) DECLARE_CALLBACK(9) DECLARE_CALLBACK(10) DECLARE_CALLBACK(11)
DECLARE_CALLBACK(12) DECLARE_CALLBACK(13) DECLARE_CALLBACK(14) DECLARE_CALLBACK(15)
static void (*const callbacks[BOOTSTRAP_LIMIT])(sqlite3_context *, int, sqlite3_value **) = {
  identity_0, identity_1, identity_2, identity_3, identity_4, identity_5, identity_6, identity_7,
  identity_8, identity_9, identity_10, identity_11, identity_12, identity_13, identity_14, identity_15
};

static void destroy_context(void *data) {
  IdentityContext *context = (IdentityContext *)data;
  context->api.free(context);
}

int bycoda_sqlite_extension_init(sqlite3 *database, char **error, const sqlite3_api_routines *api) {
  IdentityContext *context;
  unsigned int slot;
  if (database == NULL || api == NULL || api->user_data == NULL || api->context_db_handle == NULL ||
      api->file_control == NULL || api->malloc64 == NULL || api->free == NULL ||
      api->result_error == NULL || api->result_text == NULL || api->create_function_v2 == NULL) {
    return SQLITE_MISUSE;
  }
  (void)error;
  AcquireSRWLockExclusive(&bootstrap_lock);
  for (slot = 0; slot < bootstrap_count; ++slot) {
    if (bootstraps[slot].user_data == api->user_data && bootstraps[slot].result_error == api->result_error) break;
  }
  if (slot == bootstrap_count) {
    if (bootstrap_count == BOOTSTRAP_LIMIT) { ReleaseSRWLockExclusive(&bootstrap_lock); return SQLITE_FULL; }
    bootstraps[slot].user_data = api->user_data;
    bootstraps[slot].result_error = api->result_error;
    bootstrap_count++;
  }
  ReleaseSRWLockExclusive(&bootstrap_lock);
  context = (IdentityContext *)api->malloc64(sizeof(*context));
  if (context == NULL) return SQLITE_NOMEM;
  context->api.context_db_handle = api->context_db_handle;
  context->api.file_control = api->file_control;
  context->api.result_error = api->result_error;
  context->api.result_text = api->result_text;
  context->api.free = api->free;
  context->database = database;
  /* SQLite invokes destroy_context even if create_function_v2 fails. */
  return api->create_function_v2(database, "bycoda_connection_identity", 0,
      SQLITE_UTF8 | SQLITE_DIRECTONLY, context, callbacks[slot], NULL, NULL, destroy_context);
}
#else
int bycoda_sqlite_extension_init(sqlite3 *database, char **error, const sqlite3_api_routines *api) {
  (void)database;
  if (error != NULL && api != NULL && api->mprintf != NULL) {
    *error = api->mprintf("BYCODA_SQLITE_CONNECTION_ATTESTATION_UNSUPPORTED");
  }
  return SQLITE_ERROR;
}
#endif
