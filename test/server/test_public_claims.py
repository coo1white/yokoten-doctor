import json
import re
from pathlib import Path

from check.result import INSTALL_ONLY_IDS

PAGES = [
    "web/src/pages/index.astro",
    "web/src/pages/about.astro",
    "web/src/data/agent-view.md",
]

WORD_TO_NUM = {
    "Two": 2,
    "Three": 3,
    "Four": 4,
    "Five": 5,
    "Six": 6,
}


def _read_text(path):
    return Path(path).read_text(encoding="utf-8")


def _get_total():
    data = json.loads(Path("test/fixtures/doctor-files-0.2.0.json").read_text(encoding="utf-8"))
    return len(data["steps"])


def test_tops_out_numbers_match_code():
    total = _get_total()
    assert total > 0
    assert INSTALL_ONLY_IDS is not None
    expected_a = total - len(INSTALL_ONLY_IDS)
    expected_b = total
    for page in PAGES:
        text = _read_text(page)
        for match in re.finditer(r"tops out at (\d+) of (\d+)", text):
            assert int(match.group(1)) == expected_a
            assert int(match.group(2)) == expected_b


def test_install_only_word_numbers_match_code():
    total = _get_total()
    assert total > 0
    assert INSTALL_ONLY_IDS is not None
    expected_num = len(INSTALL_ONLY_IDS)
    for page in PAGES:
        text = _read_text(page)
        for match in re.finditer(r"(Two|Three|Four|Five|Six) of the (\d+) checks", text):
            word = match.group(1)
            assert WORD_TO_NUM[word] == expected_num
            assert int(match.group(2)) == total
        for match in re.finditer(r"(Two|Three|Four|Five|Six) checks need", text):
            assert WORD_TO_NUM[match.group(1)] == expected_num


def test_hourly_and_daily_limits_match_code():
    app_text = _read_text("server/app.py")
    hourly_match = re.search(r"HOURLY_LIMIT_PER_IP\s*=\s*(\d+)", app_text)
    daily_match = re.search(r"DAILY_LIMIT_TOTAL\s*=\s*(\d+)", app_text)
    assert hourly_match is not None
    assert daily_match is not None
    hourly = int(hourly_match.group(1))
    daily = int(daily_match.group(1))
    for page in PAGES:
        text = _read_text(page)
        for match in re.finditer(r"(\d+) checks an hour", text):
            assert int(match.group(1)) == hourly
        for match in re.finditer(r"(\d+) a day", text):
            assert int(match.group(1)) == daily


def test_over_gb_matches_github_check():
    github_text = _read_text("server/check/github_check.py")
    limit_match = re.search(r"if size > (\d+)", github_text)
    assert limit_match is not None
    size_limit = int(limit_match.group(1))
    for page in PAGES:
        text = _read_text(page)
        for match in re.finditer(r"over (\d+) GB", text):
            gigabytes = int(match.group(1))
            assert gigabytes * 1024 * 1024 == size_limit


def test_cache_for_hours_matches_build():
    build_text = _read_text("server/fixes/build.py")
    hours_match = re.search(r"<\s*(\d+)\s*\*\s*3600", build_text)
    assert hours_match is not None
    hours = int(hours_match.group(1))
    for page in PAGES:
        text = _read_text(page)
        for match in re.finditer(r"cache for (\d+) hours", text):
            assert int(match.group(1)) == hours


def test_about_seconds_matches_app():
    app_text = _read_text("server/app.py")
    seconds_match = re.search(r"remaining\s*=\s*(\d+)\s*-\s*elapsed", app_text)
    assert seconds_match is not None
    seconds = int(seconds_match.group(1))
    for page in PAGES:
        text = _read_text(page)
        for match in re.finditer(r"about (\d+) seconds", text):
            assert int(match.group(1)) == seconds


def test_each_saved_record_holds_the_result_it_shows():
    paths = sorted(Path("web/src/data/examples").glob("*.json"))
    assert paths
    for path in paths:
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert json.loads(saved["record"]["document"])["result"] == saved["result"], path.name
