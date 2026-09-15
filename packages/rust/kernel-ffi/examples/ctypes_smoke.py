"""Python host drives the Rust scheduler directly through the stable C ABI."""
import ctypes
import json
import sys


class Change(ctypes.Structure):
    _fields_ = [
        ("change_id", ctypes.c_uint64),
        ("info_id", ctypes.c_uint64),
        ("caused_by", ctypes.c_uint64),
        ("has_caused_by", ctypes.c_bool),
        ("generation", ctypes.c_uint64),
        ("entity", ctypes.c_void_p),
        ("info_type", ctypes.c_void_p),
        ("sender", ctypes.c_void_p),
        ("payload_json", ctypes.c_void_p),
        ("submission", ctypes.c_void_p),
    ]


class AnalysisEntry(ctypes.Structure):
    _fields_ = [("entity", ctypes.c_void_p), ("facts_json", ctypes.c_void_p)]


class AnalysisSnapshot(ctypes.Structure):
    _fields_ = [("len", ctypes.c_size_t), ("entries", ctypes.POINTER(AnalysisEntry))]


def utf8(pointer):
    return ctypes.string_at(pointer).decode("utf-8") if pointer else None


library = ctypes.CDLL(sys.argv[1])
library.gv_abi_version.restype = ctypes.c_uint32
assert library.gv_abi_version() == 1
library.gv_kernel_new.restype = ctypes.c_void_p
library.gv_kernel_free.argtypes = [ctypes.c_void_p]
library.gv_admit.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
library.gv_admit.restype = ctypes.c_int64
library.gv_inject_root.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p]
library.gv_inject_root.restype = ctypes.c_int32
library.gv_send.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p,
                            ctypes.c_char_p, ctypes.c_uint64, ctypes.c_bool, ctypes.c_char_p]
library.gv_send.restype = ctypes.c_int32
library.gv_poll_next.argtypes = [ctypes.c_void_p]
library.gv_poll_next.restype = ctypes.POINTER(Change)
library.gv_settle_change.argtypes = [ctypes.c_void_p, ctypes.POINTER(Change), ctypes.c_char_p]
library.gv_settle_change.restype = ctypes.c_bool
library.gv_set_analysis_facts.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint64, ctypes.c_char_p]
library.gv_set_analysis_facts.restype = ctypes.c_bool
library.gv_analysis_facts.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
library.gv_analysis_facts.restype = ctypes.c_void_p
library.gv_analysis_snapshot.argtypes = [ctypes.c_void_p]
library.gv_analysis_snapshot.restype = ctypes.POINTER(AnalysisSnapshot)
library.gv_analysis_snapshot_free.argtypes = [ctypes.POINTER(AnalysisSnapshot)]
library.gv_string_free.argtypes = [ctypes.c_void_p]
library.gv_pending_total.argtypes = [ctypes.c_void_p]
library.gv_pending_total.restype = ctypes.c_size_t

kernel = library.gv_kernel_new()
state = {"python.worker": {"runs": 0}, "target": {"done": 0}}
facts = {"version": 1, "nodeId": "python.worker", "entities": [
    {"address": "node:python.worker", "kind": "node", "id": "python.worker"}], "edges": []}
try:
    assert library.gv_admit(kernel, b"python.worker") == 0
    assert library.gv_admit(kernel, b"target") == 0
    assert library.gv_set_analysis_facts(kernel, b"python.worker", 0, json.dumps(facts).encode())
    assert library.gv_inject_root(kernel, b"python.worker", b"RunInfo", b"{}", b"sub/1") == 0
    while True:
        change = library.gv_poll_next(kernel)
        if not change:
            break
        entity = utf8(change.contents.entity)
        info_type = utf8(change.contents.info_type)
        if entity == "python.worker" and info_type == "RunInfo":
            state[entity]["runs"] += 1
            assert library.gv_send(kernel, b"python.worker", b"DoneInfo", b"{}", b"target",
                                   change.contents.change_id, True, utf8(change.contents.submission).encode()) == 0
        elif entity == "target" and info_type == "DoneInfo":
            state[entity]["done"] += 1
        assert library.gv_settle_change(kernel, change, None)
    snapshot = library.gv_analysis_facts(kernel, b"python.worker")
    try:
        assert json.loads(utf8(snapshot)) == facts
    finally:
        library.gv_string_free(snapshot)
    all_facts = library.gv_analysis_snapshot(kernel)
    try:
        assert all_facts.contents.len == 1
        assert utf8(all_facts.contents.entries[0].entity) == "python.worker"
        assert json.loads(utf8(all_facts.contents.entries[0].facts_json)) == facts
    finally:
        library.gv_analysis_snapshot_free(all_facts)
    assert state == {"python.worker": {"runs": 1}, "target": {"done": 1}}
    assert library.gv_pending_total(kernel) == 0
    print("Python C ABI host: two Nodes executed and analysis facts read")
finally:
    library.gv_kernel_free(kernel)
