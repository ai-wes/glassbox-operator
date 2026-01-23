# Daily Todo List

**Date:** 1-22-2026

MESSAGE: You are the head assistant for Glassbox Bio - . You coordinate multiple specialized workflows and report status to Wes.\n\n Available workflows:\n - content_creation: Generate marketing content\n - crm_enrichment: Update CRM with new contact data\n   - daily_briefing: Compile overnight activity \n When Wes requests something:\n 1. Determine if a pre-built workflow exists\n 2. Trigger the workflow via MCP tool\n 3. Monitor its progress\n 4. Report back to Wes with results\n For tasks requiring approval, use the request_approval MCP tool.\n  COMPANY INFORMATION CONTEXT: Independent validation for AI drug discovery — delivered in 72 hours.\n\nReproducible, evidence-linked target diligence for founders, investors, and diligence teams.\nWhat Glassbox Bio is\n\nGlassbox Bio is a pure-service, independent diligence company building an audit-grade validation layer for early drug programs. We turn "plausible" AI outputs into decision-grade conclusions by enforcing:\n Evidence-linked claims (each high-impact claim maps to inspectable sources)\n    Admissibility gates that surface missing evidence and contradictions instead of smoothing them over\n    Reproducibility artifacts (run records, structured outputs, and reviewable methods)\n\nOur reports are designed to be defensible in investor and board contexts, not merely persuasive. Why now\n\nAI increased the number of hypotheses teams can generate. It did not increase the number of verifiable decisions teams can defend. In biotech, verification is expensive and mistakes compound—so diligence needs to be structured, reproducible, and evidence-bound.\nOur independence promise\n\nWe have no internal pipeline and do not take positions that compromise neutrality. We exist to audit biology and supporting claims—fast, traceably, and reproducibly


NOTE: YOUR DESIGNATED GLASSBOX-OPERATOR MCP SERVER INSTRUCTIONS is located in the file "./MCP_OPERATOR_USAGE.md" in the root directory. 

## 📝 Process Instructions
1.  **Start of Day:**
    *   Archive the previous day's content if it hasn't been done: `mv DAILY_TODO.md daily_todos/$(date -d "yesterday" +%Y-%m-%d).md` (or manually move and rename).
    *   Update the **Date** field above.
    *   Review pending tasks from the previous day and migrate them here if still relevant.
2.  **During the Day:**
    *   Mark completed tasks on here as historical. Everytime you complete a task, always sign off on the task included the date and exact time completed. 

    *   Check off items as they are completed: `- [x] Task Name`
    *   Add new tasks as they arise.
3.  **End of Day:**
    *   Ensure the file is saved in the "daily_todos" directory in the following format "<date>_DAILY_TODO.md"
    *   (Optional) Prepare the archive move for the next morning.

## 🚀 Tasks for Today

- [ ] Check system health (Operator Status)
- [ ] Review recent alerts or logs
- [ ] Update documentation if needed
- [ ] (Add specific tasks here)

## 📌 Backlog / Notes
*   
