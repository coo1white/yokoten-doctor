import pathlib
from pathlib import Path


def test_requirements_exists_and_lists_modal():
    repo_root = Path(__file__).resolve().parents[2]
    req_path = repo_root / "server" / "requirements.txt"
    assert req_path.exists(), f"missing {req_path}"
    content = req_path.read_text(encoding="utf-8")
    assert "modal" in content


def test_web_image_versions_match_requirements():
    req = pathlib.Path('server/requirements.txt').read_text()
    app = pathlib.Path('server/app.py').read_text()
    for line in req.strip().splitlines():
        if not line.strip():
            continue
        pkg, ver = line.split('==')
        assert f'{pkg}=={ver}' in app, f'{pkg}=={ver} not in server/app.py web_image'


def test_web_image_holds_every_server_package():
    # A deploy once left out modules, and the tests here could not see it.
    app = pathlib.Path('server/app.py').read_text()
    packages = ['check', 'fixes', 'record', 'report']
    for name in packages:
        assert f'.add_local_dir(HERE / "{name}", "/root/{name}")' in app, f'{name} not in web_image'


def test_report_job_image_holds_every_server_package():
    app = pathlib.Path('server/app.py').read_text()
    start = app.index('job_image = (')
    end = app.index('\n)', start)
    block = app[start:end]
    packages = ['check', 'fixes', 'record', 'report']
    for name in packages:
        assert f'.add_local_dir(HERE / "{name}", "/root/{name}")' in block, f'{name} not in job_image'
    assert 'fastapi==0.162.0' in block
    assert 'cryptography==50.0.2' in block
    assert 'image=job_image' in app
