import pytest

from check.repo_url import BadRepoUrl, parse_repo_url

MSG = "That doesn't look like a public GitHub repo. Try https://github.com/owner/repo."


def test_valid_basic():
    assert parse_repo_url("https://github.com/owner/repo") == ("owner", "repo")


def test_valid_trailing_slash():
    assert parse_repo_url("https://github.com/owner/repo/") == ("owner", "repo")


def test_valid_dot_git():
    assert parse_repo_url("https://github.com/owner/repo.git") == ("owner", "repo")


def test_valid_tree():
    assert parse_repo_url("https://github.com/owner/repo/tree/main") == ("owner", "repo")


def test_valid_tree_with_extra():
    assert parse_repo_url("https://github.com/owner/repo/tree/main/src") == ("owner", "repo")


def test_valid_http():
    assert parse_repo_url("http://github.com/owner/repo") == ("owner", "repo")


def test_valid_no_scheme():
    assert parse_repo_url("github.com/owner/repo") == ("owner", "repo")


def test_valid_shorthand():
    assert parse_repo_url("owner/repo") == ("owner", "repo")


def test_valid_whitespace():
    assert parse_repo_url("  owner/repo  ") == ("owner", "repo")


def test_valid_owner_hyphen():
    assert parse_repo_url("my-owner/my.repo-123") == ("my-owner", "my.repo-123")


def test_bad_empty():
    with pytest.raises(BadRepoUrl) as exc_info:
        parse_repo_url("")
    assert str(exc_info.value) == MSG


def test_bad_whitespace_only():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("   ")


def test_bad_dotdot():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("../x")


def test_bad_traversal():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("o/r/../../etc")


def test_bad_evil_host():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("https://evil.example/o/r")


def test_bad_space_in():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("o r/x")


def test_bad_dash_owner():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("-x/y")


def test_bad_extra_path():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("https://github.com/owner/repo/extra")


def test_bad_repo_dot():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("owner/.")


def test_bad_repo_dotdot():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("owner/..")


def test_bad_owner_too_long():
    with pytest.raises(BadRepoUrl):
        parse_repo_url("a" * 40 + "/repo")
