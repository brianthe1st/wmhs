import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Btn, Notice, Textarea, fmtDate } from './UI';

// Loads data, exposes reload(). Optional polling (ms) that pauses while the tab is hidden.
export function useData(fetcher, deps = [], pollMs = 0) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const ref = useRef(fetcher);
  useEffect(() => { ref.current = fetcher; }, [fetcher]);

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    return ref.current()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload, ...deps]);

  useEffect(() => {
    if (!pollMs) return undefined;
    const t = setInterval(() => { if (!document.hidden) reload(true); }, pollMs);
    return () => clearInterval(t);
  }, [pollMs, reload]);

  return { data, loading, error, reload, setData };
}

export function copyText(text) {
  try { if (navigator.clipboard) return navigator.clipboard.writeText(text); } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return Promise.resolve();
}

export function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <Btn size="sm" variant="secondary" onClick={() => { copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? 'Copied ✓' : label}
    </Btn>
  );
}

// Shows a one-time password. The admin must hand it over; it is never shown again.
export function TempPasswordModal({ who, password, onClose }) {
  return (
    <Modal title="Temporary password" onClose={onClose} width={440}>
      <Notice tone="warn">Shown only once. Give it to <b>{who}</b> in person. They will be asked to choose their own password the first time they sign in.</Notice>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'#f0f7ff',
        border:'1px dashed #185fa5', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
        <code style={{ fontSize:24, fontWeight:700, letterSpacing:'2px', color:'#0c447c', wordBreak:'break-all' }}>{password}</code>
        <CopyBtn text={password}/>
      </div>
      <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
    </Modal>
  );
}

const roleColor = { admin:'#fcebeb', teacher:'#e1f5ee', student:'#eeedfe' };

// Thread of replies + a box to add one. replies: [{id, body, created_at, author_name, author_role}]
export function ReplyThread({ replies = [], onSend, placeholder = 'Write a reply…' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try { await onSend(text.trim()); setText(''); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop:10, borderTop:'0.5px solid #e2e8f0', paddingTop:10 }}>
      {replies.map(r => (
        <div key={r.id} style={{ background: roleColor[r.author_role] || '#f8fafc', borderRadius:8, padding:'8px 12px', marginBottom:6 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#334155' }}>
            {r.author_name || r.student_name}{r.author_role && r.author_role !== 'student' ? ` · ${r.author_role}` : ''}
            <span style={{ fontWeight:400, color:'#94a3b8', marginLeft:8 }}>{fmtDate(r.created_at)}</span>
          </div>
          <div style={{ fontSize:13, color:'#1e293b', marginTop:2, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{r.body}</div>
        </div>
      ))}
      {err && <div style={{ fontSize:12, color:'#791f1f', marginBottom:6 }}>{err}</div>}
      <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={2} maxLength={1000}/>
      <Btn size="sm" onClick={send} loading={busy} disabled={!text.trim()}>Reply</Btn>
    </div>
  );
}

// Small modal to edit a single block of text (announcements).
export function EditTextModal({ title, initial, max = 5000, onSave, onClose }) {
  const [text, setText] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!text.trim()) return setErr('Cannot be empty.');
    setBusy(true); setErr('');
    try { await onSave(text.trim()); onClose(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      {err && <Notice tone="warn">{err}</Notice>}
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={6} maxLength={max}/>
      <Btn onClick={save} loading={busy} style={{ width:'100%' }}>Save changes</Btn>
    </Modal>
  );
}

// Year picker for teachers: "" = current year, "all", or a specific academic year id.
export function YearSelect({ value, onChange, label = 'Academic year' }) {
  const [years, setYears] = useState([]);
  useEffect(() => {
    let live = true;
    import('../../utils/api').then(({ api }) => api.meta.years().then(d => { if (live) setYears(d.years || []); }).catch(() => {}));
    return () => { live = false; };
  }, []);
  const cur = years.find(y => y.is_current);
  const opts = [
    { value: '', label: cur ? `Current year (${cur.name})` : 'Current year' },
    ...years.filter(y => !y.is_current).map(y => ({ value: y.id, label: y.name })),
    { value: 'all', label: 'All years' },
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:5, textTransform:'uppercase', letterSpacing:'.4px' }}>{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width:'100%', padding:'9px 12px', borderRadius:8, fontSize:14, border:'1.5px solid #e2e8f0', background:'#fff' }}>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
