from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parents[1] / "src" / "layouts" / "catalog.json"
CLASSIFIER_VERSION = os.getenv("CLASSIFIER_VERSION", "v1").strip() or "v1"
MAX_MODEL_RESPONSE_CHARS = 400
_CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
IMPLEMENTED_LAYOUT_IDS = frozenset(item["id"] for item in _CATALOG["implemented"])
DEFAULT_SOURCE_LAYOUT = str(_CATALOG["sourceDefault"])
DEFAULT_CANDIDATES = [DEFAULT_SOURCE_LAYOUT, "ar-101"]


def implemented_layouts() -> list[dict[str, str]]:
    return list(_CATALOG["implemented"])


def is_supported_layout(layout_id: str) -> bool:
    return layout_id in IMPLEMENTED_LAYOUT_IDS


def normalize_candidates(raw: list[str] | None) -> list[str]:
    if not raw:
        return list(DEFAULT_CANDIDATES)
    unique: list[str] = []
    for item in raw:
        if is_supported_layout(item) and item not in unique:
            unique.append(item)
    if DEFAULT_SOURCE_LAYOUT not in unique:
        unique.insert(0, DEFAULT_SOURCE_LAYOUT)
    return unique or list(DEFAULT_CANDIDATES)


CONTEXT_KEY_MAX_CHARS = 3


def relevant_context(word: str, context: str | None) -> str | None:
    if len(word) > CONTEXT_KEY_MAX_CHARS:
        return None
    if not context:
        return None
    parts = [item for item in context.strip().split() if item][-2:]
    if not parts:
        return None
    return " ".join(parts).casefold()


def classification_cache_key(
    word: str,
    source: str,
    candidates: list[str],
    context: str | None = None,
) -> str:
    joined = ",".join(sorted(candidates))
    key = f"{CLASSIFIER_VERSION}|{word.casefold()}|{source}|{joined}"
    ctx = relevant_context(word, context)
    return f"{key}|ctx:{ctx}" if ctx else key


def _empty_valid() -> dict[str, Any]:
    return {"kind": "VALID"}


def parse_classification(
    content: str | None,
    candidates: list[str],
    source: str = DEFAULT_SOURCE_LAYOUT,
) -> dict[str, Any]:
    if not content:
        return _empty_valid()

    if len(content) > MAX_MODEL_RESPONSE_CHARS:
        return _empty_valid()

    text = content.strip()
    targets = [item for item in candidates if item != source]

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            kind = str(data.get("kind") or "").upper()
            if kind == "VALID" or kind == "UNCERTAIN":
                return _empty_valid()
            if kind == "LAYOUT_MISMATCH":
                target = str(data.get("target_layout") or data.get("targetLayout") or "")
                if is_supported_layout(target) and target in candidates:
                    return {"kind": "LAYOUT_MISMATCH", "target_layout": target}
    except json.JSONDecodeError:
        pass

    compact = text.strip().strip("\"'")
    upper = compact.upper()
    if upper in {"VALID", "UNCERTAIN"}:
        return _empty_valid()

    if upper == "EN":
        if source != "en-US-qwerty" and "en-US-qwerty" in candidates:
            return {"kind": "LAYOUT_MISMATCH", "target_layout": "en-US-qwerty"}
        return _empty_valid()

    mismatch = re.match(r"LAYOUT_MISMATCH:([A-Za-z0-9_-]+)$", compact)
    if mismatch and is_supported_layout(mismatch.group(1)) and mismatch.group(1) in candidates:
        return {"kind": "LAYOUT_MISMATCH", "target_layout": mismatch.group(1)}

    # Compatibility with the previous EN | AR_GIB model output.
    if "AR_GIB" in upper and "ar-101" in candidates:
        return {"kind": "LAYOUT_MISMATCH", "target_layout": "ar-101"}

    if targets and compact in IMPLEMENTED_LAYOUT_IDS and compact in candidates:
        return {"kind": "LAYOUT_MISMATCH", "target_layout": compact}

    return _empty_valid()


MISMATCH_EXAMPLES: tuple[tuple[str, str], ...] = (
    ("hgjwldl", "ar-101"),
    ("hsjo]lj", "ar-101"),
    ("lvpfh", "ar-101"),
    ("i`h", "ar-101"),
    ("hkh", "ar-101"),
    ("td", "ar-101"),
    ("ig", "ar-101"),
    ("اثممخ", "en-US-qwerty"),
    ("اخص", "en-US-qwerty"),
    ("شقث", "en-US-qwerty"),
    ("غخع", "en-US-qwerty"),
    ("ghbdtn", "ru-standard"),
)


def build_system_prompt(source: str, candidates: list[str]) -> str:
    allowed = set(candidates)
    targets = [item for item in candidates if item != source]
    target_list = ", ".join(targets) if targets else "none"
    examples = [
        f"{word} -> {layout}"
        for word, layout in MISMATCH_EXAMPLES
        if layout in allowed
    ]
    example_line = (
        "Examples of mismatch (same keys, wrong layout): " + "; ".join(examples) + ". "
        if examples
        else ""
    )
    return (
        "You classify keyboard-layout mismatch. You are not a translator, "
        "spellchecker, or grammar checker. "
        f"The observed token was produced by source layout {source}. "
        f"Candidate intended layouts: {target_list}. "
        "Use only those layout IDs. Never invent a layout the user did not enable. "
        "Ask only: were these the same physical keys the user meant for "
        "another candidate layout? "
        "Each token is independent. Mixed-language sentences are normal. "
        "Never lock the sentence to one language. "
        "Never translate. Never emit the corrected word. Never explain. "
        "Real words already in the intended script are VALID. "
        "Brands, code, and acronyms are VALID. "
        "If unsure, UNCERTAIN or VALID — never guess. "
        'Reply ONLY with JSON: {"kind":"VALID"}, {"kind":"UNCERTAIN"}, or '
        '{"kind":"LAYOUT_MISMATCH","target_layout":"<layout-id>"}. '
        + example_line
        + "Examples of VALID (already intended, or not a layout miss): "
        "مرحبا, هذا, انا, كيف, التصميم, React, API, hello, how, are, you, asdf, gh."
    )
