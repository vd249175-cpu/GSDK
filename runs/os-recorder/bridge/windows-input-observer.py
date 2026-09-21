"""Emit privacy-preserving Windows desktop input observations as NDJSON."""

import ctypes
import json
import os
import sys
import threading
import time
from ctypes import wintypes


WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
WM_QUIT = 0x0012
WM_KEYUP = 0x0101
WM_SYSKEYUP = 0x0105
WM_LBUTTONUP = 0x0202
WM_RBUTTONUP = 0x0205
WM_MBUTTONUP = 0x0208
WM_MOUSEWHEEL = 0x020A
WM_MOUSEHWHEEL = 0x020E
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
LRESULT = ctypes.c_ssize_t


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


HOOKPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HHOOK
user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = LRESULT
user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def foreground_context():
    hwnd = user32.GetForegroundWindow()
    title = ""
    application = None
    if hwnd:
        buffer = ctypes.create_unicode_buffer(1024)
        user32.GetWindowTextW(hwnd, buffer, len(buffer))
        title = buffer.value
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, process_id.value)
        if handle:
            try:
                path_buffer = ctypes.create_unicode_buffer(32768)
                path_length = wintypes.DWORD(len(path_buffer))
                if kernel32.QueryFullProcessImageNameW(handle, 0, path_buffer, ctypes.byref(path_length)):
                    application = os.path.basename(path_buffer.value).upper()
            finally:
                kernel32.CloseHandle(handle)
    return {"application": application, "windowTitle": title or None}


def input_event(kind, **details):
    emit({
        "type": "input",
        "kind": kind,
        "timestamp": int(time.time() * 1000),
        **foreground_context(),
        **details,
    })


@HOOKPROC
def mouse_callback(code, message, pointer):
    if code >= 0:
        data = ctypes.cast(pointer, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
        if message == WM_LBUTTONUP:
            input_event("mouse", button="left", x=data.pt.x, y=data.pt.y)
        elif message == WM_RBUTTONUP:
            input_event("mouse", button="right", x=data.pt.x, y=data.pt.y)
        elif message == WM_MBUTTONUP:
            input_event("mouse", button="middle", x=data.pt.x, y=data.pt.y)
        elif message in (WM_MOUSEWHEEL, WM_MOUSEHWHEEL):
            delta = ctypes.c_short((data.mouseData >> 16) & 0xFFFF).value
            input_event("scroll", axis="horizontal" if message == WM_MOUSEHWHEEL else "vertical", delta=delta)
    return user32.CallNextHookEx(None, code, message, pointer)


@HOOKPROC
def keyboard_callback(code, message, pointer):
    if code >= 0 and message in (WM_KEYUP, WM_SYSKEYUP):
        input_event("keyboard")
    return user32.CallNextHookEx(None, code, message, pointer)


def stop_on_stdin_close(thread_id):
    try:
        sys.stdin.buffer.read()
    finally:
        user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)


def main():
    thread_id = kernel32.GetCurrentThreadId()
    mouse_hook = user32.SetWindowsHookExW(WH_MOUSE_LL, mouse_callback, None, 0)
    keyboard_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_callback, None, 0)
    if not mouse_hook or not keyboard_hook:
        raise ctypes.WinError(ctypes.get_last_error())

    threading.Thread(target=stop_on_stdin_close, args=(thread_id,), daemon=True).start()
    emit({"type": "ready"})
    message = wintypes.MSG()
    try:
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
    finally:
        user32.UnhookWindowsHookEx(mouse_hook)
        user32.UnhookWindowsHookEx(keyboard_hook)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "message": str(error)})
        raise
