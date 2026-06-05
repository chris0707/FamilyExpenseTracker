import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG — paste your Apps Script Web App URL here ─────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxdg_GtaHiKF8nZPHE-osx1vKBYelytr3OkrCwO3EkmuRyu7AvH4IVb3zIiQAh9LVrT/exec";

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "groceries",     label: "Groceries",     icon: "🛒", color: "#4ade80" },
  { id: "utilities",     label: "Utilities",     icon: "💡", color: "#facc15" },
  { id: "mortgage",      label: "Mortgage",      icon: "🏠", color: "#60a5fa" },
  { id: "insurance",     label: "Insurance",     icon: "🛡️", color: "#a78bfa" },
  { id: "transport",     label: "Transport",     icon: "🚗", color: "#fb923c" },
  { id: "dining",        label: "Dining Out",    icon: "🍽️", color: "#f472b6" },
  { id: "health",        label: "Health",        icon: "💊", color: "#34d399" },
  { id: "education",     label: "Education",     icon: "📚", color: "#38bdf8" },
  { id: "clothing",      label: "Clothing",      icon: "👕", color: "#c084fc" },
  { id: "entertainment", label: "Entertainment", icon: "🎬", color: "#ff7b7b" },
  { id: "savings",       label: "Savings",       icon: "🏦", color: "#6ee7b7" },
  { id: "other",         label: "Other",         icon: "📦", color: "#94a3b8" },
];

const AVATARS = ["👨","👩","👦","👧","🧓","👴","👵","🧑","🧒","👶"];
const COLORS  = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#14b8a6","#f97316","#06b6d4"];
const MONTHS  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function fmt(amount, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount);
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { year:"numeric", month:"short", day:"numeric" });
}

// ─── API Layer — all Google Sheets calls go through here ─────────────────────
const api = {
  async get(action) {
    const res = await fetch(`${SCRIPT_URL}?action=${action}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Request failed");
    return json.data;
  },
  async post(action, payload) {
    // Apps Script requires no-cors for cross-origin POST, so we use a
    // JSONP-style GET for mutations that need a response, OR we use
    // mode: "no-cors" and optimistic UI updates.
    // Best practice for Apps Script + external host: encode POST body
    // as a GET parameter using a "payload" param, which the script reads.
    const url = `${SCRIPT_URL}?action=${action}&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Request failed");
    return json.data;
  },
};

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:"fixed", top:16, right:16, zIndex:999, display:"flex", flexDirection:"column", gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "error" ? "#450a0a" : "#052e16",
          border: `1px solid ${t.type === "error" ? "#f87171" : "#4ade80"}`,
          borderRadius:10, padding:"10px 16px", fontSize:13,
          color: t.type === "error" ? "#fca5a5" : "#86efac",
          maxWidth: 280, boxShadow:"0 4px 20px rgba(0,0,0,0.4)",
          animation: "slideIn 0.2s ease"
        }}>
          {t.type === "error" ? "❌ " : "✓ "}{t.message}
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = "success") => {
    const id = genId();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  return { toasts, push };
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...S.modal, ...(wide ? { maxWidth:700 } : {}) }}>
        <div style={S.modalHeader}>
          <span style={S.modalTitle}>{title}</span>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>
        <div style={S.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ─── Receipt Scanner ──────────────────────────────────────────────────────────
function ReceiptScanner({ onResult }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(""); setLoading(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role:"user", content:[
            { type:"image", source:{ type:"base64", media_type: file.type || "image/jpeg", data: base64 }},
            { type:"text",  text:`Parse this receipt. Return ONLY a JSON object, no markdown:
{"merchant":"store name","date":"YYYY-MM-DD","total":number,"items":[{"name":"item","amount":number}],"category":"groceries|utilities|mortgage|insurance|transport|dining|health|education|clothing|entertainment|savings|other"}
Today is ${new Date().toISOString().slice(0,10)}.` }
          ]}]
        })
      });
      const data   = await response.json();
      const text   = data.content?.map(c => c.text||"").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
      onResult(parsed);
    } catch {
      setError("Could not read receipt — please fill in manually.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div style={{ marginBottom:16 }}>
      <label style={S.scanBtn}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
               onChange={handleFile} style={{ display:"none" }} />
        {loading ? "🔍 Reading receipt…" : "📷 Scan Receipt (AI)"}
      </label>
      {error && <p style={{ color:"#f87171", fontSize:13, marginTop:6 }}>{error}</p>}
    </div>
  );
}

// ─── Member Chip ──────────────────────────────────────────────────────────────
function MemberChip({ member, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding:"6px 14px", borderRadius:20,
      border:`2px solid ${selected ? member.color : "#334155"}`,
      background: selected ? member.color+"22" : "transparent",
      color: selected ? member.color : "#64748b",
      cursor:"pointer", fontSize:13, fontWeight:600,
      fontFamily:"inherit", transition:"all 0.15s"
    }}>{member.avatar} {member.name}</button>
  );
}

// ─── Expense Form ─────────────────────────────────────────────────────────────
function ExpenseForm({ expense, members, settings, onSave, onClose, saving }) {
  const isEdit = !!expense?.id;
  const [form, setForm] = useState(() => expense
    ? { ...expense }
    : { id:genId(), merchant:"", date:new Date().toISOString().slice(0,10),
        total:"", category:"groceries", notes:"", splits:[] });

  const [splitOn, setSplitOn]           = useState(form.splits.length > 0);
  const [splitMembers, setSplitMembers] = useState(() => form.splits.map(s=>s.memberId));
  const [splitAmts, setSplitAmts]       = useState(() => {
    const m={}; form.splits.forEach(s=>{ m[s.memberId]=s.amount; }); return m;
  });

  function set(k,v){ setForm(f=>({...f,[k]:v})); }

  function toggleMember(id) {
    setSplitMembers(p => {
      if (p.includes(id)) { setSplitAmts(a=>{const b={...a};delete b[id];return b;}); return p.filter(x=>x!==id); }
      return [...p, id];
    });
  }

  function evenSplit() {
    if (!splitMembers.length || !form.total) return;
    const each = (parseFloat(form.total)/splitMembers.length).toFixed(2);
    const m={}; splitMembers.forEach(id=>{ m[id]=each; }); setSplitAmts(m);
  }

  function handleScanResult(p) {
    setForm(f=>({
      ...f,
      merchant: p.merchant || f.merchant,
      date:     p.date     || f.date,
      total:    p.total!=null ? String(p.total) : f.total,
      category: p.category || f.category,
      notes:    p.items?.map(i=>`${i.name}: ${i.amount}`).join(", ") || f.notes,
    }));
  }

  function handleSave() {
    if (!form.merchant.trim()) return alert("Please enter a merchant or description.");
    if (!form.total || isNaN(parseFloat(form.total))) return alert("Please enter a valid amount.");
    const splits = splitOn
      ? splitMembers.map(id=>({ memberId:id, amount:parseFloat(splitAmts[id]||0) }))
      : [];
    onSave({ ...form, total:parseFloat(form.total), splits });
  }

  const splitTotal = Object.values(splitAmts).reduce((a,b)=>a+parseFloat(b||0),0);
  const remaining  = parseFloat(form.total||0) - splitTotal;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <ReceiptScanner onResult={handleScanResult} />

      <div style={S.row}>
        <div style={{ flex:1 }}>
          <label style={S.label}>Merchant / Description *</label>
          <input style={S.input} value={form.merchant}
                 onChange={e=>set("merchant",e.target.value)} placeholder="e.g. Costco Supermarket" />
        </div>
        <div style={{ width:160 }}>
          <label style={S.label}>Date *</label>
          <input type="date" style={S.input} value={form.date} onChange={e=>set("date",e.target.value)} />
        </div>
      </div>

      <div style={S.row}>
        <div style={{ flex:1 }}>
          <label style={S.label}>Amount ({settings.currency}) *</label>
          <input type="number" step="0.01" style={S.input} value={form.total}
                 onChange={e=>set("total",e.target.value)} placeholder="0.00" />
        </div>
        <div style={{ flex:1 }}>
          <label style={S.label}>Category</label>
          <select style={S.input} value={form.category} onChange={e=>set("category",e.target.value)}>
            {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={S.label}>Notes / Items</label>
        <textarea style={{ ...S.input, height:56, resize:"vertical" }} value={form.notes}
                  onChange={e=>set("notes",e.target.value)} placeholder="Milk, eggs, bread…" />
      </div>

      {members.length > 0 && (
        <div style={S.card}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <span style={S.label}>Split this expense?</span>
            <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:13, color:"#94a3b8" }}>
              <input type="checkbox" checked={splitOn} onChange={e=>setSplitOn(e.target.checked)}
                     style={{ accentColor:"#6366f1" }} />
              Enable split
            </label>
          </div>

          {splitOn && (
            <>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                {members.map(m=>(
                  <MemberChip key={m.id} member={m}
                    selected={splitMembers.includes(m.id)}
                    onClick={()=>toggleMember(m.id)} />
                ))}
              </div>

              {splitMembers.length > 0 && (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <span style={{ fontSize:13, color:"#64748b" }}>
                      {splitMembers.length} of {members.length} members
                    </span>
                    <button onClick={evenSplit} style={S.smBtn}>⚡ Split Evenly</button>
                  </div>
                  {splitMembers.map(id => {
                    const m = members.find(x=>x.id===id);
                    return (
                      <div key={id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                        <span style={{ minWidth:110, fontSize:13, color:m.color }}>{m.avatar} {m.name}</span>
                        <input type="number" step="0.01"
                               style={{ ...S.input, flex:1, marginBottom:0 }}
                               value={splitAmts[id]||""}
                               onChange={e=>setSplitAmts(a=>({...a,[id]:e.target.value}))}
                               placeholder="0.00" />
                      </div>
                    );
                  })}
                  <div style={{ textAlign:"right", marginTop:6, fontSize:13,
                    color: Math.abs(remaining)<0.01 ? "#4ade80" : "#fb923c" }}>
                    {Math.abs(remaining)<0.01
                      ? "✓ Perfectly balanced"
                      : `Unassigned: ${fmt(remaining, settings.currency)}`}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:4 }}>
        <button onClick={onClose} style={S.cancelBtn} disabled={saving}>Cancel</button>
        <button onClick={handleSave} style={S.primaryBtn} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Expense"}
        </button>
      </div>
    </div>
  );
}

// ─── Members Panel ────────────────────────────────────────────────────────────
function MembersPanel({ members, onSave, saving }) {
  const [local, setLocal] = useState(members);
  const [name,  setName]  = useState("");
  const [av,    setAv]    = useState(AVATARS[0]);
  const [color, setColor] = useState(COLORS[0]);

  function add() {
    if (!name.trim()) return;
    setLocal(p=>[...p, { id:genId(), name:name.trim(), avatar:av, color }]);
    setName("");
  }

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        <select style={{ ...S.input, width:52, padding:"8px 4px", textAlign:"center", marginBottom:0 }}
                value={av} onChange={e=>setAv(e.target.value)}>
          {AVATARS.map(a=><option key={a} value={a}>{a}</option>)}
        </select>
        <input style={{ ...S.input, flex:1, minWidth:120, marginBottom:0 }}
               value={name} onChange={e=>setName(e.target.value)}
               placeholder="Member name" onKeyDown={e=>e.key==="Enter"&&add()} />
        <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap" }}>
          {COLORS.map(c=>(
            <button key={c} onClick={()=>setColor(c)} style={{
              width:22, height:22, borderRadius:"50%", background:c, border:
              color===c ? "2px solid white" : "2px solid transparent",
              cursor:"pointer", padding:0
            }} />
          ))}
        </div>
        <button onClick={add} style={S.primaryBtn}>Add</button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
        {local.length === 0
          ? <span style={{ fontSize:13, color:"#475569" }}>No members yet. Add family members to enable splitting.</span>
          : local.map(m=>(
            <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10,
              background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"8px 12px" }}>
              <span style={{ fontSize:22 }}>{m.avatar}</span>
              <span style={{ flex:1, fontWeight:600, color:m.color }}>{m.name}</span>
              <div style={{ width:14, height:14, borderRadius:"50%", background:m.color }} />
              <button onClick={()=>setLocal(p=>p.filter(x=>x.id!==m.id))}
                      style={{ background:"none", border:"none", cursor:"pointer", color:"#f87171", fontSize:16 }}>✕</button>
            </div>
          ))
        }
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
        <button onClick={()=>onSave(local)} style={S.primaryBtn} disabled={saving}>
          {saving ? "Saving…" : "💾 Save Members"}
        </button>
      </div>
    </div>
  );
}

// ─── Summary Panel ────────────────────────────────────────────────────────────
function SummaryPanel({ expenses, members, settings }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year,  setYear]  = useState(now.getFullYear());

  const filtered = expenses.filter(e=>{
    const d = new Date(e.date);
    return d.getMonth()===month && d.getFullYear()===year;
  });

  const total = filtered.reduce((s,e)=>s+e.total, 0);

  const byCategory = CATEGORIES.map(cat=>({
    ...cat, amount: filtered.filter(e=>e.category===cat.id).reduce((s,e)=>s+e.total,0)
  })).filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount);

  const byMember = members.map(m=>({
    ...m, amount: filtered.reduce((s,e)=>{
      const sp = e.splits.find(x=>x.memberId===m.id);
      return s+(sp?sp.amount:0);
    },0)
  })).filter(m=>m.amount>0);

  function exportCSV() {
    const header = "Date,Merchant,Category,Amount,Notes,Split Members\n";
    const rows = filtered.map(e=>{
      const splits = e.splits.map(s=>{
        const m=members.find(x=>x.id===s.memberId);
        return `${m?.name||"?"}: ${fmt(s.amount,settings.currency)}`;
      }).join(" | ");
      return `"${e.date}","${e.merchant}","${e.category}","${e.total}","${e.notes||""}","${splits}"`;
    }).join("\n");
    dl(header+rows, `expenses_${year}_${MONTHS[month]}.csv`, "text/csv");
  }

  function exportTXT() {
    let t = `${settings.householdName} — Expense Summary\n${MONTHS[month]} ${year}\n${"=".repeat(40)}\n\n`;
    t += `TOTAL: ${fmt(total,settings.currency)}\n\nBY CATEGORY:\n`;
    byCategory.forEach(c=>{ t+=`  ${c.icon} ${c.label}: ${fmt(c.amount,settings.currency)}\n`; });
    if (byMember.length) {
      t+="\nBY MEMBER:\n";
      byMember.forEach(m=>{ t+=`  ${m.avatar} ${m.name}: ${fmt(m.amount,settings.currency)}\n`; });
    }
    t+="\nTRANSACTIONS:\n";
    filtered.forEach(e=>{
      t+=`  ${e.date} | ${e.merchant} | ${fmt(e.total,settings.currency)}\n`;
      e.splits.forEach(s=>{
        const m=members.find(x=>x.id===s.memberId);
        t+=`    → ${m?.name||"?"}: ${fmt(s.amount,settings.currency)}\n`;
      });
    });
    dl(t, `expenses_${year}_${MONTHS[month]}.txt`, "text/plain");
  }

  function dl(content, filename, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content],{type}));
    a.download = filename; a.click();
  }

  return (
    <div>
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
        <select style={{ ...S.input, marginBottom:0, width:100 }} value={month} onChange={e=>setMonth(Number(e.target.value))}>
          {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
        </select>
        <select style={{ ...S.input, marginBottom:0, width:90 }} value={year} onChange={e=>setYear(Number(e.target.value))}>
          {[2023,2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          <button onClick={exportTXT} style={S.smBtn}>📄 TXT</button>
          <button onClick={exportCSV} style={S.smBtn}>📊 CSV</button>
          <button onClick={()=>window.print()} style={S.smBtn}>🖨️ Print</button>
        </div>
      </div>

      <div style={{ textAlign:"center", padding:"16px 0", borderBottom:"1px solid #1e293b", marginBottom:16 }}>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:4 }}>Total — {MONTHS[month]} {year}</div>
        <div style={{ fontSize:34, fontWeight:800, color:"#f1f5f9", fontFamily:"Georgia,serif", letterSpacing:-1 }}>
          {fmt(total,settings.currency)}
        </div>
        <div style={{ fontSize:12, color:"#64748b", marginTop:4 }}>{filtered.length} transactions</div>
      </div>

      {byCategory.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={S.sectionLabel}>By Category</div>
          {byCategory.map(c=>(
            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <span style={{ width:130, fontSize:13, color:"#e2e8f0" }}>{c.icon} {c.label}</span>
              <div style={{ flex:1, height:8, background:"#1e293b", borderRadius:4, overflow:"hidden" }}>
                <div style={{ width:`${Math.min((c.amount/total)*100,100)}%`, height:"100%", background:c.color, borderRadius:4 }} />
              </div>
              <span style={{ width:110, textAlign:"right", fontSize:13, fontWeight:700, color:c.color }}>
                {fmt(c.amount,settings.currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {byMember.length > 0 && (
        <div>
          <div style={S.sectionLabel}>By Member (split expenses)</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
            {byMember.map(m=>(
              <div key={m.id} style={{ background:"#1e293b", border:`1px solid ${m.color}44`,
                borderRadius:12, padding:"12px 16px", minWidth:130 }}>
                <div style={{ fontSize:24, marginBottom:4 }}>{m.avatar}</div>
                <div style={{ fontSize:13, color:m.color, fontWeight:700 }}>{m.name}</div>
                <div style={{ fontSize:16, fontWeight:800, color:"#f1f5f9" }}>{fmt(m.amount,settings.currency)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Setup Banner ─────────────────────────────────────────────────────────────
function SetupBanner({ onSave }) {
  const [url, setUrl] = useState("");
  return (
    <div style={{ padding:24, maxWidth:540, margin:"60px auto" }}>
      <div style={{ fontSize:40, marginBottom:12, textAlign:"center" }}>🔧</div>
      <h2 style={{ textAlign:"center", color:"#f1f5f9", marginBottom:8, fontFamily:"Georgia,serif" }}>
        One-time Setup
      </h2>
      <p style={{ color:"#64748b", fontSize:14, lineHeight:1.7, marginBottom:20, textAlign:"center" }}>
        Paste your Google Apps Script Web App URL below.<br/>
        This connects the app to your Google Sheet for permanent, shared storage.
      </p>
      <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:20, marginBottom:20 }}>
        <div style={S.sectionLabel}>How to get your URL:</div>
        {[
          "Open Google Sheets → Extensions → Apps Script",
          "Paste the Code.gs contents into the editor",
          "Click Deploy → New Deployment → Web App",
          "Set 'Who has access' to Anyone",
          "Copy the Web App URL and paste it below",
        ].map((step,i)=>(
          <div key={i} style={{ display:"flex", gap:10, marginBottom:8, fontSize:13, color:"#94a3b8" }}>
            <span style={{ color:"#6366f1", fontWeight:700, minWidth:20 }}>{i+1}.</span>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <input style={S.input} value={url} onChange={e=>setUrl(e.target.value)}
             placeholder="https://script.google.com/macros/s/..." />
      <button onClick={()=>url.trim()&&onSave(url.trim())}
              style={{ ...S.primaryBtn, width:"100%", padding:"12px", fontSize:15 }}>
        Connect Google Sheet →
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { toasts, push } = useToast();

  const [scriptUrl, setScriptUrl] = useState(
    () => localStorage.getItem("fet_script_url") || (SCRIPT_URL !== "YOUR_APPS_SCRIPT_WEB_APP_URL_HERE" ? SCRIPT_URL : "")
  );

  const [expenses, setExpenses] = useState([]);
  const [members,  setMembers]  = useState([]);
  const [settings, setSettings] = useState({ currency:"CAD", householdName:"Our Family" });

  const [loading, setLoading]   = useState(false);
  const [saving,  setSaving]    = useState(false);

  const [showAdd,      setShowAdd]      = useState(false);
  const [editExpense,  setEditExpense]  = useState(null);
  const [showMembers,  setShowMembers]  = useState(false);
  const [showSummary,  setShowSummary]  = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deleteId,     setDeleteId]     = useState(null);

  const [search,      setSearch]      = useState("");
  const [filterCat,   setFilterCat]   = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");

  // Build api with current script URL
  const call = useCallback(async (method, action, payload) => {
    const base = scriptUrl;
    if (!base) throw new Error("No script URL configured");

    const url = payload
      ? `${base}?action=${action}&payload=${encodeURIComponent(JSON.stringify(payload))}`
      : `${base}?action=${action}`;

    const res  = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed");
    return json.data;
  }, [scriptUrl]);

  async function loadAll() {
    if (!scriptUrl) return;
    setLoading(true);
    try {
      const [exp, mem, set_] = await Promise.all([
        call("GET","getExpenses"),
        call("GET","getMembers"),
        call("GET","getSettings"),
      ]);
      setExpenses(exp || []);
      setMembers(mem  || []);
      setSettings(s=>({ ...s, ...(set_||{}) }));
    } catch (e) {
      push("Could not load data: "+e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [scriptUrl]);

  function handleSetupUrl(url) {
    localStorage.setItem("fet_script_url", url);
    setScriptUrl(url);
  }

  async function handleSaveExpense(exp) {
    setSaving(true);
    try {
      const isEdit = expenses.some(e=>e.id===exp.id);
      await call("POST", isEdit?"updateExpense":"addExpense", isEdit?{data:exp}:{data:exp});
      setExpenses(prev=>{
        const idx=prev.findIndex(e=>e.id===exp.id);
        if(idx>=0){const n=[...prev];n[idx]=exp;return n;}
        return [exp,...prev];
      });
      push(isEdit?"Expense updated":"Expense added");
      setShowAdd(false); setEditExpense(null);
    } catch(e) { push(e.message,"error"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    setSaving(true);
    try {
      await call("POST","deleteExpense",{id});
      setExpenses(p=>p.filter(e=>e.id!==id));
      push("Expense deleted");
      setDeleteId(null);
    } catch(e) { push(e.message,"error"); }
    finally { setSaving(false); }
  }

  async function handleSaveMembers(mem) {
    setSaving(true);
    try {
      await call("POST","saveMembers",{data:mem});
      setMembers(mem);
      push("Members saved");
      setShowMembers(false);
    } catch(e) { push(e.message,"error"); }
    finally { setSaving(false); }
  }

  async function handleSaveSettings(s) {
    setSaving(true);
    try {
      await call("POST","saveSettings",{data:s});
      setSettings(s);
      push("Settings saved");
    } catch(e) { push(e.message,"error"); }
    finally { setSaving(false); }
  }

  if (!scriptUrl) return <SetupBanner onSave={handleSetupUrl} />;

  const now = new Date();

  const filtered = expenses.filter(e=>{
    const ms = !search || e.merchant.toLowerCase().includes(search.toLowerCase()) ||
               (e.notes||"").toLowerCase().includes(search.toLowerCase());
    const mc = filterCat==="all" || e.category===filterCat;
    const mm = filterMonth==="all" || new Date(e.date).getMonth()===parseInt(filterMonth);
    return ms && mc && mm;
  }).sort((a,b)=>new Date(b.date)-new Date(a.date));

  const thisMonthTotal = expenses
    .filter(e=>new Date(e.date).getMonth()===now.getMonth()&&new Date(e.date).getFullYear()===now.getFullYear())
    .reduce((s,e)=>s+e.total,0);

  return (
    <div style={S.app}>
      <Toast toasts={toasts} />

      {/* Header */}
      <header style={S.header}>
        <div>
          <div style={S.logo}>🏡 {settings.householdName}</div>
          <div style={{ fontSize:11, color:"#4a5568", letterSpacing:1, textTransform:"uppercase" }}>
            {loading ? "Syncing with Google Sheets…" : "Expense Tracker"}
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={loadAll} style={S.iconBtn} title="Refresh">🔄</button>
          <button onClick={()=>setShowSummary(true)} style={S.iconBtn} title="Summary">📊</button>
          <button onClick={()=>setShowMembers(true)} style={S.iconBtn} title="Members">👨‍👩‍👧‍👦</button>
          <button onClick={()=>setShowSettings(true)} style={S.iconBtn} title="Settings">⚙️</button>
        </div>
      </header>

      {/* Stats */}
      <div style={S.statsBar}>
        {[
          { label:`${MONTHS[now.getMonth()]}`, value:fmt(thisMonthTotal,settings.currency), icon:"📅" },
          { label:"All Time", value:fmt(expenses.reduce((s,e)=>s+e.total,0),settings.currency), icon:"💰" },
          { label:"Records", value:expenses.length, icon:"🧾" },
          { label:"Members", value:members.length, icon:"👥" },
        ].map(s=>(
          <div key={s.label} style={S.statCard}>
            <div style={{ fontSize:18 }}>{s.icon}</div>
            <div style={{ fontSize:10, color:"#64748b", marginBottom:2, textTransform:"uppercase", letterSpacing:0.5 }}>{s.label}</div>
            <div style={{ fontSize:14, fontWeight:800, color:"#e2e8f0" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ padding:"0 16px 12px" }}>
        <input style={{ ...S.input, marginBottom:8 }}
               placeholder="🔍 Search expenses…" value={search}
               onChange={e=>setSearch(e.target.value)} />
        <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4 }}>
          <button onClick={()=>setFilterCat("all")} style={{ ...S.chip, ...(filterCat==="all"?S.chipActive:{}) }}>All</button>
          {CATEGORIES.map(c=>(
            <button key={c.id} onClick={()=>setFilterCat(filterCat===c.id?"all":c.id)}
                    style={{ ...S.chip, ...(filterCat===c.id?{...S.chipActive,borderColor:c.color,color:c.color}:{}) }}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:6, overflowX:"auto", paddingTop:6 }}>
          <button onClick={()=>setFilterMonth("all")} style={{ ...S.chip, ...(filterMonth==="all"?S.chipActive:{}) }}>All Months</button>
          {MONTHS.map((m,i)=>(
            <button key={i} onClick={()=>setFilterMonth(filterMonth===String(i)?"all":String(i))}
                    style={{ ...S.chip, ...(filterMonth===String(i)?S.chipActive:{}) }}>{m}</button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ padding:"0 16px", flex:1, overflowY:"auto" }}>
        {loading && expenses.length===0 ? (
          <div style={{ textAlign:"center", padding:60, color:"#475569" }}>
            <div style={{ fontSize:40 }}>⏳</div>
            <div style={{ marginTop:12, fontSize:15 }}>Loading from Google Sheets…</div>
          </div>
        ) : filtered.length===0 ? (
          <div style={{ textAlign:"center", padding:60, color:"#475569" }}>
            <div style={{ fontSize:48 }}>🧾</div>
            <div style={{ fontSize:16, fontWeight:600, color:"#64748b", marginTop:12 }}>No expenses found</div>
            <div style={{ fontSize:13, marginTop:6 }}>Tap + to add your first expense</div>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:"#64748b", marginBottom:10 }}>
              <span>{filtered.length} expense{filtered.length!==1?"s":""}</span>
              <span style={{ fontWeight:700, color:"#e2e8f0" }}>
                {fmt(filtered.reduce((s,e)=>s+e.total,0),settings.currency)}
              </span>
            </div>
            {filtered.map(e=>{
              const cat = CATEGORIES.find(c=>c.id===e.category)||CATEGORIES[11];
              return (
                <div key={e.id} style={S.expRow}>
                  <div style={{ ...S.catIcon, background:cat.color+"22", border:`1px solid ${cat.color}44` }}>
                    {cat.icon}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, color:"#f1f5f9", fontSize:15,
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      {e.merchant}
                    </div>
                    <div style={{ fontSize:12, color:"#64748b", marginTop:2, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                      <span>{fmtDate(e.date)}</span>
                      <span style={{ background:cat.color+"22", color:cat.color,
                        border:`1px solid ${cat.color}44`, borderRadius:20,
                        padding:"1px 8px", fontSize:11, fontWeight:600 }}>{cat.label}</span>
                      {e.splits.length>0 &&
                        <span style={{ background:"#312e8144", color:"#a5b4fc",
                          border:"1px solid #312e81", borderRadius:20, padding:"1px 8px", fontSize:11 }}>
                          Split ÷{e.splits.length}
                        </span>}
                    </div>
                    {e.notes && (
                      <div style={{ fontSize:11, color:"#475569", marginTop:2,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.notes}</div>
                    )}
                    {e.splits.length>0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:5 }}>
                        {e.splits.map(sp=>{
                          const m=members.find(x=>x.id===sp.memberId);
                          if(!m) return null;
                          return (
                            <span key={sp.memberId} style={{ fontSize:11, background:m.color+"22",
                              color:m.color, borderRadius:10, padding:"2px 7px" }}>
                              {m.avatar} {m.name}: {fmt(sp.amount,settings.currency)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right", minWidth:90 }}>
                    <div style={{ fontWeight:800, color:"#f8fafc", fontSize:16 }}>
                      {fmt(e.total,settings.currency)}
                    </div>
                    <div style={{ display:"flex", gap:4, justifyContent:"flex-end", marginTop:6 }}>
                      <button onClick={()=>setEditExpense(e)} style={S.tinyBtn}>✏️</button>
                      <button onClick={()=>setDeleteId(e.id)} style={S.tinyBtn}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* FAB */}
      <button onClick={()=>setShowAdd(true)} style={S.fab}>＋</button>

      {/* Modals */}
      <Modal open={showAdd} onClose={()=>setShowAdd(false)} title="Add Expense" wide>
        <ExpenseForm members={members} settings={settings}
          onSave={handleSaveExpense} onClose={()=>setShowAdd(false)} saving={saving} />
      </Modal>

      <Modal open={!!editExpense} onClose={()=>setEditExpense(null)} title="Edit Expense" wide>
        {editExpense && <ExpenseForm expense={editExpense} members={members} settings={settings}
          onSave={handleSaveExpense} onClose={()=>setEditExpense(null)} saving={saving} />}
      </Modal>

      <Modal open={showMembers} onClose={()=>setShowMembers(false)} title="Family Members" wide>
        <MembersPanel members={members} onSave={handleSaveMembers} saving={saving} />
      </Modal>

      <Modal open={showSummary} onClose={()=>setShowSummary(false)} title="Monthly Summary" wide>
        <SummaryPanel expenses={expenses} members={members} settings={settings} />
      </Modal>

      <Modal open={showSettings} onClose={()=>setShowSettings(false)} title="Settings">
        <div>
          <label style={S.label}>Household Name</label>
          <input style={S.input} value={settings.householdName}
                 onChange={e=>setSettings(s=>({...s,householdName:e.target.value}))} />
          <label style={S.label}>Currency</label>
          <select style={S.input} value={settings.currency}
                  onChange={e=>setSettings(s=>({...s,currency:e.target.value}))}>
            {["CAD","USD","EUR","GBP","SGD","AUD","PHP","JPY","MYR","IDR","THB"]
              .map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={()=>handleSaveSettings(settings)} style={S.primaryBtn} disabled={saving}>
            {saving?"Saving…":"💾 Save Settings"}
          </button>
          <div style={{ marginTop:16, padding:12, background:"#0f172a",
            border:"1px solid #1e293b", borderRadius:8, fontSize:12, color:"#64748b" }}>
            <strong style={{ color:"#94a3b8" }}>🔗 Connected Sheet</strong><br/>
            <span style={{ wordBreak:"break-all", color:"#475569" }}>{scriptUrl}</span><br/>
            <button onClick={()=>{ localStorage.removeItem("fet_script_url"); setScriptUrl(""); }}
                    style={{ marginTop:8, color:"#f87171", background:"none",
                      border:"1px solid #f8717144", borderRadius:6, padding:"4px 10px",
                      cursor:"pointer", fontSize:12 }}>
              🔌 Disconnect / Change URL
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteId} onClose={()=>setDeleteId(null)} title="Delete Expense">
        <p style={{ color:"#94a3b8", marginBottom:20 }}>
          Delete this expense permanently from Google Sheets?
        </p>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={()=>setDeleteId(null)} style={S.cancelBtn}>Cancel</button>
          <button onClick={()=>handleDelete(deleteId)}
                  style={{ ...S.primaryBtn, background:"#ef4444" }} disabled={saving}>
            {saving?"Deleting…":"Delete"}
          </button>
        </div>
      </Modal>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #0a0f1a; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: #6366f1 !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        @media print {
          button, header, .no-print { display: none !important; }
          body { background: white; color: black; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  app: {
    minHeight:"100vh", background:"#0a0f1a",
    fontFamily:"'DM Sans','Segoe UI',sans-serif",
    color:"#e2e8f0", display:"flex", flexDirection:"column",
    maxWidth:820, margin:"0 auto"
  },
  header: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"16px 20px 12px",
    background:"linear-gradient(135deg,#0f172a 0%,#1a1040 100%)",
    borderBottom:"1px solid #1e293b"
  },
  logo: { fontSize:20, fontWeight:800, color:"#f1f5f9", letterSpacing:-0.5, fontFamily:"Georgia,serif" },
  statsBar: {
    display:"grid", gridTemplateColumns:"repeat(4,1fr)",
    gap:8, padding:"12px 16px", borderBottom:"1px solid #1e293b"
  },
  statCard: {
    background:"#0f172a", border:"1px solid #1e293b", borderRadius:10,
    padding:"10px 8px", textAlign:"center"
  },
  input: {
    width:"100%", background:"#0f172a", border:"1px solid #334155",
    borderRadius:8, color:"#e2e8f0", padding:"10px 12px",
    fontSize:14, fontFamily:"inherit", outline:"none",
    boxSizing:"border-box", marginBottom:12
  },
  label: { display:"block", fontSize:11, fontWeight:700, color:"#64748b",
    marginBottom:5, textTransform:"uppercase", letterSpacing:0.6 },
  sectionLabel: { fontSize:11, fontWeight:700, color:"#64748b",
    textTransform:"uppercase", letterSpacing:1, marginBottom:10 },
  row: { display:"flex", gap:12 },
  card: { background:"#0f172a", border:"1px solid #1e293b", borderRadius:10, padding:14 },
  overlay: {
    position:"fixed", inset:0, background:"rgba(0,0,0,0.8)",
    backdropFilter:"blur(6px)", display:"flex",
    alignItems:"flex-end", justifyContent:"center", zIndex:100
  },
  modal: {
    background:"#111827", border:"1px solid #1e293b",
    borderRadius:"20px 20px 0 0", width:"100%", maxWidth:560,
    maxHeight:"92vh", overflow:"hidden", display:"flex", flexDirection:"column"
  },
  modalHeader: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"16px 20px", borderBottom:"1px solid #1e293b"
  },
  modalTitle: { fontSize:17, fontWeight:800, color:"#f1f5f9", fontFamily:"Georgia,serif" },
  modalBody: { padding:20, overflowY:"auto", flex:1 },
  closeBtn: { background:"#1e293b", border:"none", color:"#94a3b8",
    width:32, height:32, borderRadius:"50%", cursor:"pointer", fontSize:15 },
  fab: {
    position:"fixed", bottom:24, right:24, width:58, height:58,
    borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
    border:"none", color:"white", fontSize:30, cursor:"pointer",
    boxShadow:"0 8px 28px rgba(99,102,241,0.55)",
    display:"flex", alignItems:"center", justifyContent:"center", zIndex:50
  },
  expRow: {
    display:"flex", alignItems:"flex-start", gap:12,
    padding:"14px 0", borderBottom:"1px solid #111827"
  },
  catIcon: { width:42, height:42, borderRadius:12, display:"flex",
    alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 },
  chip: {
    background:"transparent", border:"1px solid #1e293b", borderRadius:20,
    color:"#64748b", padding:"5px 12px", cursor:"pointer",
    fontSize:12, fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0
  },
  chipActive: { background:"#1e293b", color:"#e2e8f0", borderColor:"#6366f1" },
  primaryBtn: {
    background:"linear-gradient(135deg,#6366f1,#8b5cf6)", border:"none",
    borderRadius:8, color:"white", padding:"10px 20px",
    cursor:"pointer", fontWeight:700, fontSize:14, fontFamily:"inherit"
  },
  cancelBtn: {
    background:"#1e293b", border:"1px solid #334155", borderRadius:8,
    color:"#94a3b8", padding:"10px 16px", cursor:"pointer",
    fontSize:14, fontFamily:"inherit"
  },
  smBtn: {
    background:"#1e293b", border:"1px solid #334155", borderRadius:6,
    color:"#94a3b8", padding:"5px 10px", cursor:"pointer",
    fontSize:12, fontFamily:"inherit"
  },
  tinyBtn: { background:"none", border:"none", cursor:"pointer", fontSize:15, padding:"2px 4px" },
  iconBtn: { background:"#1e293b", border:"1px solid #1e293b", borderRadius:8,
    color:"#94a3b8", width:36, height:36, cursor:"pointer", fontSize:16 },
  scanBtn: {
    display:"inline-flex", alignItems:"center", justifyContent:"center",
    gap:8, padding:"10px 16px", background:"#1e293b",
    border:"1px dashed #334155", borderRadius:8, color:"#94a3b8",
    cursor:"pointer", fontSize:14, fontFamily:"inherit", width:"100%"
  },
};
