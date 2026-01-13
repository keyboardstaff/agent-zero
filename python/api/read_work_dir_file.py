import os
import mimetypes
from pathlib import Path
from python.helpers.api import ApiHandler, Input, Request, Output
from python.helpers import runtime, files


class ReadWorkDirFile(ApiHandler):
    async def process(self, input: Input, request: Request) -> Output:
        file_path = input.get("path", "")
        if not file_path:
            raise Exception("Missing path")

        result = await runtime.call_development_function(read_file, file_path)
        if not result["ok"]:
            raise Exception(result["error"])
        return result


async def read_file(file_path: str) -> dict:
    """Read file content for editing."""
    base_dir = Path("/")
    
    # Normalize path
    if not file_path.startswith("/"):
        file_path = "/" + file_path
    
    full_path = (base_dir / file_path.lstrip("/")).resolve()
    
    # Security check
    if not str(full_path).startswith(str(base_dir)):
        return {"ok": False, "error": "Invalid path"}
    
    # Check if editable
    ok, error = files.check_file_editable(str(full_path))
    if not ok:
        return {"ok": False, "error": error}
    
    try:
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        
        # Guess MIME type for syntax highlighting
        mime_type, _ = mimetypes.guess_type(str(full_path))
        
        return {
            "ok": True,
            "content": content,
            "mimeType": mime_type or "text/plain",
            "fileName": full_path.name
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
