async function getJSON(url, opts) {
  const res = await fetch(url, {
    ...(opts || {}),
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function refreshUpstreams() {
  const data = await getJSON("/api/upstreams");
  document.getElementById("upstreams").textContent = JSON.stringify(data, null, 2);
  document.getElementById("writeGate").textContent =
    data.allowWriteGlobal ? "Write Gate: ENABLED (OPERATOR_ALLOW_WRITE=1)" : "Write Gate: DISABLED (OPERATOR_ALLOW_WRITE=0)";
}

async function refreshTools() {
  const data = await getJSON("/api/tools");
  const sel = document.getElementById("toolSelect");
  sel.innerHTML = "";
  for (const t of data.tools) {
    const opt = document.createElement("option");
    opt.value = JSON.stringify(t);
    opt.textContent = `${t.qualifiedName} (${t.cluster})`;
    sel.appendChild(opt);
  }
  if (data.tools.length) document.getElementById("args").value = "{}";
}

async function runTool() {
  const raw = document.getElementById("toolSelect").value;
  if (!raw) return;
  const tool = JSON.parse(raw);
  const args = JSON.parse(document.getElementById("args").value || "{}");
  const dry_run = document.getElementById("dryRun").checked;
  const confirm_write = document.getElementById("confirmWrite").checked;
  const mutating = document.getElementById("mutatingHint").checked;

  const payload = {
    upstream_id: tool.upstreamId,
    tool: tool.name,
    args,
    dry_run,
    confirm_write,
    mutating
  };

  const res = await getJSON("/api/proxy/call", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("toolResult").textContent = JSON.stringify(res, null, 2);
}

async function runLeadCapture() {
  const payload = JSON.parse(document.getElementById("leadPayload").value);
  const res = await getJSON("/api/playbooks/revops/lead-capture", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("leadResult").textContent = JSON.stringify(res, null, 2);
}

async function runInboxTriage() {
  const payload = JSON.parse(document.getElementById("triagePayload").value);
  const res = await getJSON("/api/playbooks/revops/inbox-triage", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("triageResult").textContent = JSON.stringify(res, null, 2);
}

async function runPipelineHygiene() {
  const payload = JSON.parse(document.getElementById("hygienePayload").value);
  const res = await getJSON("/api/playbooks/revops/pipeline-hygiene", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("hygieneResult").textContent = JSON.stringify(res, null, 2);
}

async function runWeeklyBrief() {
  const payload = JSON.parse(document.getElementById("briefPayload").value);
  const res = await getJSON("/api/playbooks/revops/weekly-brief", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("briefResult").textContent = JSON.stringify(res, null, 2);
}

async function runEngStatus() {
  const payload = JSON.parse(document.getElementById("engPayload").value);
  const res = await getJSON("/api/playbooks/engops/status", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("engResult").textContent = JSON.stringify(res, null, 2);
}

async function runOpsDaily() {
  const payload = JSON.parse(document.getElementById("opsPayload").value);
  const res = await getJSON("/api/playbooks/ops/glassbox-daily", { method: "POST", body: JSON.stringify(payload) });
  document.getElementById("opsResult").textContent = JSON.stringify(res, null, 2);
}

document.getElementById("refreshUpstreams").onclick = refreshUpstreams;
document.getElementById("refreshTools").onclick = refreshTools;
document.getElementById("runTool").onclick = runTool;

document.getElementById("runLeadCapture").onclick = runLeadCapture;
document.getElementById("runInboxTriage").onclick = runInboxTriage;
document.getElementById("runPipelineHygiene").onclick = runPipelineHygiene;
document.getElementById("runWeeklyBrief").onclick = runWeeklyBrief;

document.getElementById("runEngStatus").onclick = runEngStatus;
document.getElementById("runOpsDaily").onclick = runOpsDaily;

refreshUpstreams().catch(console.error);
refreshTools().catch(console.error);
