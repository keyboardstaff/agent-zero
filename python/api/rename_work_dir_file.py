import os
from pathlib import Path
from python.helpers.api import ApiHandler, Input, Request, Output
from python.helpers import runtime


class RenameWorkDirFile(ApiHandler):
    async def process(self, input: Input, request: Request) -> Output:
        old_path = input.get("oldPath", "")
        new_name = input.get("newName", "").strip()

        if not old_path or not new_name:
            raise Exception("Missing oldPath or newName")

        # Validate new name (no path separators)
        if "/" in new_name or "\\" in new_name:
            raise Exception("Invalid name: cannot contain path separators")

        result = await runtime.call_development_function(rename_file, old_path, new_name)
        if not result["ok"]:
            raise Exception(result["error"])
        return result


async def rename_file(old_path: str, new_name: str) -> dict:
    """Rename a file or folder."""
    base_dir = Path("/")
    
    # Normalize path
    if not old_path.startswith("/"):
        old_path = "/" + old_path
    
    full_old = (base_dir / old_path.lstrip("/")).resolve()
    
    # Security check
    if not str(full_old).startswith(str(base_dir)):
        return {"ok": False, "error": "Invalid path"}
    
    if not full_old.exists():
        return {"ok": False, "error": "File or folder not found"}
    
    # Build new path (same parent, new name)
    full_new = full_old.parent / new_name
    
    if full_new.exists():
        return {"ok": False, "error": "A file or folder with that name already exists"}
    
    try:
        os.rename(full_old, full_new)
        return {
            "ok": True,
            "newPath": str(full_new.relative_to(base_dir))
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
