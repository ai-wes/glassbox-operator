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
    lane: Optional[str] = None,
    day_bucket: Optional[str] = None
) -> str:
    """
    List tasks from the middleware, optionally filtering by lane or day bucket.
    
    Args:
        lane: Filter tasks by lane (TODAY, DOING, NEEDS_APPROVAL, QUEUED, DONE, BLOCKED, CANCELLED)
        day_bucket: Filter tasks by YYYY-MM-DD
    """
    try:
        params = {}
        if lane:
            params["lane"] = lane
        if day_bucket:
            params["day_bucket"] = day_bucket
            
        resp = requests.get(f"{API_BASE_URL}/tasks", params=params)
        resp.raise_for_status()
        tasks = resp.json()
        
        if not tasks:
            return "No tasks found."
            
        # Format as a readable list
        output = []
        for t in tasks:
            output.append(f"[{t['lane']}] {t['title']} (ID: {t['id']})")
            if t.get('description'):
                output.append(f"  Description: {t['description']}")
            output.append(f"  Priority: {t['priority']} | Mode: {t['execution_mode']}")
            output.append(f"  Approval: {t['approval_state']} | Run: {t['run_state']}")
            if t.get('day_bucket'):
                output.append(f"  Day: {t['day_bucket']}")
            output.append("---")
            
        return "\n".join(output)
    except Exception as e:
        return f"Error listing tasks: {str(e)}"

@mcp.tool()
def create_task(
    title: str,
    description: Optional[str] = None,
    lane: str = "TODAY",
    execution_mode: str = "AUTO",
    mcp_action: Optional[str] = None,
    priority: int = 50,
    day_bucket: Optional[str] = None
) -> str:
    """
    Create a new task.
    
    Args:
        title: Title of the task
        description: Detailed description
        lane: Kanban lane
        execution_mode: AUTO | APPROVAL_REQUIRED | APPROVAL_THEN_EXECUTE
        mcp_action: MCP workflow action name
        priority: 0-100
        day_bucket: YYYY-MM-DD
    """
    try:
        payload = {
            "title": title,
            "description": description,
            "lane": lane,
            "execution_mode": execution_mode,
            "mcp_action": mcp_action,
            "priority": priority,
            "day_bucket": day_bucket,
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
    lane: str
) -> str:
    """
    Update the lane of a task.
    
    Args:
        task_id: The ID of the task to update
        lane: New lane (TODAY, DOING, NEEDS_APPROVAL, QUEUED, DONE, BLOCKED, CANCELLED)
    """
    try:
        payload = {"lane": lane}
        resp = requests.patch(f"{API_BASE_URL}/tasks/{task_id}", json=payload)
        resp.raise_for_status()
        return f"Task {task_id} updated to lane: {lane}"
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
        response: 'approve' or 'reject'
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
