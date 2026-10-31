"""Run the packaged renderer with workspace temp directories on Windows.

Python 3.13's special 0700 mkdir ACL prevents the sandboxed renderer from
reopening its own temp folders. Use ordinary inherited workspace ACLs for
new, non-sensitive rendering scratch folders only.
"""
import tempfile, uuid, os, runpy, sys
from pathlib import Path
root=Path(__file__).resolve().parent/'render_temp'
root.mkdir(exist_ok=True)
def workspace_temp(suffix=None,prefix=None,dir=None):
    target=root/((prefix or 'tmp')+uuid.uuid4().hex+(suffix or ''))
    os.mkdir(target)
    return str(target)
tempfile.mkdtemp=workspace_temp
script=r'C:\Users\Administrator\.codex\plugins\cache\openai-primary-runtime\documents\26.1025.11240\skills\documents\render_docx.py'
sys.argv=[script,*sys.argv[1:]]
runpy.run_path(script,run_name='__main__')
