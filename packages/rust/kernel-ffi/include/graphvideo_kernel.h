#ifndef GRAPHVIDEO_KERNEL_H
#define GRAPHVIDEO_KERNEL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GvKernel GvKernel;

/* Strings returned by the library are UTF-8 and must be freed with gv_string_free.
 * Every polled change must be settled. gv_change_free only releases memory;
 * it does not settle the active change and is for abandoned handles. */
typedef struct GvChange {
  uint64_t change_id;
  uint64_t info_id;
  uint64_t caused_by;
  bool has_caused_by;
  uint64_t generation;
  char *entity;
  char *info_type;
  char *sender;
  char *payload_json;
  char *submission;
} GvChange;

typedef struct GvAnalysisEntry {
  char *entity;
  char *facts_json;
} GvAnalysisEntry;

typedef struct GvAnalysisSnapshot {
  size_t len;
  GvAnalysisEntry *entries;
} GvAnalysisSnapshot;

GvKernel *gv_kernel_new(void);
uint32_t gv_abi_version(void);
void gv_kernel_free(GvKernel *kernel);
/* Empty, settled space only. Idempotent; rejects future admission/delivery. */
bool gv_kernel_shutdown(GvKernel *kernel);
int64_t gv_admit(GvKernel *kernel, const char *id);
bool gv_evict(GvKernel *kernel, const char *id);
int64_t gv_replace(GvKernel *kernel, const char *id);
int64_t gv_generation(GvKernel *kernel, const char *id);
int64_t gv_begin_edit(GvKernel *kernel, const char *id);
bool gv_end_edit(GvKernel *kernel, const char *id, uint64_t generation);
void gv_abort_edit(GvKernel *kernel, const char *id);

/* 0=enqueued; 1=unknown target; 2=sealed; 3=stale generation;
 * 4=cancelled; 5=evicted; 6=kernel shutdown; -1=invalid call. */
int32_t gv_send(GvKernel *kernel, const char *sender, const char *info_type,
                const char *payload_json, const char *target, uint64_t caused_by,
                bool has_caused_by, const char *submission);
int32_t gv_inject_root(GvKernel *kernel, const char *target,
                       const char *info_type, const char *payload_json,
                       const char *submission);
GvChange *gv_poll_next(GvKernel *kernel);
bool gv_settle_change(GvKernel *kernel, GvChange *change,
                      const char *failed_message);
void gv_change_free(GvChange *change);
bool gv_cancel(GvKernel *kernel, const char *submission);
size_t gv_pending_total(GvKernel *kernel);
char *gv_submission_state(GvKernel *kernel, const char *submission);

/* Registration-time, opaque static evidence. Dispatch never reads it. */
bool gv_set_analysis_facts(GvKernel *kernel, const char *id, uint64_t generation,
                           const char *facts_json);
char *gv_analysis_facts(GvKernel *kernel, const char *id);
GvAnalysisSnapshot *gv_analysis_snapshot(GvKernel *kernel);
void gv_analysis_snapshot_free(GvAnalysisSnapshot *snapshot);
void gv_string_free(char *value);

/* Authoritative analysis compute over portable facts, shared with the daemon
 * and the N-API facade. request_json is one analysis request DTO (no
 * `instances` op); facts_json carries {snapshots:[], liveStates:{}} plus
 * optional frontendLinks / frontendServiceLinks context arrays (a bare
 * snapshot array is also accepted). Returns key-sorted result JSON, or NULL
 * on invalid input; free with gv_analysis_free. No algorithms live here. */
char *gv_analyze(const char *request_json, const char *facts_json);
void gv_analysis_free(char *value);

#ifdef __cplusplus
}
#endif
#endif
