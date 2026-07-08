"use client";
import { useRef, useState } from "react";

const box = { background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: 20, marginBottom: 16 };
const input = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", padding: "10px 12px", width: "100%", boxSizing: "border-box", fontSize: 14 };
const btn = (bg) => ({ background: bg, border: "none", borderRadius: 6, color: "#fff", padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" });

export default function Home() {
  const [sheetInput, setSheetInput] = useState("");
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState("");
  const [leads, setLeads] = useState([]);
  const [limit, setLimit] = useState("");
  const [force, setForce] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const stopRef = useRef(false);

  const addLog = (msg, cls = "") => setLog((l) => [...l, { msg, cls, t: new Date().toLocaleTimeString() }]);

  async function loadTabs() {
    setMeta(null); setLeads([]); setLog([]);
    const r = await fetch("/api/tabs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spreadsheet: sheetInput }) });
    const d = await r.json();
    if (d.error) return addLog(`Error: ${d.error}`, "err");
    setMeta(d); setTab(d.tabs[0] || "");
    addLog(`Connected: "${d.title}" (${d.tabs.length} tabs)`);
  }

  async function loadLeads() {
    setLeads([]);
    const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spreadsheetId: meta.spreadsheetId, sheetName: tab }) });
    const d = await r.json();
    if (d.error) return addLog(`Error: ${d.error}`, "err");
    setLeads(d.leads);
    addLog(`Loaded ${d.leads.length} leads from "${tab}" (${d.leads.filter((l) => l.done).length} already filled)`);
  }

  async function run() {
    setRunning(true); stopRef.current = false;
    const queue = leads.filter((l) => force || !l.done);
    const max = limit ? Math.min(parseInt(limit, 10) || queue.length, queue.length) : queue.length;
    addLog(`Starting run: ${max} lead(s), only tab "${tab}" will be updated.`);
    let done = 0;
    for (const lead of queue.slice(0, max)) {
      if (stopRef.current) { addLog("Stopped by user.", "warn"); break; }
      addLog(`Row ${lead.rowNumber} | ${lead.name} @ ${lead.company} ... screening + detecting events + writing E1-E4`);
      try {
        const r = await fetch("/api/process", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spreadsheetId: meta.spreadsheetId, sheetName: tab, rowNumber: lead.rowNumber, force })
        });
        const d = await r.json();
        if (d.error) addLog(`  FAILED: ${d.error}`, "err");
        else if (d.skipped) addLog(`  skipped (${d.reason})`, "warn");
        else {
          addLog(`  Signal: ${d.signal}`, d.eventsUsed ? "ok" : "dim");
          d.results.forEach((x) => x.subject && addLog(`  E${x.step}: "${x.subject}"`, "ok"));
          done++;
          setLeads((ls) => ls.map((l) => l.rowNumber === lead.rowNumber ? { ...l, done: true, status: "Ready" } : l));
        }
      } catch (e) { addLog(`  FAILED: ${e.message}`, "err"); }
    }
    addLog(`Run finished. ${done} lead(s) written.`);
    setRunning(false);
  }

  const color = { err: "#f85149", ok: "#3fb950", warn: "#d29922", dim: "#8b949e" };

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 22 }}>Kings Research — Cadence Generator</h1>
      <p style={{ color: "#8b949e", marginTop: -8 }}>Select a sheet → screen each prospect (website + live news) → detect real company events → write four consultancy emails (E1–E4) back to that sheet only.</p>

      <div style={box}>
        <label style={{ fontSize: 13, color: "#8b949e" }}>Google Sheet URL or ID (share it with the service account as Editor)</label>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <input style={input} value={sheetInput} onChange={(e) => setSheetInput(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          <button style={btn("#238636")} onClick={loadTabs}>Connect</button>
        </div>
        {meta && (
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
            <select style={{ ...input, width: 300 }} value={tab} onChange={(e) => setTab(e.target.value)}>
              {meta.tabs.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button style={btn("#1f6feb")} onClick={loadLeads}>Load leads</button>
          </div>
        )}
      </div>

      {leads.length > 0 && (
        <div style={box}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <input style={{ ...input, width: 160 }} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Max leads (blank = all)" />
            <label style={{ fontSize: 13, color: "#8b949e" }}>
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Regenerate filled rows
            </label>
            {!running
              ? <button style={btn("#238636")} onClick={run}>Run generation</button>
              : <button style={btn("#da3633")} onClick={() => { stopRef.current = true; }}>Stop</button>}
            <span style={{ fontSize: 13, color: "#8b949e" }}>{leads.filter((l) => l.done).length}/{leads.length} filled</span>
          </div>
          <div style={{ maxHeight: 220, overflow: "auto", marginTop: 14, fontSize: 13 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.rowNumber} style={{ borderBottom: "1px solid #21262d" }}>
                    <td style={{ padding: "6px 8px", color: "#8b949e" }}>{l.rowNumber}</td>
                    <td style={{ padding: "6px 8px" }}>{l.name}</td>
                    <td style={{ padding: "6px 8px" }}>{l.company}</td>
                    <td style={{ padding: "6px 8px", color: "#8b949e" }}>{l.title}</td>
                    <td style={{ padding: "6px 8px", color: l.done ? "#3fb950" : "#d29922" }}>{l.done ? "Ready" : (l.status || "Pending")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div style={{ ...box, fontFamily: "ui-monospace, monospace", fontSize: 12.5, maxHeight: 380, overflow: "auto" }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: color[l.cls] || "#e6edf3", padding: "1px 0" }}>
              <span style={{ color: "#484f58" }}>{l.t} </span>{l.msg}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
