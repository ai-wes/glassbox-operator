"""initial

Revision ID: 0001_initial
Revises: 
Create Date: 2026-01-22
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("device_tokens", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("opencode_session_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_sessions_opencode_session_id", "sessions", ["opencode_session_id"], unique=True)

    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("opencode_message_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_messages_session_id", "messages", ["session_id"], unique=False)

    op.create_table(
        "workflows",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("definition_json", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=True),
    )

    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("workflow_id", sa.String(length=64), sa.ForeignKey("workflows.id"), nullable=False),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("progress", sa.Float(), nullable=True),
        sa.Column("eta_seconds", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("meta_json", sa.Text(), nullable=True),
    )
    op.create_index("ix_workflow_runs_workflow_id", "workflow_runs", ["workflow_id"], unique=False)

    op.create_table(
        "approvals",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("workflow_run_id", sa.String(length=64), sa.ForeignKey("workflow_runs.id"), nullable=True),
        sa.Column("session_id", sa.String(length=36), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column("action", sa.String(length=255), nullable=False),
        sa.Column("context_json", sa.Text(), nullable=True),
        sa.Column("risk_level", sa.String(length=16), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_approvals_workflow_run_id", "approvals", ["workflow_run_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_approvals_workflow_run_id", table_name="approvals")
    op.drop_table("approvals")

    op.drop_index("ix_workflow_runs_workflow_id", table_name="workflow_runs")
    op.drop_table("workflow_runs")

    op.drop_table("workflows")

    op.drop_index("ix_messages_session_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_sessions_opencode_session_id", table_name="sessions")
    op.drop_table("sessions")

    op.drop_table("users")
