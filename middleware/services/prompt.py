from pathlib import Path


def load_agents_md(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def load_skills(paths: list[str]) -> str:
    blocks = []
    for p in paths:
        try:
            content = Path(p).read_text(encoding="utf-8").strip()
            blocks.append(f"## {Path(p).parent.name}\n{content}\n")
        except Exception:
            continue
    return "\n".join(blocks).strip()


def ensure_skills_installed(paths: list[str], repo_root: str) -> None:
    root = Path(repo_root) / ".opencode" / "skill"
    root.mkdir(parents=True, exist_ok=True)
    for p in paths:
        src = Path(p)
        if not src.exists():
            continue
        skill_name = src.parent.name
        dest_dir = root / skill_name
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / "SKILL.md"
        try:
            dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception:
            continue


def build_system_prompt(base_prompt: str, agents_text: str, skills_text: str) -> str:
    blocks = [base_prompt]
    if agents_text:
        blocks.append("# AGENTS.md\n" + agents_text)
    if skills_text:
        blocks.append("# Skills\n" + skills_text)
    return "\n\n".join(b for b in blocks if b).strip()
