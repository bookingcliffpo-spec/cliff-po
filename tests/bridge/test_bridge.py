"""Tests for bridge/wangp_bridge.py in --fake mode (no WanGP, no GPU)."""

import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bridge"))
import wangp_bridge  # noqa: E402

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


class MediaServer(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/frame.png":
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(PNG)))
            self.end_headers()
            self.wfile.write(PNG)
        else:
            self.send_response(404)
            self.end_headers()


def start(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        args = wangp_bridge.parse_args(
            ["--fake", "--port", "0", "--token", "t0ken", "--output-dir", cls.tmp.name, "--fake-step-seconds", "0.05"]
        )
        cls.server = start(wangp_bridge.serve(args))
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.media = start(ThreadingHTTPServer(("127.0.0.1", 0), MediaServer))
        cls.media_base = f"http://127.0.0.1:{cls.media.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.media.shutdown()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, token="t0ken"):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        if data:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if response.headers.get("Content-Type") == "application/json" else raw)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    def wait(self, job_id, timeout=10):
        deadline = time.time() + timeout
        while time.time() < deadline:
            _, job = self.call("GET", f"/v1/jobs/{job_id}")
            if job["status"] in ("completed", "failed", "canceled"):
                return job
            time.sleep(0.05)
        self.fail("job did not finish")

    def test_health_needs_no_token(self):
        status, body = self.call("GET", "/v1/health", token=None)
        self.assertEqual((status, body), (200, {"ok": True, "mode": "fake"}))

    def test_token_is_required(self):
        self.assertEqual(self.call("POST", "/v1/jobs", {"settings": {}}, token=None)[0], 401)
        self.assertEqual(self.call("POST", "/v1/jobs", {"settings": {}}, token="wrong")[0], 401)

    def test_submit_poll_complete_and_download(self):
        status, body = self.call(
            "POST",
            "/v1/jobs",
            {
                "settings": {
                    "model_type": "ltx2_22B_distilled",
                    "prompt": "a lighthouse",
                    "resolution": "1280x720",
                    "video_length": "5s",
                    "image_start": f"{self.media_base}/frame.png",
                    "output_filename": "../../escape",
                },
                "post": {"container": "mp4"},
            },
        )
        self.assertEqual(status, 200)
        job = self.wait(body["id"])
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["progress"], 100.0)
        self.assertEqual(len(job["files"]), 1)
        last = self.server.bridge.last_settings["settings"]
        self.assertNotIn("output_filename", last)
        self.assertTrue(Path(last["image_start"]).name.startswith("input1"))
        status, data = self.call("GET", f"/v1/files/{job['files'][0]}")
        self.assertEqual(status, 200)
        self.assertGreater(len(data), 0)

    def test_outputs_can_be_reused_as_inputs(self):
        _, first = self.call("POST", "/v1/jobs", {"settings": {"model_type": "m", "prompt": "a"}})
        done = self.wait(first["id"])
        _, second = self.call(
            "POST",
            "/v1/jobs",
            {"settings": {"model_type": "m", "prompt": "b", "video_source": f"/api/wangp/files/{done['files'][0]}"}},
        )
        self.assertEqual(self.wait(second["id"])["status"], "completed")
        self.assertTrue(self.server.bridge.last_settings["settings"]["video_source"].endswith(done["files"][0]))

    def test_bad_media_fails_the_job_with_a_reason(self):
        _, body = self.call("POST", "/v1/jobs", {"settings": {"model_type": "m", "prompt": "x", "image_start": "file:///etc/passwd"}})
        job = self.wait(body["id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("http(s)", job["error"])

    def test_cancel_a_running_job(self):
        _, body = self.call("POST", "/v1/jobs", {"settings": {"model_type": "m", "prompt": "slow"}})
        time.sleep(0.08)
        self.assertEqual(self.call("POST", f"/v1/jobs/{body['id']}/cancel", {})[0], 200)
        self.assertEqual(self.wait(body["id"])["status"], "canceled")

    def test_invalid_model_type_is_refused(self):
        status, body = self.call("POST", "/v1/jobs", {"settings": {"model_type": "../x", "prompt": "x"}})
        self.assertEqual(status, 400)
        self.assertIn("model_type", body["error"])

    def test_upload_then_use_as_input(self):
        request = urllib.request.Request(self.base + "/v1/uploads", data=PNG, method="POST")
        request.add_header("Authorization", "Bearer t0ken")
        request.add_header("Content-Type", "image/png")
        with urllib.request.urlopen(request, timeout=10) as response:
            name = json.loads(response.read())["name"]
        self.assertRegex(name, r"^up_[0-9a-f]{32}\.png$")
        status, data = self.call("GET", f"/v1/files/{name}")
        self.assertEqual((status, data), (200, PNG))
        _, body = self.call("POST", "/v1/jobs", {"settings": {"model_type": "m", "prompt": "x", "image_start": f"/api/wangp/files/{name}"}})
        self.assertEqual(self.wait(body["id"])["status"], "completed")

    def test_upload_rejects_unknown_types(self):
        request = urllib.request.Request(self.base + "/v1/uploads", data=b"hello", method="POST")
        request.add_header("Authorization", "Bearer t0ken")
        request.add_header("Content-Type", "text/plain")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(caught.exception.code, 415)

    def test_unknown_job_and_file(self):
        self.assertEqual(self.call("GET", "/v1/jobs/doesnotexist1")[0], 404)
        self.assertEqual(self.call("GET", "/v1/files/..%2Fsecret")[0], 404)


if __name__ == "__main__":
    unittest.main()
