import json
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session as DbSession

from middleware.models import Workflow


def load_workflows_from_file(db: DbSession, path: Optional[str]) -> None:
    if not path:
        return
    p = Path(path)
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    workflows = data.get("workflows", [])
    for wf in workflows:
        existing = db.get(Workflow, wf["id"])
        payload = {
            "id": wf["id"],
            "name": wf["name"],
            "description": wf.get("description"),
            "category": wf.get("category"),
            "definition_json": json.dumps(wf),
            "enabled": bool(wf.get("enabled", True)),
        }
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
        else:
            db.add(Workflow(**payload))
    db.commit()
