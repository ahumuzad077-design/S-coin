import os
import unittest
from unittest.mock import patch

import web
from bot import load_config


class SentinelWebAuthTests(unittest.TestCase):
    def setUp(self):
        web._API_TOKEN = "s" * 48
        self.client = web.app.test_client()

    def test_health_check_does_not_expose_secrets(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["service"], "scoin-sentinel")
        self.assertTrue(payload["authenticationConfigured"])
        self.assertNotIn("token", str(payload).lower())

    def test_api_is_protected_without_credentials(self):
        response = self.client.get("/api/state")
        self.assertEqual(response.status_code, 401)

    def test_login_rejects_wrong_token(self):
        response = self.client.post("/api/session", json={"token": "wrong"})
        self.assertEqual(response.status_code, 401)

    def test_login_sets_httponly_cookie_and_unlocks_api(self):
        response = self.client.post("/api/session", json={"token": "s" * 48})
        self.assertEqual(response.status_code, 200)
        cookie = response.headers.get("Set-Cookie", "")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        protected = self.client.get("/api/state")
        self.assertEqual(protected.status_code, 200)

    def test_api_accepts_server_side_bearer_token(self):
        response = self.client.get(
            "/api/state",
            headers={"Authorization": "Bearer " + "s" * 48},
        )
        self.assertEqual(response.status_code, 200)

    def test_short_access_token_fails_closed(self):
        web._API_TOKEN = "too-short"
        response = self.client.post("/api/session", json={"token": "too-short"})
        self.assertEqual(response.status_code, 503)

    def test_live_trading_remains_paper_by_default(self):
        base_env = {
            "ALPACA_API_KEY": "test-key",
            "ALPACA_SECRET_KEY": "test-secret",
            "GROQ_API_KEY": "test-groq",
        }
        with patch.dict(os.environ, {**base_env, "ALPACA_PAPER_TRADE": "false"}, clear=True):
            self.assertTrue(load_config()["paper"])

    def test_live_trading_requires_two_explicit_switches(self):
        base_env = {
            "ALPACA_API_KEY": "test-key",
            "ALPACA_SECRET_KEY": "test-secret",
            "GROQ_API_KEY": "test-groq",
            "ALPACA_PAPER_TRADE": "false",
            "SENTINEL_LIVE_TRADING_ENABLED": "true",
        }
        with patch.dict(os.environ, base_env, clear=True):
            self.assertFalse(load_config()["paper"])
        base_env["SENTINEL_LIVE_TRADING_ENABLED"] = "false"
        with patch.dict(os.environ, base_env, clear=True):
            self.assertTrue(load_config()["paper"])


if __name__ == "__main__":
    unittest.main()
