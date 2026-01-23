import os
import requests
from typing import Optional
from mcp.server.fastmcp import FastMCP

# Configuration
API_BASE_URL = os.environ.get("MIDDLEWARE_API_URL", "http://localhost:8099")

# Initialize FastMCP server
mcp = FastMCP("glassbox-tasks")

@mcp.tool()
def list_tasks(
    status: Optional[str] = None,
    queue: Optional[str] = None
) -> str:
    """
    List tasks from the middleware, optionally filtering by status or queue.
    
    Args:
        status: Filter tasks by status (e.g., 'todo', 'in_progress', 'done')
        queue: Filter tasks by queue (e.g., 'general', 'engineering', 'approvals')
    """
    try:
        params = {}
        if status:
            params["status"] = status
        if queue:
            params["queue"] = queue
            
        resp = requests.get(f"{API_BASE_URL}/tasks", params=params)
        resp.raise_for_status()
        tasks = resp.json()
        
        if not tasks:
            return "No tasks found."
            
        # Format as a readable list
        output = []
        for t in tasks:
            output.append(f"[{t['status'].upper()}] {t['title']} (ID: {t['id']})")
            if t.get('description'):
                output.append(f"  Description: {t['description']}")
            output.append(f"  Queue: {t['queue']} | Priority: {t['priority']}")
            if t.get('due_date'):
                output.append(f"  Due: {t['due_date']}")
            if t.get('tags'):
                output.append(f"  Tags: {', '.join(t['tags'])}")
            output.append("---")
            
        return "\n".join(output)
    except Exception as e:
        return f"Error listing tasks: {str(e)}"

@mcp.tool()
def create_task(
    title: str,
    description: Optional[str] = None,
    queue: str = "general",
    priority: str = "medium",
    due_date: Optional[str] = None,
    tags: Optional[list[str]] = None
) -> str:
    """
    Create a new task.
    
    Args:
        title: Title of the task
        description: Detailed description
        queue: Queue name (default: general)
        priority: Priority (low, medium, high, critical)
        due_date: ISO 8601 date string (optional)
        tags: List of tags (optional)
    """
    try:
        payload = {
            "title": title,
            "description": description,
            "queue": queue,
            "priority": priority,
            "due_date": due_date,
            "tags": tags or []
        }
        
        resp = requests.post(f"{API_BASE_URL}/tasks", json=payload)
        resp.raise_for_status()
        t = resp.json()
        return f"Task created successfully. ID: {t['id']}"
    except Exception as e:
        return f"Error creating task: {str(e)}"

@mcp.tool()
def update_task_status(
    task_id: str,
    status: str
) -> str:
    """
    Update the status of a task.
    
    Args:
        task_id: The ID of the task to update
        status: New status (todo, in_progress, review, blocked, done)
    """
    try:
        payload = {"status": status}
        resp = requests.patch(f"{API_BASE_URL}/tasks/{task_id}", json=payload)
        resp.raise_for_status()
        return f"Task {task_id} updated to status: {status}"
    except Exception as e:
        return f"Error updating task: {str(e)}"

@mcp.tool()
def list_approvals() -> str:
    """
    List pending approvals from the system.
    """
    try:
        resp = requests.get(f"{API_BASE_URL}/approvals")
        resp.raise_for_status()
        approvals = resp.json()
        
        pending = [a for a in approvals if a['status'] == 'pending']
        
        if not pending:
            return "No pending approvals."
            
        output = []
        for a in pending:
            output.append(f"[PENDING] {a['action']} (ID: {a['id']})")
            output.append(f"  Risk Level: {a['risk_level']}")
            output.append(f"  Requested At: {a['requested_at']}")
            if a.get('context_json'):
                output.append(f"  Context: {a['context_json']}")
            output.append("---")
            
        return "\n".join(output)
    except Exception as e:
        return f"Error listing approvals: {str(e)}"

@mcp.tool()
def respond_to_approval(
    approval_id: str,
    response: str
) -> str:
    """
    Approve or reject a pending request.
    
    Args:
        approval_id: The ID of the approval
        response: 'approved' or 'rejected'
    """
    try:
        payload = {"response": response}
        resp = requests.post(f"{API_BASE_URL}/approvals/{approval_id}/respond", json=payload)
        resp.raise_for_status()
        return f"Approval {approval_id} processed: {response}"
    except Exception as e:
        return f"Error responding to approval: {str(e)}"

if __name__ == "__main__":
    mcp.run()
