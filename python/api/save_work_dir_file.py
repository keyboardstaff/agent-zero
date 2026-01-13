import os
from pathlib import Path
from python.helpers.api import ApiHandler, Input, Request, Output
from python.helpers import runtime


class SaveWorkDirFile(ApiHandler):
    async def process(self, input: Input, request: Request) -> Output:
        file_path = input.get("path", "")
        content = input.get("content", "")
        create_new = input.get("createNew", False)

        if not file_path:
            raise Exception("Missing path")

        result = await runtime.call_development_function(
            save_file, file_path, content, create_new
        )
        if not result["ok"]:
            raise Exception(result["error"])
        return result


async def save_file(file_path: str, content: str, create_new: bool = False) -> dict:
    """Save content to file."""
    base_dir = Path("/")
    
    # Normalize path
    if not file_path.startswith("/"):
        file_path = "/" + file_path
    
    full_path = (base_dir / file_path.lstrip("/")).resolve()
    
    # Security check
    if not str(full_path).startswith(str(base_dir)):
        return {"ok": False, "error": "Invalid path"}
    
    # Check for new file creation
    if create_new:
        if full_path.exists():
            return {"ok": False, "error": "File already exists"}
        # Ensure parent directory exists
        full_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        if not full_path.exists():
            return {"ok": False, "error": "File not found"}
    
    try:
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"ok": True, "path": str(full_path.relative_to(base_dir))}
    except Exception as e:
        return {"ok": False, "error": str(e)}
