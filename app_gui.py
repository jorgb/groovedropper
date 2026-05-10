"""
GUI entry point for GrooveDropper using pywebview (WebView2 on Windows).
Starts the Flask server in a background thread, then opens a native window.
"""
import argparse
import os
import socket
import sys
import threading
import time
from pathlib import Path

import webview

import app as flask_app
from groove import db


def _wait_for_server(port, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def main():
    default_db = str(Path.home() / 'groovedropper.db')
    parser = argparse.ArgumentParser(description="GrooveDropper - Desktop GUI mode")
    parser.add_argument('--db-file', default=default_db)
    parser.add_argument('--port', type=int, default=5000)
    args = parser.parse_args()

    db_path = str(Path(args.db_file).resolve())
    db.configure(db_path)
    db.migrate_db(db_path)
    flask_app.start_background_scan()

    flask_thread = threading.Thread(
        target=flask_app.run_app,
        kwargs={"port": args.port, "open_browser": False},
        daemon=True,
    )
    flask_thread.start()

    if not _wait_for_server(args.port):
        print("Flask server did not start in time.", file=sys.stderr)
        sys.exit(1)

    webview.create_window(
        "GrooveDropper",
        f"http://127.0.0.1:{args.port}",
        width=1280,
        height=800,
        min_size=(800, 600),
        maximized=True,
    )
    webview.start()
    os._exit(0)


if __name__ == "__main__":
    main()
