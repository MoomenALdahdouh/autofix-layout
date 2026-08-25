from classification import (
    classification_cache_key,
    implemented_layouts,
    normalize_candidates,
    parse_classification,
)


def test_catalog_includes_arabic_and_russian():
    ids = {item["id"] for item in implemented_layouts()}
    assert {"en-US-qwerty", "ar-101", "ru-standard", "fr-azerty", "de-qwertz"} <= ids
    assert "zh-pinyin" not in ids


def test_parse_valid_json():
    assert parse_classification('{"kind":"VALID"}', ["en-US-qwerty", "ar-101"]) == {
        "kind": "VALID"
    }


def test_parse_mismatch_json():
    assert parse_classification(
        '{"kind":"LAYOUT_MISMATCH","target_layout":"ar-101"}',
        ["en-US-qwerty", "ar-101"],
    ) == {"kind": "LAYOUT_MISMATCH", "target_layout": "ar-101"}


def test_parse_rejects_unknown_layout():
    assert parse_classification(
        '{"kind":"LAYOUT_MISMATCH","target_layout":"fr-azerty"}',
        ["en-US-qwerty", "ar-101"],
    ) == {"kind": "VALID"}


def test_parse_compat_ar_gib():
    assert parse_classification("AR_GIB", ["en-US-qwerty", "ar-101"]) == {
        "kind": "LAYOUT_MISMATCH",
        "target_layout": "ar-101",
    }


def test_parse_en_from_arabic_source_is_mismatch():
    assert parse_classification(
        "EN",
        ["en-US-qwerty", "ar-101"],
        source="ar-101",
    ) == {
        "kind": "LAYOUT_MISMATCH",
        "target_layout": "en-US-qwerty",
    }


def test_parse_en_from_english_source_is_valid():
    assert parse_classification("EN", ["en-US-qwerty", "ar-101"]) == {
        "kind": "VALID"
    }


def test_parse_uncertain_is_keep():
    assert parse_classification('{"kind":"UNCERTAIN"}', ["en-US-qwerty", "ar-101"]) == {
        "kind": "VALID"
    }
    assert parse_classification("UNCERTAIN", ["en-US-qwerty", "ar-101"]) == {
        "kind": "VALID"
    }


def test_parse_malformed_is_valid():
    assert parse_classification("not json", ["en-US-qwerty", "ar-101"]) == {
        "kind": "VALID"
    }
    assert parse_classification("", ["en-US-qwerty", "ar-101"]) == {"kind": "VALID"}
    assert parse_classification(None, ["en-US-qwerty", "ar-101"]) == {"kind": "VALID"}
    assert parse_classification(
        '{"kind":"LAYOUT_MISMATCH"}',
        ["en-US-qwerty", "ar-101"],
    ) == {"kind": "VALID"}
    assert parse_classification(
        '{"kind":"LAYOUT_MISMATCH","target_layout":"not-a-layout"}',
        ["en-US-qwerty", "ar-101"],
    ) == {"kind": "VALID"}
    assert parse_classification(
        '{"kind":"GUESS","target_layout":"ar-101"}',
        ["en-US-qwerty", "ar-101"],
    ) == {"kind": "VALID"}


def test_candidates_and_cache_ignore_license():
    assert normalize_candidates(["ar-101", "ru-standard"]) == [
        "en-US-qwerty",
        "ar-101",
        "ru-standard",
    ]
    assert normalize_candidates(None) == ["en-US-qwerty", "ar-101"]
    from classification import CLASSIFIER_VERSION

    key = classification_cache_key("React", "en-US-qwerty", ["ar-101", "en-US-qwerty"])
    assert key == f"{CLASSIFIER_VERSION}|react|en-US-qwerty|ar-101,en-US-qwerty"
    assert key.startswith(f"{CLASSIFIER_VERSION}|")
    assert "license" not in key
    short = classification_cache_key(
        "td",
        "en-US-qwerty",
        ["ar-101", "en-US-qwerty"],
        "hsjo]lj React",
    )
    assert short.endswith("|ctx:hsjo]lj react")
    assert "license" not in short
    long_with_ctx = classification_cache_key(
        "hsjo]lj",
        "en-US-qwerty",
        ["ar-101", "en-US-qwerty"],
        "React",
    )
    assert "ctx:" not in long_with_ctx


def test_backend_ttl_windows():
    from main import (
        INVALID_LICENSE_TTL_SECONDS,
        LICENSE_TTL_SECONDS,
        WORD_TTL_SECONDS,
    )

    assert LICENSE_TTL_SECONDS == 900
    assert 60 <= INVALID_LICENSE_TTL_SECONDS <= 120
    assert WORD_TTL_SECONDS == 86400


def test_cors_accepts_chromium_edge_origins():
    import re

    from settings import chrome_extension_origin_regex

    pattern = re.compile(chrome_extension_origin_regex(""))
    edge_or_chrome = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"
    assert pattern.match(edge_or_chrome)
    pinned = re.compile(
        chrome_extension_origin_regex("abcdefghijklmnopqrstuvwxyzabcdef")
    )
    assert pinned.match(edge_or_chrome)
    assert not pinned.match("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")


def test_cors_default_is_not_wildcard():
    from main import resolve_cors_origins

    assert "*" not in resolve_cors_origins("", False)
    assert resolve_cors_origins("*", False) == ["*"]
    try:
        resolve_cors_origins("*", False, app_env="production")
        raise AssertionError("production must reject CORS_ORIGINS=*")
    except ValueError as exc:
        assert "production" in str(exc)


def test_license_fails_closed_without_dev_skip():
    from main import license_enforcement_mode

    assert license_enforcement_mode(True, "") == "dev"
    assert license_enforcement_mode(False, "") == "unconfigured"
    assert license_enforcement_mode(False, "lsq_live") == "required"


def test_prompt_only_mentions_enabled_layouts():
    from classification import build_system_prompt

    ru_prompt = build_system_prompt("en-US-qwerty", ["en-US-qwerty", "ru-standard"])
    assert "ru-standard" in ru_prompt
    assert "ghbdtn" in ru_prompt
    assert "ar-101" not in ru_prompt
    assert "hsjo]lj" not in ru_prompt

    ar_prompt = build_system_prompt("en-US-qwerty", ["en-US-qwerty", "ar-101"])
    assert "ar-101" in ar_prompt
    assert "ru-standard" not in ar_prompt
    assert "ghbdtn" not in ar_prompt


def test_parse_rejects_disabled_layout():
    assert parse_classification(
        '{"kind":"LAYOUT_MISMATCH","target_layout":"ar-101"}',
        ["en-US-qwerty", "ru-standard"],
    ) == {"kind": "VALID"}


def test_oversized_model_output_is_valid():
    from classification import MAX_MODEL_RESPONSE_CHARS

    huge = '{"kind":"LAYOUT_MISMATCH","target_layout":"ar-101"}' + ("x" * 500)
    assert len(huge) > MAX_MODEL_RESPONSE_CHARS
    assert parse_classification(huge, ["en-US-qwerty", "ar-101"]) == {"kind": "VALID"}


def test_production_settings_reject_dev_skip():
    from settings import assert_production_safe

    try:
        assert_production_safe(
            app_env="production",
            dev_skip=True,
            lemon_key="lsq_test",
            cors_raw="",
        )
        raise AssertionError("expected production to reject DEV_SKIP_LICENSE")
    except RuntimeError:
        pass

    try:
        assert_production_safe(
            app_env="production",
            dev_skip=False,
            lemon_key="",
            cors_raw="",
        )
        raise AssertionError("expected production to require Lemon key")
    except RuntimeError:
        pass

    assert_production_safe(
        app_env="production",
        dev_skip=False,
        lemon_key="lsq_test",
        cors_raw="https://[WEB_PRODUCTION_DOMAIN]",
    )


def test_ime_layouts_are_not_implemented():
    ids = {item["id"] for item in implemented_layouts()}
    assert "zh-pinyin" not in ids
    assert parse_classification(
        '{"kind":"LAYOUT_MISMATCH","target_layout":"zh-pinyin"}',
        ["en-US-qwerty", "ar-101", "zh-pinyin"],
    ) == {"kind": "VALID"}
