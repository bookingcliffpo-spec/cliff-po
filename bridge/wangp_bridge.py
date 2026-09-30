#!/usr/bin/env python3
"""HTTP bridge between the studio and WanGP (https://github.com/deepbeepmeep/Wan2GP).

Runs next to a WanGP install and drives it through WanGP's own Python API
(shared/api.py: init, submit_task, job events, cancel). Standard library only.

    python bridge/wangp_bridge.py --wangp-root /path/to/Wan2GP --token <secret>

Then point the studio at it: WANGP_URL=http://127.0.0.1:7870 WANGP_TOKEN=<secret>.
Use --fake to run without WanGP or a GPU (tests, trying the studio).

This product uses WanGP. Use of WanGP is subject to the WanGP terms.

API (JSON; every route but /v1/health needs "Authorization: Bearer <token>"
when a token is configured):
    GET  /v1/health                  -> {"ok": true, "mode": "wangp"|"fake"}
    POST /v1/jobs                    {"settings": {...}, "post": {...}} -> {"id"}
    GET  /v1/jobs/<id>               -> {"status", "progress", "phase", "error", "files"}
    POST /v1/jobs/<id>/cancel        -> {"ok": true}
    GET  /v1/files/<name>            -> the output file (supports Range)
"""

from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

JOB_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
OWN_OUTPUT = re.compile(r"^/api/wangp/files/([A-Za-z0-9._-]{1,200})$")

# Settings the studio may send. Anything else (output paths, LoRA downloads,
# filesystem options) is dropped so a request cannot reach outside a job.
ALLOWED_SETTINGS = {
    "model_type", "prompt", "negative_prompt", "resolution", "video_length", "seed",
    "video_prompt_type", "image_prompt_type", "audio_prompt_type", "force_fps",
    "num_inference_steps", "guidance_scale", "denoising_strength",
}
MEDIA_SINGLE = {"image_start", "image_end", "video_guide", "video_source", "audio_guide", "video_mask"}
MEDIA_LIST = {"image_refs"}
MEDIA_EXT = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/mpeg": ".mp3",
}
CONTENT_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
                 ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".wav": "audio/wav", ".mp3": "audio/mpeg"}
TERMINAL = {"completed", "failed", "canceled"}


class BridgeError(Exception):
    """A failure whose message is safe to return to the studio."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Job:
    def __init__(self, job_id: str, settings: dict[str, Any], post: dict[str, Any]):
        self.id = job_id
        self.settings = settings
        self.post = post
        self.status = "queued"
        self.progress = 0.0
        self.phase = ""
        self.error = ""
        self.files: list[str] = []
        self.created = time.time()
        self.cancel_requested = False
        self.handle: Any = None  # WanGP SessionJob while running
        self.workdir: Path | None = None

    def view(self) -> dict[str, Any]:
        return {
            "id": self.id, "status": self.status, "progress": round(self.progress, 1),
            "phase": self.phase, "error": self.error, "files": list(self.files),
        }


class Bridge:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.output_dir = Path(args.output_dir).resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.queue: "queue.Queue[str]" = queue.Queue()
        self.session: Any = None
        self.last_settings: dict[str, Any] | None = None  # fake mode only, for tests
        self.ffmpeg = args.ffmpeg or shutil.which("ffmpeg")
        threading.Thread(target=self._worker, name="wangp-worker", daemon=True).start()

    # ---------- job lifecycle ----------

    def submit(self, body: Any) -> Job:
        if not isinstance(body, dict) or not isinstance(body.get("settings"), dict):
            raise BridgeError("Expected {\"settings\": {...}}.")
        raw = body["settings"]
        post = body.get("post") if isinstance(body.get("post"), dict) else {}
        settings: dict[str, Any] = {}
        for key, value in raw.items():
            if key in ALLOWED_SETTINGS or key in MEDIA_SINGLE or key in MEDIA_LIST:
                settings[key] = value
        if not isinstance(settings.get("model_type"), str) or not re.match(r"^[A-Za-z0-9._-]+$", settings["model_type"]):
            raise BridgeError("settings.model_type is missing or invalid.")
        if not isinstance(settings.get("prompt"), str):
            settings["prompt"] = ""
        job = Job(secrets.token_urlsafe(12).replace("-", "a").replace("_", "b"), settings, post)
        with self.lock:
            self.jobs[job.id] = job
        self.queue.put(job.id)
        return job

    def get(self, job_id: str) -> Job:
        with self.lock:
            job = self.jobs.get(job_id)
        if not job:
            raise BridgeError("Unknown job.", 404)
        return job

    def cancel(self, job_id: str) -> None:
        job = self.get(job_id)
        job.cancel_requested = True
        if job.status == "queued":
            job.status = "canceled"
            job.phase = ""
        elif job.status == "in_progress" and job.handle is not None:
            try:
                job.handle.cancel()
            except Exception:  # noqa: BLE001 - cancellation is best effort
                pass

    def _worker(self) -> None:
        while True:
            job_id = self.queue.get()
            job = self.jobs.get(job_id)
            if not job or job.status != "queued":
                continue
            job.status = "in_progress"
            job.phase = "Preparing inputs"
            try:
                job.workdir = Path(tempfile.mkdtemp(prefix=f"wangp-{job.id}-"))
                settings = self._resolve_media(job)
                if job.post.get("reverseInput") and settings.get("video_source"):
                    settings["video_source"] = self._ffmpeg_reverse(Path(settings["video_source"]), job.workdir)
                if job.cancel_requested:
                    raise BridgeError("Canceled.")
                outputs = self._run_fake(job, settings) if self.args.fake else self._run_wangp(job, settings)
                job.phase = "Finishing"
                job.files = [self._finish(job, Path(path), index) for index, path in enumerate(outputs)]
                if not job.files:
                    raise BridgeError("WanGP finished without producing a file.")
                job.progress = 100.0
                job.status = "completed"
                job.phase = ""
            except BridgeError as error:
                job.status = "canceled" if job.cancel_requested else "failed"
                job.error = "" if job.cancel_requested else str(error)
            except Exception as error:  # noqa: BLE001 - report, never crash the worker
                job.status = "canceled" if job.cancel_requested else "failed"
                job.error = "" if job.cancel_requested else f"WanGP error: {type(error).__name__}: {str(error)[:240]}"
            finally:
                if job.workdir:
                    shutil.rmtree(job.workdir, ignore_errors=True)
                job.handle = None

    # ---------- media ----------

    def _resolve_media(self, job: Job) -> dict[str, Any]:
        settings = dict(job.settings)
        assert job.workdir is not None
        counter = 0

        def fetch(value: Any) -> str:
            nonlocal counter
            if not isinstance(value, str) or not value:
                raise BridgeError("Media values must be URLs.")
            own = OWN_OUTPUT.match(value)
            if own:
                path = self.output_dir / own.group(1)
                if not path.is_file():
                    raise BridgeError("An earlier WanGP output used as input no longer exists.")
                return str(path)
            counter += 1
            return str(self._download(value, job.workdir, f"input{counter}"))

        for key in MEDIA_SINGLE:
            if key in settings and settings[key]:
                settings[key] = fetch(settings[key])
        for key in MEDIA_LIST:
            if key in settings and settings[key]:
                values = settings[key] if isinstance(settings[key], list) else [settings[key]]
                settings[key] = [fetch(value) for value in values[:30]]
        return settings

    def _download(self, url: str, folder: Path, stem: str) -> Path:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise BridgeError("Media URLs must be http(s).")
        if self.args.block_private and _is_private(parsed.hostname):
            raise BridgeError("Media URL points at a private address (disable with --allow-private).")
        limit = self.args.max_download_mb * 1024 * 1024
        request = urllib.request.Request(url, headers={"User-Agent": "wangp-bridge/1"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - scheme checked above
                content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                ext = MEDIA_EXT.get(content_type) or Path(parsed.path).suffix.lower() or ".bin"
                if ext not in CONTENT_TYPES and ext not in (".jpg", ".png", ".webp", ".gif", ".wav", ".mp3"):
                    raise BridgeError(f"Unsupported media type {content_type or ext}.")
                target = folder / f"{stem}{ext}"
                size = 0
                with open(target, "wb") as out:
                    while chunk := response.read(1024 * 256):
                        size += len(chunk)
                        if size > limit:
                            raise BridgeError(f"Media larger than {self.args.max_download_mb} MB.")
                        out.write(chunk)
        except BridgeError:
            raise
        except Exception as error:  # noqa: BLE001
            raise BridgeError(f"Could not download an input ({type(error).__name__}).") from error
        return target

    # ---------- running ----------

    def _session(self) -> Any:
        if self.session is None:
            root = Path(self.args.wangp_root).resolve()
            if not (root / "wgp.py").is_file():
                raise BridgeError(f"--wangp-root {root} is not a WanGP install (no wgp.py).", 500)
            sys.path.insert(0, str(root))
            from shared.api import init  # type: ignore[import-not-found]

            cli_args = [arg for arg in (self.args.wangp_args or "").split() if arg]
            self.session = init(root=root, cli_args=cli_args, console_output=True)
        return self.session

    def _run_wangp(self, job: Job, settings: dict[str, Any]) -> list[str]:
        job.phase = "Loading WanGP"
        session = self._session()
        bridge_job = job

        class Callbacks:
            def on_status(self, status: Any) -> None:
                text = str(status or "").strip()
                if text:
                    bridge_job.phase = text[:80]

            def on_progress(self, update: Any) -> None:
                try:
                    bridge_job.progress = max(0.0, min(99.0, float(getattr(update, "progress", 0) or 0)))
                except (TypeError, ValueError):
                    pass
                phase = getattr(update, "raw_phase", None) or getattr(update, "phase", None)
                if phase:
                    bridge_job.phase = str(phase)[:80]

        job.phase = "Queued in WanGP"
        handle = session.submit_task(settings, callbacks=Callbacks())
        job.handle = handle
        if job.cancel_requested:
            handle.cancel()
        result = handle.result()
        if not getattr(result, "success", False):
            errors = getattr(result, "errors", []) or []
            if any(getattr(error, "stage", "") == "cancelled" for error in errors) or job.cancel_requested:
                job.cancel_requested = True
                raise BridgeError("Canceled.")
            message = "; ".join(str(getattr(error, "message", error)) for error in errors)[:300]
            raise BridgeError(message or "WanGP reported a failure.")
        return [path for path in getattr(result, "generated_files", []) if path]

    def _run_fake(self, job: Job, settings: dict[str, Any]) -> list[str]:
        self.last_settings = {"settings": settings, "post": job.post}
        steps = max(1, int(self.args.fake_steps))
        for step in range(steps):
            if job.cancel_requested:
                raise BridgeError("Canceled.")
            job.phase = "Denoising"
            job.progress = 100.0 * step / steps
            time.sleep(self.args.fake_step_seconds)
        assert job.workdir is not None
        target = job.workdir / "fake.mp4"
        sample = Path(__file__).with_name("sample.mp4")
        if sample.is_file():
            shutil.copyfile(sample, target)
        else:
            target.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
        return [str(target)]

    # ---------- output ----------

    def _finish(self, job: Job, source: Path, index: int) -> str:
        if not source.is_file():
            raise BridgeError("WanGP reported an output file that does not exist.")
        post = job.post
        ext = source.suffix.lower() or ".mp4"
        is_video = ext in (".mp4", ".mov", ".webm", ".mkv")
        container = post.get("container") if post.get("container") in ("mp4", "mov") else None
        out_ext = f".{container}" if (is_video and container) else ext
        name = f"{job.id}_{index}{out_ext}"
        target = self.output_dir / name
        needs_ffmpeg = is_video and (post.get("reverseOutput") or post.get("stripAudio") or out_ext != ext)
        if needs_ffmpeg and not self.args.fake:
            args = ["-i", str(source)]
            if post.get("reverseOutput"):
                args += ["-vf", "reverse", "-an"]
            elif post.get("stripAudio"):
                args += ["-c:v", "copy", "-an"]
            else:
                args += ["-c", "copy"]
            self._ffmpeg([*args, str(target)])
        else:
            shutil.copyfile(source, target)
        return name

    def _ffmpeg(self, args: list[str]) -> None:
        if not self.ffmpeg:
            raise BridgeError("ffmpeg not found — install it or pass --ffmpeg /path/to/ffmpeg.", 500)
        done = subprocess.run([self.ffmpeg, "-y", "-loglevel", "error", *args], capture_output=True, timeout=900)
        if done.returncode != 0:
            raise BridgeError(f"ffmpeg failed: {done.stderr.decode(errors='ignore')[:200]}")

    def _ffmpeg_reverse(self, source: Path, folder: Path) -> str:
        if self.args.fake:
            return str(source)
        target = folder / f"reversed{source.suffix or '.mp4'}"
        self._ffmpeg(["-i", str(source), "-vf", "reverse", "-an", str(target)])
        return str(target)


def _is_private(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local:
            return True
    return False


def make_handler(bridge: Bridge, token: str | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "wangp-bridge/1"

        def log_message(self, fmt: str, *args: Any) -> None:  # never log headers or bodies
            sys.stderr.write(f"[bridge] {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")

        def _json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self) -> bool:
            if not token:
                return True
            header = self.headers.get("Authorization", "")
            return header.startswith("Bearer ") and hmac.compare_digest(header[7:].strip(), token)

        def _body(self) -> Any:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 2 * 1024 * 1024:
                raise BridgeError("Request too large.", 413)
            raw = self.rfile.read(length) if length else b""
            try:
                return json.loads(raw or b"{}")
            except json.JSONDecodeError as error:
                raise BridgeError("Body must be JSON.") from error

        def _route(self, method: str) -> None:
            path = urllib.parse.urlparse(self.path).path
            try:
                if path == "/v1/health" and method == "GET":
                    return self._json(200, {"ok": True, "mode": "fake" if bridge.args.fake else "wangp"})
                if not self._authorized():
                    return self._json(401, {"error": "Missing or wrong bridge token."})
                if path == "/v1/jobs" and method == "POST":
                    job = bridge.submit(self._body())
                    return self._json(200, {"id": job.id})
                match = re.match(r"^/v1/jobs/([A-Za-z0-9_-]+)(/cancel)?$", path)
                if match and JOB_ID.match(match.group(1)):
                    if match.group(2) and method == "POST":
                        bridge.cancel(match.group(1))
                        return self._json(200, {"ok": True})
                    if not match.group(2) and method == "GET":
                        return self._json(200, bridge.get(match.group(1)).view())
                if path == "/v1/debug/last" and method == "GET" and bridge.args.fake:
                    return self._json(200, bridge.last_settings or {})
                match = re.match(r"^/v1/files/([^/]+)$", path)
                if match and method == "GET":
                    return self._file(urllib.parse.unquote(match.group(1)))
                return self._json(404, {"error": "Not found."})
            except BridgeError as error:
                return self._json(error.status, {"error": str(error)})
            except Exception as error:  # noqa: BLE001
                return self._json(500, {"error": f"Bridge error: {type(error).__name__}"})

        def _file(self, name: str) -> None:
            if not FILE_NAME.match(name):
                return self._json(404, {"error": "Not found."})
            path = bridge.output_dir / name
            if not path.is_file():
                return self._json(404, {"error": "Not found."})
            size = path.stat().st_size
            start, end = 0, size - 1
            range_header = self.headers.get("Range", "")
            match = re.match(r"^bytes=(\d*)-(\d*)$", range_header)
            partial = bool(match and (match.group(1) or match.group(2)))
            if partial:
                if match.group(1):
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else size - 1
                else:
                    start = max(0, size - int(match.group(2)))
                end = min(end, size - 1)
                if start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream"))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with open(path, "rb") as handle:
                handle.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = handle.read(min(1024 * 256, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

        def do_GET(self) -> None:  # noqa: N802
            self._route("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._route("POST")

    return Handler


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HTTP bridge between the studio and WanGP.")
    parser.add_argument("--wangp-root", default=os.environ.get("WANGP_ROOT", ""), help="WanGP install folder (contains wgp.py)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("WANGP_BRIDGE_PORT", "7870")))
    parser.add_argument("--token", default=os.environ.get("WANGP_BRIDGE_TOKEN", ""), help="Bearer token the studio must send")
    parser.add_argument("--output-dir", default=os.environ.get("WANGP_BRIDGE_OUTPUTS", "bridge-outputs"))
    parser.add_argument("--wangp-args", default=os.environ.get("WANGP_ARGS", ""), help='Extra WanGP flags, e.g. "--attention sdpa --profile 4"')
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG", ""))
    parser.add_argument("--max-download-mb", type=int, default=500)
    parser.add_argument("--block-private", action="store_true", help="Refuse media URLs on private addresses")
    parser.add_argument("--fake", action="store_true", help="No WanGP: simulate jobs (tests, demos)")
    parser.add_argument("--fake-steps", type=int, default=4)
    parser.add_argument("--fake-step-seconds", type=float, default=0.25)
    args = parser.parse_args(argv)
    if not args.fake and not args.wangp_root:
        parser.error("--wangp-root is required (or use --fake)")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not args.token:
        parser.error("--token is required when listening beyond localhost")
    return args


def serve(args: argparse.Namespace) -> ThreadingHTTPServer:
    bridge = Bridge(args)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(bridge, args.token or None))
    server.bridge = bridge  # type: ignore[attr-defined]
    return server


def main() -> None:
    args = parse_args()
    server = serve(args)
    mode = "FAKE (no WanGP)" if args.fake else f"WanGP at {args.wangp_root}"
    print(f"WanGP bridge on http://{args.host}:{server.server_address[1]} — {mode}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
