"""kanban tasks and templates

Revision ID: 0003_kanban_tasks
Revises: 0002_add_tasks
Create Date: 2026-01-24
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_kanban_tasks"
down_revision = "0002_add_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("tasks")

    op.create_table(
        "task_templates",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("schedule_kind", sa.String(length=32), nullable=False, server_default="DAILY"),
        sa.Column("schedule_time_local", sa.String(length=16), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("execution_mode", sa.String(length=32), nullable=False, server_default="AUTO"),
        sa.Column("default_lane", sa.String(length=32), nullable=False, server_default="TODAY"),
        sa.Column("mcp_action", sa.String(length=255), nullable=True),
        sa.Column("publish_mcp_action", sa.String(length=255), nullable=True),
        sa.Column("default_input_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("template_id", sa.String(length=64), sa.ForeignKey("task_templates.id"), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("lane", sa.String(length=32), nullable=False, server_default="TODAY"),
        sa.Column("execution_mode", sa.String(length=32), nullable=False, server_default="AUTO"),
        sa.Column("mcp_action", sa.String(length=255), nullable=True),
        sa.Column("publish_mcp_action", sa.String(length=255), nullable=True),
        sa.Column("input_json", sa.Text(), nullable=True),
        sa.Column("approval_state", sa.String(length=32), nullable=False, server_default="NONE"),
        sa.Column("run_state", sa.String(length=32), nullable=False, server_default="IDLE"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("day_bucket", sa.String(length=16), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("status_detail", sa.String(length=255), nullable=True),
        sa.Column("blocked_reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "task_artifacts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "task_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("ts", sa.DateTime(), nullable=False),
        sa.Column("actor", sa.String(length=32), nullable=False, server_default="SYSTEM"),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
    )

    with op.batch_alter_table("approvals") as batch:
        batch.add_column(sa.Column("task_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key("fk_approvals_task_id", "tasks", ["task_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("approvals") as batch:
        batch.drop_constraint("fk_approvals_task_id", type_="foreignkey")
        batch.drop_column("task_id")

    op.drop_table("task_events")
    op.drop_table("task_artifacts")
    op.drop_table("tasks")
    op.drop_table("task_templates")

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("queue", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=True),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
