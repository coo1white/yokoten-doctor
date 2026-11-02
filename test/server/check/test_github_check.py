import json
import urllib.error
import urllib.request
from unittest.mock import MagicMock, patch

import pytest

from check.github_check import RepoRefused, check_public


def _make_response(data_dict):
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps(data_dict).encode("utf-8")
    mock_response.__enter__.return_value = mock_response
    mock_response.__exit__.return_value = False
    return mock_response


def test_public_repo_gives_branch_and_size():
    payload = {"default_branch": "main", "size": 123, "private": False}
    with patch("urllib.request.urlopen", return_value=_make_response(payload)):
        result = check_public("owner", "repo")
    assert result["default_branch"] == "main"
    assert result["size_kb"] == 123


def test_404_raises_repo_refused():
    error = urllib.error.HTTPError("https://api.github.com/repos/o/r", 404, "Not Found", {}, None)
    with patch("urllib.request.urlopen", side_effect=error):
        with pytest.raises(RepoRefused, match="No public repo at that URL"):
            check_public("owner", "repo")


def test_403_returns_none_values_and_does_not_raise():
    error = urllib.error.HTTPError("https://api.github.com/repos/o/r", 403, "Forbidden", {}, None)
    with patch("urllib.request.urlopen", side_effect=error):
        result = check_public("owner", "repo")
    assert result == {"default_branch": None, "size_kb": None}


def test_429_returns_none_values_and_does_not_raise():
    error = urllib.error.HTTPError("https://api.github.com/repos/o/r", 429, "Too Many Requests", {}, None)
    with patch("urllib.request.urlopen", side_effect=error):
        result = check_public("owner", "repo")
    assert result == {"default_branch": None, "size_kb": None}


def test_500_raises_repo_refused():
    error = urllib.error.HTTPError("https://api.github.com/repos/o/r", 500, "Server Error", {}, None)
    with patch("urllib.request.urlopen", side_effect=error):
        with pytest.raises(RepoRefused, match="couldn't reach GitHub"):
            check_public("owner", "repo")


def test_private_true_raises():
    payload = {"default_branch": "main", "size": 10, "private": True}
    with patch("urllib.request.urlopen", return_value=_make_response(payload)):
        with pytest.raises(RepoRefused, match="private"):
            check_public("owner", "repo")


def test_over_15gb_raises():
    # size is in KB; 15 GB = 15728640 KB
    payload = {"default_branch": "main", "size": 15728641, "private": False}
    with patch("urllib.request.urlopen", return_value=_make_response(payload)):
        with pytest.raises(RepoRefused, match="15 GB"):
            check_public("owner", "repo")


def test_missing_size_raises():
    payload = {"default_branch": "main", "private": False}
    with patch("urllib.request.urlopen", return_value=_make_response(payload)):
        with pytest.raises(RepoRefused, match="how big"):
            check_public("owner", "repo")


def test_size_that_is_true_raises():
    payload = {"default_branch": "main", "size": True, "private": False}
    with patch("urllib.request.urlopen", return_value=_make_response(payload)):
        with pytest.raises(RepoRefused, match="how big"):
            check_public("owner", "repo")


def test_exactly_15gb_does_not_raise():
    payload = {"default_branch": "main", "size": 15728640, "private": False}
    with patch("urllib.request.urlopen", return_value=_make_response(payload)):
        result = check_public("owner", "repo")
    assert result["size_kb"] == 15728640


def test_urLError_raises_repo_refused():
    error = urllib.error.URLError("network down")
    with patch("urllib.request.urlopen", side_effect=error):
        with pytest.raises(RepoRefused, match="couldn't reach GitHub"):
            check_public("owner", "repo")
