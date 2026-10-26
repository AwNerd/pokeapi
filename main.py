"""Run the whole app: python3 main.py

Installs npm dependencies if missing, starts the backend (:3000) and frontend (:5173),
opens the browser, and stops both on Ctrl+C. Standard library only.
"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APPS = [  # (name, folder, port, color)
    ("backend", ROOT / "backend", 3000, "\033[36m"),
    ("frontend", ROOT / "frontend", 5173, "\033[35m"),
]
URL = "http://localhost:5173"
RESET, BOLD, RED = "\033[0m", "\033[1m", "\033[31m"
IS_WINDOWS = os.name == "nt"


def fail(message):
    print(f"{RED}{message}{RESET}")
    sys.exit(1)


def port_in_use(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def check_setup(npm):
    if not npm:
        fail("npm not found. Install Node.js 22.18+ from https://nodejs.org and try again.")
    if not (ROOT / "backend" / ".env").exists():
        fail("backend/.env is missing. Create it with OPENAI_API_KEY (see README.md).")
    for name, _, port, _ in APPS:
        if port_in_use(port):
            fail(f"Port {port} ({name}) is already in use. Stop whatever is running there and try again.")


def install_if_needed(npm):
    for name, folder, _, _ in APPS:
        if not (folder / "node_modules").exists():
            print(f"{BOLD}Installing {name} dependencies...{RESET}")
            if subprocess.run([npm, "install"], cwd=folder).returncode != 0:
                fail(f"npm install failed in {folder.name}/")


def stream(proc, name, color):
    """Print a process's output with a colored [name] prefix."""
    for line in proc.stdout:
        print(f"{color}[{name}]{RESET} {line}", end="", flush=True)


def start(npm, name, folder, color):
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WINDOWS else {"start_new_session": True}
    proc = subprocess.Popen(
        [npm, "run", "dev"], cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", **kwargs,
    )
    threading.Thread(target=stream, args=(proc, name, color), daemon=True).start()
    return proc


def stop(procs):
    """Stop each process and everything it started (npm runs node as a child)."""
    for proc in procs:
        if proc.poll() is not None:
            continue
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        else:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for proc in procs:
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if not IS_WINDOWS:
                os.killpg(proc.pid, signal.SIGKILL)


def open_browser_when_ready(procs):
    for _ in range(60):  # up to ~30s
        if any(p.poll() is not None for p in procs):
            return
        try:
            urllib.request.urlopen(URL, timeout=1)
        except OSError:
            time.sleep(0.5)
            continue
        print(f"\n{BOLD}Chatbot ready at {URL}  (Ctrl+C to stop){RESET}\n", flush=True)
        webbrowser.open(URL)
        return


def main():
    npm = shutil.which("npm")
    check_setup(npm)
    install_if_needed(npm)

    procs = [start(npm, name, folder, color) for name, folder, _, color in APPS]
    threading.Thread(target=open_browser_when_ready, args=(procs,), daemon=True).start()

    exit_code = 0
    try:
        while True:
            for (name, *_), proc in zip(APPS, procs):
                if proc.poll() is not None:
                    print(f"\n{RED}{name} stopped (exit code {proc.returncode}). Shutting down.{RESET}")
                    exit_code = 1
                    raise KeyboardInterrupt
            time.sleep(0.5)
    except KeyboardInterrupt:
        print(f"\n{BOLD}Stopping...{RESET}")
        stop(procs)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
