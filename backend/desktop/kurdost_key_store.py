# -*- coding: utf-8 -*-
"""
KURDOST Key Store - Production Ready
Secure desktop configuration manager for LLM API keys (SambaNova/Groq)
"""

from __future__ import annotations

import copy
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import queue
import re
import shutil
import tempfile
import threading
import time
import urllib.request
import urllib.error
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import tkinter as tk
from tkinter import ttk, messagebox

import yaml

FERNET_AVAILABLE = False
try:
    from cryptography.fernet import Fernet, InvalidToken  # type: ignore
    FERNET_AVAILABLE = True
except Exception:
    Fernet = None  # type: ignore
    InvalidToken = Exception  # type: ignore

APP_NAME = "مخزن مفاتيح KURDOST"
_default_config = Path(os.environ.get(
    "KURDOST_CONFIG_PATH",
    str(Path.home() / ".continue" / "config.yaml")
))
CONFIG_PATH = _default_config
APP_DIR = CONFIG_PATH.parent
BACKUP_DIR = APP_DIR / "backups"
AUDIT_LOG_PATH = APP_DIR / "kurdost_audit.log"
LOCK_PATH = APP_DIR / ".config.lock"
SECURITY_META_PATH = APP_DIR / ".kurdost_security.yaml"

SUPPORTED_PROVIDERS = ("SambaNova", "Groq")
STATUS_UNKNOWN_ICON = "⏳"
STATUS_OK_ICON = "✅"
STATUS_NEEDS_RENEW_ICON = "⚠️"

DEFAULT_MODELS = {
    "SambaNova": "Meta-Llama-3.1-8B-Instruct",
    "Groq": "llama-3.1-8b-instant",
}

KURDISH_SORANI_CHARS = set("ێۆڵڕڤگچژە")
ARABIC_UNICODE_RE = re.compile(r"[\u0600-\u06FF]")

TRANSLATIONS: Dict[str, Dict[str, str]] = {
    "en": {
        "app_title": "KURDOST Key Store",
        "input_key": "Input Key:",
        "provider_label": "Provider:",
        "secure_mode": "Secure Mode (Encrypt API key in config.yaml)",
        "update_key": "Add/Update Key",
        "keys_section": "Stored Keys",
        "tree_provider": "Provider",
        "tree_title": "Account",
        "tree_masked": "Masked Key",
        "tree_status": "Status",
        "refresh_list": "Refresh List",
        "validate_status": "Check Status",
        "delete_selected": "Delete Selected Key",
        "ready": "Ready",
        "status_start": "Starting process...",
        "status_validating_input": "Validating input...",
        "status_writing_config": "Updating config.yaml safely...",
        "status_finishing": "Finishing operation...",
        "status_success": "Operation completed successfully.",
        "status_failed": "Update failed.",
        "status_refreshing": "Refreshing list...",
        "status_refresh_done": "List refreshed.",
        "status_validating_keys": "Checking key status...",
        "status_validate_done": "Status check completed.",
        "status_deleting": "Deleting selected key...",
        "status_deleting_safe": "Executing safe delete...",
        "status_deleted_success": "Deleted {provider} key successfully.",
        "status_refresh_after_save": "Refreshing list after save...",
        "msg_error_title": "Error",
        "msg_success_title": "Success",
        "msg_warning_title": "Warning",
        "msg_confirm_title": "Confirm Deletion",
        "msg_invalid_key": "Invalid key: {reason}",
        "msg_select_row": "Please select a row from the table first.",
        "msg_cannot_read_row": "Unable to read selected row.",
        "msg_invalid_provider": "Invalid provider.",
        "msg_confirm_delete": "Do you want to permanently delete {provider} key from config.yaml?",
        "msg_upsert_success": "Key injected successfully.",
        "status_unknown": "Unverified",
        "status_ok": "Verified/Working",
        "status_needs_renew": "Needs renewal",
        "ctx_cut": "Cut",
        "ctx_copy": "Copy",
        "ctx_paste": "Paste",
        "ctx_select_all": "Select All",
    },
    "ar": {
        "app_title": "مخزن مفاتيح KURDOST",
        "input_key": "إدخال المفتاح:",
        "provider_label": "نوع المفتاح:",
        "secure_mode": "الوضع الآمن (تشفير المفتاح داخل config.yaml)",
        "update_key": "إضافة وتحديث المفتاح",
        "keys_section": "المفاتيح المحفوظة",
        "tree_provider": "الشركة",
        "tree_title": "الحساب",
        "tree_masked": "المفتاح (مخفي)",
        "tree_status": "الحالة",
        "refresh_list": "تحديث القائمة",
        "validate_status": "فحص الحالة",
        "delete_selected": "مسح المفتاح المحدد",
        "ready": "جاهز",
        "status_start": "بدء العملية...",
        "status_validating_input": "التحقق من المدخلات...",
        "status_writing_config": "تحديث config.yaml بأمان...",
        "status_finishing": "إنهاء العملية...",
        "status_success": "اكتملت العملية بنجاح.",
        "status_failed": "فشل التحديث.",
        "status_refreshing": "تحديث القائمة...",
        "status_refresh_done": "تم تحديث القائمة.",
        "status_validating_keys": "فحص حالة المفاتيح...",
        "status_validate_done": "اكتمل فحص الحالة.",
        "status_deleting": "حذف المفتاح المحدد...",
        "status_deleting_safe": "تنفيذ الحذف الآمن...",
        "status_deleted_success": "تم حذف مفتاح {provider} بنجاح.",
        "status_refresh_after_save": "تحديث القائمة بعد الحفظ...",
        "msg_error_title": "خطأ",
        "msg_success_title": "نجاح",
        "msg_warning_title": "تنبيه",
        "msg_confirm_title": "تأكيد الحذف",
        "msg_invalid_key": "المفتاح غير صالح: {reason}",
        "msg_select_row": "اختر صفاً من الجدول أولاً.",
        "msg_cannot_read_row": "تعذر قراءة الصف المحدد.",
        "msg_invalid_provider": "مزود غير صالح.",
        "msg_confirm_delete": "هل تريد حذف مفتاح {provider} نهائياً من config.yaml؟",
        "msg_upsert_success": "تم حقن المفتاح بنجاح وعاشت إيدك",
        "status_unknown": "غير مفحوص",
        "status_ok": "مفحوص/شغال",
        "status_needs_renew": "يحتاج تجديد",
        "ctx_cut": "قص",
        "ctx_copy": "نسخ",
        "ctx_paste": "لصق",
        "ctx_select_all": "تحديد الكل",
    },
    "ku": {
        "app_title": "KURDOST کۆگای کلیلی",
        "input_key": "کلیل بنووسە:",
        "provider_label": "جۆری کلیل:",
        "secure_mode": "دۆخی پارێزراو (شاردنەوەی کلیل لە config.yaml)",
        "update_key": "زیادکردن/نوێکردنەوەی کلیل",
        "keys_section": "کلیلە پاشەکەوتکراوەکان",
        "tree_provider": "کۆمپانیا",
        "tree_title": "هەژمار",
        "tree_masked": "کلیل (شاردراوە)",
        "tree_status": "دۆخ",
        "refresh_list": "نوێکردنەوەی لیست",
        "validate_status": "پشکنینی دۆخ",
        "delete_selected": "سڕینەوەی کلیلی دیاریکراو",
        "ready": "ئامادە",
        "status_start": "دەستپێکردنی پڕۆسە...",
        "status_validating_input": "پشکنینی داتا...",
        "status_writing_config": "نووسینی پارێزراوی config.yaml...",
        "status_finishing": "کۆتاییهێنانی کردار...",
        "status_success": "پڕۆسە بە سەرکەوتوویی تەواوبوو.",
        "status_failed": "نوێکردنەوە سەرنەکەوت.",
        "status_refreshing": "نوێکردنەوەی لیست...",
        "status_refresh_done": "لیست نوێکرایەوە.",
        "status_validating_keys": "پشکنینی دۆخی کلیلەکان...",
        "status_validate_done": "پشکنینی دۆخ تەواوبوو.",
        "status_deleting": "سڕینەوەی کلیلی دیاریکراو...",
        "status_deleting_safe": "جێبەجێکردنی سڕینەوەی پارێزراو...",
        "status_deleted_success": "کلیلی {provider} بە سەرکەوتوویی سڕایەوە.",
        "status_refresh_after_save": "دوای پاشەکەوتکردن لیست نوێدەکرێتەوە...",
        "msg_error_title": "هەڵە",
        "msg_success_title": "سەرکەوتوو",
        "msg_warning_title": "ئاگاداری",
        "msg_confirm_title": "دڵنیابوونەوەی سڕینەوە",
        "msg_invalid_key": "کلیل دروست نییە: {reason}",
        "msg_select_row": "تکایە سەرەتا ڕیزێک هەڵبژێرە.",
        "msg_cannot_read_row": "ناتوانرێت ڕیزی هەڵبژێردراو بخوێندرێتەوە.",
        "msg_invalid_provider": "دابینکەری نادروست.",
        "msg_confirm_delete": "دەتەوێت کلیلی {provider} بە تەواوی لە config.yaml بسڕیتەوە؟",
        "msg_upsert_success": "کلیل بە سەرکەوتوویی زیادکرا.",
        "status_unknown": "پشکنین نەکراوە",
        "status_ok": "پشکنراو/کاردەکات",
        "status_needs_renew": "پێویستی بە نوێکردنەوە هەیە",
        "ctx_cut": "بڕین",
        "ctx_copy": "لەبەرگرتنەوە",
        "ctx_paste": "لکاندن",
        "ctx_select_all": "هەمووی دیاریبکە",
    },
}


PROVIDER_ID_MAP = {
    "SambaNova": "sambanova",
    "Groq": "groq",
}


class BackendSync:
    """
    Silent sync layer: after every YAML write, mirrors the change to the
    KURDOST Backend API. Failures are logged but never block the GUI.
    """

    def __init__(self, base_url: str = "http://localhost:5000"):
        self.base_url = base_url.rstrip("/")
        self._token: Optional[str] = None
        self._lock = threading.Lock()
        self._logger = logging.getLogger("kurdost.backend_sync")

    def _get_token(self) -> Optional[str]:
        with self._lock:
            if self._token:
                return self._token
            try:
                req = urllib.request.Request(
                    f"{self.base_url}/api/v1/auth/demo-token",
                    method="POST",
                    headers={"Content-Type": "application/json"},
                    data=b"{}",
                )
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read())
                    self._token = data.get("access_token")
                    return self._token
            except Exception as e:
                self._logger.debug(f"BackendSync: cannot get token: {e}")
                return None

    def _request(self, method: str, path: str, body: Optional[Dict] = None) -> Optional[Dict]:
        token = self._get_token()
        if not token:
            return None
        try:
            payload = json.dumps(body).encode("utf-8") if body else None
            req = urllib.request.Request(
                f"{self.base_url}{path}",
                method=method,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                data=payload,
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            self._logger.debug(f"BackendSync {method} {path} → HTTP {e.code}")
            return None
        except Exception as e:
            self._logger.debug(f"BackendSync {method} {path} → {e}")
            return None

    def sync_upsert(self, provider_name: str, api_key: str) -> None:
        """Add or update a provider in the Backend. Runs silently."""
        provider_id = PROVIDER_ID_MAP.get(provider_name, provider_name.lower())
        existing = self._request("GET", f"/api/v1/providers/{provider_id}")
        if existing and not existing.get("detail"):
            self._request("PATCH", f"/api/v1/providers/{provider_id}", {"api_key": api_key})
            self._logger.info(f"BackendSync: updated provider {provider_id}")
        else:
            self._request("POST", "/api/v1/providers", {
                "api_key": api_key,
                "provider_type": provider_id,
            })
            self._logger.info(f"BackendSync: added provider {provider_id}")

    def sync_delete(self, provider_name: str) -> None:
        """Remove a provider from the Backend. Runs silently."""
        provider_id = PROVIDER_ID_MAP.get(provider_name, provider_name.lower())
        self._request("DELETE", f"/api/v1/providers/{provider_id}")
        self._logger.info(f"BackendSync: deleted provider {provider_id}")

    def is_backend_alive(self) -> bool:
        """Quick health check — returns True if Backend is reachable."""
        try:
            req = urllib.request.Request(
                f"{self.base_url}/api/v1/health",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                return resp.status == 200
        except Exception:
            return False


_backend_sync = BackendSync()


def detect_language(text: str) -> str:
    if not text:
        return "en"
    if any(ch in KURDISH_SORANI_CHARS for ch in text):
        return "ku"
    if ARABIC_UNICODE_RE.search(text):
        return "ar"
    return "en"


def ensure_dirs() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def normalize_provider(name: str) -> str:
    raw = (name or "").strip().lower()
    compact = re.sub(r"[\s\-_]+", "", raw)
    if "sambanova" in compact or ("samba" in raw and "nova" in raw):
        return "SambaNova"
    if "groq" in compact:
        return "Groq"
    return name.strip()


def validate_api_key(key: str) -> Tuple[bool, str]:
    if not key:
        return False, "المفتاح فارغ."
    if len(key) < 10:
        return False, "المفتاح قصير جداً."
    if any(ch.isspace() for ch in key):
        return False, "المفتاح يجب أن لا يحتوي مسافات."
    return True, ""


def mask_api_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:8]}...{key[-5:]}"


def provider_status_check(provider: str, key: str) -> Tuple[bool, str]:
    provider = normalize_provider(provider)
    if not key:
        return False, "needs_renew"
    if provider == "Groq":
        ok = key.startswith("gsk_") and len(key) >= 20 and " " not in key
        return ok, "ok" if ok else "needs_renew"
    if provider == "SambaNova":
        ok = len(key) >= 16 and " " not in key
        return ok, "ok" if ok else "needs_renew"
    return False, "needs_renew"


class AuditLogger:
    def __init__(self, log_path: Path):
        self.logger = logging.getLogger("kurdost_audit")
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        if not self.logger.handlers:
            handler = RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=5, encoding="utf-8")
            formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)

    def event(self, action: str, status: str, details: Dict[str, Any]) -> None:
        self.logger.info(json.dumps({"action": action, "status": status, "details": details}, ensure_ascii=False))


class FileLock:
    def __init__(self, lock_path: Path, timeout: float = 12.0, poll: float = 0.1):
        self.lock_path = lock_path
        self.timeout = timeout
        self.poll = poll
        self.fd: Optional[int] = None

    def acquire(self) -> None:
        start = time.time()
        while True:
            try:
                self.fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                os.write(self.fd, str(os.getpid()).encode("utf-8"))
                return
            except FileExistsError:
                if time.time() - start > self.timeout:
                    raise TimeoutError("تعذر الحصول على قفل الملف. هناك عملية أخرى تعمل.")
                time.sleep(self.poll)

    def release(self) -> None:
        try:
            if self.fd is not None:
                os.close(self.fd)
                self.fd = None
            if self.lock_path.exists():
                self.lock_path.unlink(missing_ok=True)
        except Exception:
            pass

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.release()


class SecurityManager:
    def __init__(self, meta_path: Path):
        self.meta_path = meta_path
        self.secure_mode = False
        self.key: Optional[bytes] = None
        self._load_meta()

    def _load_meta(self) -> None:
        if not self.meta_path.exists():
            self._save_meta({"secure_mode": False, "fernet_key": ""})
            self.secure_mode = False
            self.key = None
            return
        try:
            with self.meta_path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            self.secure_mode = bool(data.get("secure_mode", False))
            raw_key = str(data.get("fernet_key", "")).strip()
            self.key = raw_key.encode("utf-8") if raw_key else None
        except Exception:
            self.secure_mode = False
            self.key = None

    def _save_meta(self, data: Dict[str, Any]) -> None:
        with self.meta_path.open("w", encoding="utf-8", newline="\n") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)

    def set_secure_mode(self, enabled: bool) -> Tuple[bool, str]:
        if enabled and not FERNET_AVAILABLE:
            return False, "cryptography غير متوفر. لا يمكن تفعيل الوضع الآمن."
        self.secure_mode = enabled
        if enabled:
            if not self.key:
                self.key = Fernet.generate_key()  # type: ignore
            self._save_meta({"secure_mode": True, "fernet_key": self.key.decode("utf-8")})
            return True, "تم تفعيل الوضع الآمن."
        self._save_meta({"secure_mode": False, "fernet_key": (self.key.decode("utf-8") if self.key else "")})
        return True, "تم تعطيل الوضع الآمن."

    def encrypt_key(self, plain_key: str) -> str:
        if not self.secure_mode:
            return plain_key
        if not FERNET_AVAILABLE or not self.key:
            raise RuntimeError("الوضع الآمن مفعّل ولكن مفتاح التشفير غير متاح.")
        token = Fernet(self.key).encrypt(plain_key.encode("utf-8"))  # type: ignore
        return "enc:" + token.decode("utf-8")

    def decrypt_key_if_needed(self, maybe_encrypted: str) -> str:
        if not isinstance(maybe_encrypted, str):
            return ""
        if not maybe_encrypted.startswith("enc:"):
            return maybe_encrypted
        if not FERNET_AVAILABLE or not self.key:
            return maybe_encrypted
        try:
            plain = Fernet(self.key).decrypt(maybe_encrypted[4:].encode("utf-8"))  # type: ignore
            return plain.decode("utf-8")
        except InvalidToken:
            return maybe_encrypted


@dataclass
class UpdateResult:
    provider: str
    action: str
    backup_path: Optional[Path]
    secure_mode: bool


@dataclass
class KeyRecord:
    title: str
    provider: str
    model: str
    api_key_plain: str
    api_key_masked: str
    status_key: str = "unknown"


class ConfigManager:
    def __init__(self, config_path: Path, backup_dir: Path, logger: AuditLogger, security: SecurityManager):
        self.config_path = config_path
        self.backup_dir = backup_dir
        self.logger = logger
        self.security = security

    def _ensure_config_exists(self) -> None:
        if not self.config_path.exists():
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with self.config_path.open("w", encoding="utf-8", newline="\n") as f:
                yaml.safe_dump({"models": []}, f, allow_unicode=True, sort_keys=False)

    def _safe_load(self) -> Dict[str, Any]:
        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _validate_and_repair_schema(self, data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        repaired = copy.deepcopy(data)
        notes: List[str] = []
        models = repaired.get("models")
        if not isinstance(models, list):
            repaired["models"] = []
            notes.append("models_recreated")
        fixed_models: List[Dict[str, Any]] = []
        for item in repaired.get("models", []):
            if not isinstance(item, dict):
                notes.append("dropped_non_dict_model_item")
                continue
            provider = normalize_provider(str(item.get("provider", "")).strip())
            if provider not in SUPPORTED_PROVIDERS:
                notes.append("dropped_unsupported_provider_item")
                continue
            fixed_models.append({
                "title": str(item.get("title", "")).strip() or provider,
                "provider": provider,
                "model": str(item.get("model", "")).strip() or DEFAULT_MODELS[provider],
                "apiKey": str(item.get("apiKey", "")).strip(),
            })
        repaired["models"] = fixed_models
        return repaired, notes

    def _create_backup(self) -> Path:
        backup = self.backup_dir / f"config_{now_stamp()}.yaml.bak"
        if self.config_path.exists():
            shutil.copy2(self.config_path, backup)
        else:
            with backup.open("w", encoding="utf-8", newline="\n") as f:
                yaml.safe_dump({"models": []}, f, allow_unicode=True, sort_keys=False)
        return backup

    def _atomic_write(self, data: Dict[str, Any]) -> None:
        fd, tmp_name = tempfile.mkstemp(prefix="kurdost_", suffix=".tmp", dir=str(self.config_path.parent))
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            with tmp_path.open("w", encoding="utf-8", newline="\n") as f:
                yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False, width=120)
            os.replace(str(tmp_path), str(self.config_path))
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def _rollback(self, backup_path: Path) -> None:
        shutil.copy2(backup_path, self.config_path)

    def list_keys(self) -> List[KeyRecord]:
        self._ensure_config_exists()
        with FileLock(LOCK_PATH):
            repaired_data, _ = self._validate_and_repair_schema(self._safe_load())
            out: List[KeyRecord] = []
            for item in repaired_data.get("models", []):
                provider = normalize_provider(str(item.get("provider", "")).strip())
                enc_or_plain = str(item.get("apiKey", "")).strip()
                plain = self.security.decrypt_key_if_needed(enc_or_plain)
                out.append(KeyRecord(
                    title=str(item.get("title", "")).strip() or provider,
                    provider=provider,
                    model=str(item.get("model", "")).strip() or DEFAULT_MODELS[provider],
                    api_key_plain=plain,
                    api_key_masked=mask_api_key(plain),
                    status_key="unknown",
                ))
            return out

    def delete_key(self, provider: str) -> UpdateResult:
        provider = normalize_provider(provider)
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError("Provider غير مدعوم. فقط SambaNova و Groq.")
        self._ensure_config_exists()
        with FileLock(LOCK_PATH):
            repaired_data, notes = self._validate_and_repair_schema(self._safe_load())
            backup = self._create_backup()
            models = repaired_data.get("models", [])
            filtered = [m for m in models if normalize_provider(str(m.get("provider", "")).strip()) != provider]
            if len(filtered) == len(models):
                raise ValueError("لا يوجد مفتاح لهذا المزود لحذفه.")
            repaired_data["models"] = filtered
            try:
                self._atomic_write(repaired_data)
                verify_data = self._safe_load()
                verify_repaired, _ = self._validate_and_repair_schema(verify_data)
                if verify_data != verify_repaired:
                    raise RuntimeError("Post-write schema validation failed")
                self.logger.event("delete_key", "success", {
                    "provider": provider, "operation": "delete", "secure_mode": self.security.secure_mode,
                    "repair_notes": notes, "backup": str(backup),
                })
                return UpdateResult(provider=provider, action="delete", backup_path=backup, secure_mode=self.security.secure_mode)
            except Exception as ex:
                self._rollback(backup)
                self.logger.event("delete_key", "rollback", {"provider": provider, "error": str(ex), "backup": str(backup)})
                raise RuntimeError(f"فشل الحذف وتم استرجاع النسخة الاحتياطية: {ex}") from ex

    def upsert_key(self, provider: str, api_key_plain: str) -> UpdateResult:
        provider = normalize_provider(provider)
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError("Provider غير مدعوم. فقط SambaNova و Groq.")
        valid, msg = validate_api_key(api_key_plain)
        if not valid:
            raise ValueError(msg)
        self._ensure_config_exists()
        with FileLock(LOCK_PATH):
            repaired_data, notes = self._validate_and_repair_schema(self._safe_load())
            backup = self._create_backup()
            encrypted_or_plain = self.security.encrypt_key(api_key_plain)
            models = repaired_data.get("models", [])
            action = "insert"
            found = False
            for item in models:
                if item.get("provider") == provider:
                    item["apiKey"] = encrypted_or_plain
                    if not str(item.get("title", "")).strip():
                        item["title"] = provider
                    if not str(item.get("model", "")).strip():
                        item["model"] = DEFAULT_MODELS[provider]
                    action = "update"
                    found = True
                    break
            if not found:
                models.append({"title": provider, "provider": provider, "model": DEFAULT_MODELS[provider], "apiKey": encrypted_or_plain})
            repaired_data["models"] = models
            try:
                self._atomic_write(repaired_data)
                verify_data = self._safe_load()
                verify_repaired, _ = self._validate_and_repair_schema(verify_data)
                if verify_data != verify_repaired:
                    raise RuntimeError("Post-write schema validation failed")
                self.logger.event("upsert_key", "success", {
                    "provider": provider, "operation": action, "secure_mode": self.security.secure_mode,
                    "repair_notes": notes, "backup": str(backup),
                })
                return UpdateResult(provider=provider, action=action, backup_path=backup, secure_mode=self.security.secure_mode)
            except Exception as ex:
                self._rollback(backup)
                self.logger.event("upsert_key", "rollback", {"provider": provider, "error": str(ex), "backup": str(backup)})
                raise RuntimeError(f"فشل التحديث وتم استرجاع النسخة الاحتياطية: {ex}") from ex


# نقطة بداية البرنامج
if __name__ == "__main__":
    ensure_dirs()
    
    # تهيئة المكونات
    audit_logger = AuditLogger(AUDIT_LOG_PATH)
    security_manager = SecurityManager(SECURITY_META_PATH)
    config_manager = ConfigManager(CONFIG_PATH, BACKUP_DIR, audit_logger, security_manager)
    
    # إنشاء الواجهة الرسومية
    root = tk.Tk()
    root.title(TRANSLATIONS[detect_language("")]["app_title"])
    root.geometry("800x600")
    
    # إنشاء إطارات للتنظيم
    input_frame = ttk.LabelFrame(root, text=TRANSLATIONS[detect_language("")]["input_key"], padding=10)
    input_frame.pack(fill="x", padx=10, pady=5)
    
    tree_frame = ttk.LabelFrame(root, text=TRANSLATIONS[detect_language("")]["keys_section"], padding=10)
    tree_frame.pack(fill="both", expand=True, padx=10, pady=5)
    
    # إدخال مزود الخدمة
    provider_var = tk.StringVar()
    provider_label = ttk.Label(input_frame, text=TRANSLATIONS[detect_language("")]["provider_label"])
    provider_label.grid(row=0, column=0, sticky="w", padx=5, pady=5)
    provider_combo = ttk.Combobox(input_frame, textvariable=provider_var, values=SUPPORTED_PROVIDERS, state="readonly")
    provider_combo.grid(row=0, column=1, sticky="ew", padx=5, pady=5)
    provider_combo.set(SUPPORTED_PROVIDERS[0])
    
    # إدخال المفتاح
    key_var = tk.StringVar()
    key_label = ttk.Label(input_frame, text=TRANSLATIONS[detect_language("")]["input_key"])
    key_label.grid(row=1, column=0, sticky="w", padx=5, pady=5)
    key_entry = ttk.Entry(input_frame, textvariable=key_var, show="*", width=40)
    key_entry.grid(row=1, column=1, sticky="ew", padx=5, pady=5)
    
    # وضع آمن
    secure_var = tk.BooleanVar(value=False)
    secure_check = ttk.Checkbutton(input_frame, text=TRANSLATIONS[detect_language("")]["secure_mode"], variable=secure_var)
    secure_check.grid(row=2, column=0, columnspan=2, sticky="w", padx=5, pady=5)
    
    # أزرار الإجراءات
    button_frame = ttk.Frame(root)
    button_frame.pack(fill="x", padx=10, pady=5)
    
    update_button = ttk.Button(button_frame, text=TRANSLATIONS[detect_language("")]["update_key"], command=lambda: update_key_wrapper())
    update_button.pack(side="left", padx=5)
    
    refresh_button = ttk.Button(button_frame, text=TRANSLATIONS[detect_language("")]["refresh_list"], command=lambda: refresh_list_wrapper())
    refresh_button.pack(side="left", padx=5)
    
    validate_button = ttk.Button(button_frame, text=TRANSLATIONS[detect_language("")]["validate_status"], command=lambda: validate_status_wrapper())
    validate_button.pack(side="left", padx=5)
    
    delete_button = ttk.Button(button_frame, text=TRANSLATIONS[detect_language("")]["delete_selected"], command=lambda: delete_key_wrapper())
    delete_button.pack(side="left", padx=5)
    
    # حالة التشغيل
    status_var = tk.StringVar(value=TRANSLATIONS[detect_language("")]["ready"])
    status_bar = ttk.Label(root, textvariable=status_var, relief="sunken", anchor="w")
    status_bar.pack(fill="x", padx=5, pady=2)
    
    # الجدول
    columns = (TRANSLATIONS[detect_language("")]["tree_provider"], TRANSLATIONS[detect_language("")]["tree_title"], 
               TRANSLATIONS[detect_language("")]["tree_masked"], TRANSLATIONS[detect_language("")]["tree_status"])
    tree = ttk.Treeview(tree_frame, columns=columns, show="headings")
    
    for col in columns:
        tree.heading(col, text=col)
        tree.column(col, width=150)
    
    scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=tree.yview)
    tree.configure(yscrollcommand=scrollbar.set)
    
    tree.pack(side="left", fill="both", expand=True)
    scrollbar.pack(side="right", fill="y")
    
    # دعم النسخ والسياق
    def copy_selected_key():
        selected = tree.selection()
        if not selected:
            return
        
        item = tree.item(selected[0])
        key = item["values"][2]
        root.clipboard_clear()
        root.clipboard_append(key)
    
    def show_context_menu(event):
        ctx_menu.post(event.x_root, event.y_root)
    
    # قائمة السياق
    ctx_menu = tk.Menu(root, tearoff=0)
    ctx_menu.add_command(label=TRANSLATIONS[detect_language("")]["ctx_copy"], command=lambda: copy_selected_key())
    ctx_menu.add_separator()
    ctx_menu.add_command(label=TRANSLATIONS[detect_language("")]["ctx_select_all"], command=lambda: tree.selection_set(tree.get_children()))
    
    tree.bind("<Button-3>", show_context_menu)
    
    # وظائف التغليف للعمليات غير المتزامنة
    def update_key_wrapper():
        provider = provider_var.get()
        api_key = key_var.get()
        secure = secure_var.get()
        
        if not provider or not api_key:
            messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], TRANSLATIONS[detect_language("")]["msg_invalid_key"].format(reason="empty"))
            return
        
        # تحديث الوضع الآمن إذا تغير
        if security_manager.secure_mode != secure:
            success, msg = security_manager.set_secure_mode(secure)
            if not success:
                messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], msg)
                return
            
        # تشغيل في خيط منفصل لمنع تجميد الواجهة
        threading.Thread(target=update_key, args=(provider, api_key), daemon=True).start()
    
    def refresh_list_wrapper():
        threading.Thread(target=refresh_list, daemon=True).start()
    
    def validate_status_wrapper():
        threading.Thread(target=validate_status, daemon=True).start()
    
    def delete_key_wrapper():
        selected = tree.selection()
        if not selected:
            messagebox.showwarning(TRANSLATIONS[detect_language("")]["msg_warning_title"], TRANSLATIONS[detect_language("")]["msg_select_row"])
            return
        
        item = tree.item(selected[0])
        provider = item["values"][0]
        
        confirm = messagebox.askyesno(
            TRANSLATIONS[detect_language("")]["msg_confirm_title"], 
            TRANSLATIONS[detect_language("")]["msg_confirm_delete"].format(provider=provider)
        )
        
        if confirm:
            threading.Thread(target=delete_key, args=(provider,), daemon=True).start()
    
    def copy_selected_key():
        selected = tree.selection()
        if not selected:
            return
        
        item = tree.item(selected[0])
        key = item["values"][2]
        root.clipboard_clear()
        root.clipboard_append(key)
    
    def show_context_menu(event):
        ctx_menu.post(event.x_root, event.y_root)
    
    # العمليات الفعلية
    def update_key(provider, api_key):
        try:
            status_var.set(TRANSLATIONS[detect_language("")]["status_start"])
            root.update()
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_validating_input"])
            root.update()
            
            valid, reason = validate_api_key(api_key)
            if not valid:
                messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], TRANSLATIONS[detect_language("")]["msg_invalid_key"].format(reason=reason))
                return
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_writing_config"])
            root.update()
            
            result = config_manager.upsert_key(provider, api_key)
            
            threading.Thread(
                target=_backend_sync.sync_upsert,
                args=(provider, api_key),
                daemon=True,
            ).start()
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_refresh_after_save"])
            root.update()
            
            refresh_list()
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_success"])
            messagebox.showinfo(TRANSLATIONS[detect_language("")]["msg_success_title"], 
                              TRANSLATIONS[detect_language("")]["msg_upsert_success"])
        except Exception as ex:
            status_var.set(TRANSLATIONS[detect_language("")]["status_failed"])
            messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], str(ex))
    
    def refresh_list():
        try:
            status_var.set(TRANSLATIONS[detect_language("")]["status_refreshing"])
            root.update()
            
            keys = config_manager.list_keys()
            
            # مسح الجدول
            for item in tree.get_children():
                tree.delete(item)
            
            # إعادة ملء الجدول
            for key in keys:
                status_icon = STATUS_UNKNOWN_ICON
                if key.status_key == "ok":
                    status_icon = STATUS_OK_ICON
                elif key.status_key == "needs_renew":
                    status_icon = STATUS_NEEDS_RENEW_ICON
                
                tree.insert("", "end", values=(key.provider, key.title, key.api_key_masked, status_icon))
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_refresh_done"])
        except Exception as ex:
            status_var.set(TRANSLATIONS[detect_language("")]["status_failed"])
            messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], str(ex))
    
    def validate_status():
        try:
            status_var.set(TRANSLATIONS[detect_language("")]["status_validating_keys"])
            root.update()
            
            keys = config_manager.list_keys()
            
            # تحديث حالة كل مفتاح
            for key in keys:
                valid, status = provider_status_check(key.provider, key.api_key_plain)
                key.status_key = "ok" if valid else "needs_renew"
                
                # تحديث الرمز في الجدول
                for item in tree.get_children():
                    if tree.item(item)["values"][0] == key.provider:
                        status_icon = STATUS_UNKNOWN_ICON
                        if key.status_key == "ok":
                            status_icon = STATUS_OK_ICON
                        elif key.status_key == "needs_renew":
                            status_icon = STATUS_NEEDS_RENEW_ICON
                        
                        tree.item(item, values=(key.provider, key.title, key.api_key_masked, status_icon))
                        break
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_validate_done"])
        except Exception as ex:
            status_var.set(TRANSLATIONS[detect_language("")]["status_failed"])
            messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], str(ex))
    
    def delete_key(provider):
        try:
            status_var.set(TRANSLATIONS[detect_language("")]["status_deleting"])
            root.update()
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_deleting_safe"])
            root.update()
            
            config_manager.delete_key(provider)
            
            threading.Thread(
                target=_backend_sync.sync_delete,
                args=(provider,),
                daemon=True,
            ).start()
            
            refresh_list()
            
            status_var.set(TRANSLATIONS[detect_language("")]["status_success"])
            messagebox.showinfo(TRANSLATIONS[detect_language("")]["msg_success_title"], 
                              TRANSLATIONS[detect_language("")]["status_deleted_success"].format(provider=provider))
        except Exception as ex:
            status_var.set(TRANSLATIONS[detect_language("")]["status_failed"])
            messagebox.showerror(TRANSLATIONS[detect_language("")]["msg_error_title"], str(ex))
    
    # تحديث القائمة عند بدء التشغيل
    refresh_list()
    
    # تشغيل الواجهة الرسومية
    root.mainloop()
