import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { useTime } from '../../context/TimeContext';
// import { motion } from 'framer-motion';
import {
  Page, Card, Btn, Badge, Modal, SectionHeader, Empty,
  ErrorMsg, Spinner, ScoreChip, TagChip, FileIcon, Linkify
} from '../shared/UI';

function useData(fetcher, deps=[]) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    return fetcherRef.current()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload, ...deps]);

  return { data, loading, error, reload };
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
export function StudentDashboard({ setActivePage }) {
  const { currentUser } = useAuth();
  const { now, toKigali } = useTime();
  const { updateUnseen, showToast, getSeenIds, markMultipleAsSeen } = useNotifications();
  const { data: wiData,  loading, reload: reloadWI } = useData(api.student.getWorkItems);
  const { data: subData, reload: reloadSubs } = useData(api.student.getSubmissions);
  const { data: annData, reload: reloadAnns } = useData(api.student.getAnnouncements);
  const { data: resData, reload: reloadRes } = useData(api.student.getResults);
  const { data: matData, reload: reloadMats } = useData(api.student.getMaterials);

  const workItems = useMemo(() => wiData?.workItems      || [], [wiData]);
  const subs      = useMemo(() => subData?.submissions   || [], [subData]);
  const anns      = useMemo(() => annData?.announcements || [], [annData]);
  const results   = useMemo(() => resData?.results       || [], [resData]);
  const mats      = useMemo(() => matData?.materials     || [], [matData]);

  // SMART POLLING: Check for updates every 10 seconds while on dashboard
  useEffect(() => {
    const timer = setInterval(() => {
      reloadWI(true);
      reloadAnns(true);
      reloadRes(true);
      reloadMats(true);
      reloadSubs(true);
    }, 10000); // 10 seconds
    return () => clearInterval(timer);
  }, [reloadWI, reloadAnns, reloadRes, reloadMats, reloadSubs]);

  // Update unseen counts globally
  useEffect(() => {
    if (annData) updateUnseen('announcements', anns);
    if (wiData)  updateUnseen('mywork', workItems.filter(wi => !subs.some(s=>s.work_item_id===wi.id)));
    if (resData) updateUnseen('results', results.filter(r => r.score !== null).map(r => ({ id: `result-${r.id}` })));
    if (matData) updateUnseen('materials', mats.map(m => ({ id: `mat-${m.id}` })));
  }, [annData, wiData, subData, resData, matData, updateUnseen, anns, workItems, subs, results, mats]);

  // Trigger Toast for genuinely new items
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (loading) return;
    const seenIds = getSeenIds();

    const newAnns = anns.filter(a => !seenIds.includes(a.id));
    const newWork = workItems.filter(w => !seenIds.includes(w.id));
    const newMats = mats.filter(m => !seenIds.includes(`mat-${m.id}`));

    // Show toast for genuinely new items (first time this browser sees them)
    if (newAnns.length > 0) {
      showToast(`New Announcement: ${newAnns[0].body.slice(0, 40)}...`, 'announcement');
    } else if (newWork.length > 0) {
      showToast(`New Assignment: ${newWork[0].title}`, 'assignment');
    } else if (newMats.length > 0) {
      showToast(`New Material: ${newMats[0].title}`, 'info');
    }

    // Mark all as seen so they don't toast again on reload/polling
    // This also clears the "New" badges once they've been "seen" on the dashboard
    if (newAnns.length || newWork.length || newMats.length) {
      markMultipleAsSeen([
        ...newAnns.map(a => a.id),
        ...newWork.map(w => w.id),
        ...newMats.map(m => `mat-${m.id}`)
      ]);
    }

    initialLoadDone.current = true;
  }, [loading, anns, workItems, mats, getSeenIds, showToast, markMultipleAsSeen]);

  const allPending = workItems.filter(wi => !subs.some(s=>s.work_item_id===wi.id));
  const pending    = allPending.filter(wi => !wi.deadline || new Date(wi.deadline) >= now());
  const missed     = allPending.filter(wi => wi.deadline && new Date(wi.deadline) < now());
  const submitted  = workItems.filter(wi =>  subs.some(s=>s.work_item_id===wi.id));

  return (
    <Page>
      <SectionHeader title={`Hello, ${currentUser.name.split(' ')[0]}`} subtitle="Your school portal" />
      {loading ? <Spinner /> : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:14, marginBottom:28 }}>
            <div style={{ background:'#faeeda', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:12, color:'#475569', marginBottom:4, fontWeight:500 }}>Pending Work</div>
              <div style={{ fontSize:26, fontWeight:700, color:'#633806' }}>{pending.length}</div>
            </div>
            <div style={{ background:'#fcebeb', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:12, color:'#475569', marginBottom:4, fontWeight:500 }}>Missed</div>
              <div style={{ fontSize:26, fontWeight:700, color:'#791f1f' }}>{missed.length}</div>
            </div>
            <div style={{ background:'#eaf3de', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:12, color:'#475569', marginBottom:4, fontWeight:500 }}>Submitted</div>
              <div style={{ fontSize:26, fontWeight:700, color:'#27500a' }}>{submitted.length}</div>
            </div>
            <div style={{ background:'#e6f1fb', borderRadius:10, padding:'14px 18px' }}>
              <div style={{ fontSize:12, color:'#475569', marginBottom:4, fontWeight:500 }}>Announcements</div>
              <div style={{ fontSize:26, fontWeight:700, color:'#0c447c' }}>{anns.length}</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:20 }}>
            <Card>
              <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', marginBottom:14 }}>Pending Work</h3>
              {pending.length===0
                ? <div style={{ textAlign:'center', padding:20, color:'#64748b', fontSize:13 }}>🎉 All work done!</div>
                : <>
                    {pending.slice(0,5).map(wi=>(
                      <div key={wi.id} style={{ padding:'9px 0', borderBottom:'0.5px solid #f1f5f9', position:'relative' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ fontSize:13, fontWeight:500, color:'#0f172a' }}>{wi.title}</div>
                              {!getSeenIds().includes(wi.id) && (
                                <span style={{ background:'#ef4444', color:'#fff', fontSize:9, fontWeight:800, padding:'2px 5px', borderRadius:4, textTransform:'uppercase' }}>New</span>
                              )}
                            </div>
                            <div style={{ fontSize:12, color:'#94a3b8' }}>{wi.deadline?`Due ${toKigali(wi.deadline)}`:'No deadline'}</div>
                          </div>
                          <Badge color={wi.type==='quiz'?'purple':'blue'}>{wi.type}</Badge>
                        </div>
                      </div>
                    ))}
                    <Btn size="sm" variant="secondary" style={{ width:'100%', marginTop:10 }} onClick={()=>setActivePage('mywork')}>View All →</Btn>
                  </>
              }
            </Card>
            <Card>
              <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', marginBottom:14 }}>Latest Announcements</h3>
              {anns.length===0 ? <Empty message="No announcements." /> : (
                anns.slice(0,3).map(ann=>(
                  <div key={ann.id} style={{ padding:'9px 0', borderBottom:'0.5px solid #f1f5f9' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                      <Badge color={ann.poster_role==='admin' ? 'red' : 'green'}>
                        {ann.poster_role==='admin' ? '🏫 Admin' : `📚 ${ann.module_name||'Teacher'}`}
                      </Badge>
                      {!getSeenIds().includes(ann.id) && (
                        <span style={{ background:'#ef4444', color:'#fff', fontSize:9, fontWeight:800, padding:'2px 5px', borderRadius:4, textTransform:'uppercase' }}>New</span>
                      )}
                      <div style={{ fontSize:11, color:'#94a3b8' }}>{toKigali(ann.created_at)}</div>
                    </div>
                    <p style={{ fontSize:13, color:'#334155', margin:0, lineHeight:1.5,
                      display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                      <Linkify text={ann.body} />
                    </p>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

// ── COUNTDOWN COMPONENT ────────────────────────────────────────────────────────
function Countdown({ workItem }) {
  const { serverTime, now } = useTime();
  if (!serverTime) return null;

  const getStatus = () => {
    const sNow = now();
    const opens = workItem.open_at ? new Date(workItem.open_at) : null;
    const closes = workItem.close_at ? new Date(workItem.close_at) : null;

    if (opens && opens > sNow) {
      return { label: 'Opens in:', target: opens, color: '#ba7517' };
    }
    if (closes && closes > sNow) {
      return { label: 'Closes in:', target: closes, color: '#a32d2d' };
    }
    return null;
  };

  const status = getStatus();
  if (!status) return null;

  const diff = status.target.getTime() - now().getTime();
  if (diff <= 0) return null;

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return (
    <div style={{ fontSize:12, fontWeight:700, color:status.color, marginTop:6, display:'flex', gap:6, alignItems:'center' }}>
      <span>{status.label}</span>
      <span style={{ fontFamily:'monospace', background:'#fff', padding:'2px 6px', borderRadius:4, border:`1px solid ${status.color}` }}>
        {h.toString().padStart(2,'0')}:{m.toString().padStart(2,'0')}:{s.toString().padStart(2,'0')}
      </span>
    </div>
  );
}

// ── MY WORK ────────────────────────────────────────────────────────────────────
export function StudentMyWork() {
  const { markMultipleAsSeen } = useNotifications();
  const { now, toKigali } = useTime();
  const { data: wiData,  loading }  = useData(api.student.getWorkItems);
  const { data: subData, reload: reloadSubs } = useData(api.student.getSubmissions);
  const [doWork,   setDoWork]       = useState(null);
  const [filter,   setFilter]       = useState('all');

  const workItems = useMemo(() => wiData?.workItems    || [], [wiData]);
  const subs      = useMemo(() => subData?.submissions || [], [subData]);

  useEffect(() => {
    if (wiData) {
      markMultipleAsSeen(workItems.map(wi => wi.id));
    }
  }, [wiData, workItems, markMultipleAsSeen]);

  const getSub = (wiId) => subs.find(s=>s.work_item_id===wiId);

  const isAvailable = (wi) => {
    const serverNow = now();
    if (wi.open_at  && new Date(wi.open_at)  > serverNow) return false;
    if (wi.close_at && new Date(wi.close_at) < serverNow) return false;
    return true;
  };
  const isPast = (wi) => wi.deadline && new Date(wi.deadline) < now();

  const filtered = workItems.filter(wi=>{
    const sub  = getSub(wi.id);
    const past = isPast(wi);
    if (filter==='pending')   return !sub && !past;
    if (filter==='missed')    return !sub && past;
    if (filter==='submitted') return !!sub;
    return true;
  }).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));

  return (
    <Page>
      <ErrorMsg message={wiData?.error || subData?.error} />
      <SectionHeader title="My Work" subtitle="Assignments and quizzes from all your modules" />
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {['all','pending','missed','submitted'].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            style={{ padding:'6px 14px', border:'none', borderRadius:20, cursor:'pointer', fontSize:13,
              background:filter===f?'#185fa5':'#f1f5f9', color:filter===f?'#fff':'#475569', fontWeight:filter===f?600:400 }}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>
      {loading ? <Spinner /> : filtered.length===0 ? <Empty message="No work items." /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(wi=>{
            const sub       = getSub(wi.id);
            const available = isAvailable(wi);
            const past      = isPast(wi);
            return (
              <Card key={wi.id} padding="14px 18px">
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:6, marginBottom:6, flexWrap:'wrap' }}>
                      <Badge color={wi.type==='quiz'?'purple':'blue'}>{wi.type==='quiz'?'📝 Quiz':'📋 Assignment'}</Badge>
                      <Badge color="teal">{wi.module_name}</Badge>
                      {sub ? <Badge color="green">✓ Submitted</Badge>
                        : past      ? <Badge color="red">Past deadline</Badge>
                        : !available? <Badge color="amber">Not open yet</Badge>
                        : <Badge color="amber">Pending</Badge>}
                    </div>
                    <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', margin:'0 0 4px' }}>{wi.title}</h3>
                    <p style={{ fontSize:12, color:'#64748b', margin:0 }}>
                      {wi.deadline?`Due: ${toKigali(wi.deadline)}`:'No deadline'}
                      {wi.open_at && ` · Opens: ${toKigali(wi.open_at)}`}
                      {wi.close_at && ` · Closes: ${toKigali(wi.close_at)}`}
                    </p>
                    {!sub && (wi.open_at || wi.close_at) && (
                      <Countdown workItem={wi} />
                    )}
                    {sub && (
                      <div style={{ marginTop:8, display:'flex', gap:8, alignItems:'center' }}>
                        <ScoreChip score={sub.score} maxScore={sub.max_score} />
                        <TagChip tag={sub.tag} />
                      </div>
                    )}
                  </div>
                  {!sub && available && (
                    <Btn onClick={()=>setDoWork(wi)} variant={past?'danger':'primary'}>
                      {past ? (wi.type==='quiz'?'Start Late Quiz':'Submit Late')
                            : (wi.type==='quiz'?'Start Quiz':'Submit Work')}
                    </Btn>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {doWork && doWork.type==='quiz'
        ? <QuizModal workItem={doWork} onClose={()=>{setDoWork(null);reloadSubs();}} />
        : doWork
        ? <AssignmentModal workItem={doWork} onClose={()=>{setDoWork(null);reloadSubs();}} />
        : null
      }
    </Page>
  );
}

// ── ASSIGNMENT MODAL ───────────────────────────────────────────────────────────
function AssignmentModal({ workItem, onClose }) {
  const [content, setContent] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [done,    setDone]    = useState(false);
  const [err,     setErr]     = useState('');
  const [saving,  setSaving]  = useState(false);

  const handleConfirm = async () => {
    setSaving(true); setErr('');
    try {
      await api.student.submit({ workItemId: workItem.id, content });
      setConfirm(false); setDone(true);
    } catch(e) { setErr(e.message); setConfirm(false); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={workItem.title} onClose={done?onClose:undefined} width={580}>
      {done ? (
        <div style={{ textAlign:'center', padding:'30px 20px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
          <h3 style={{ fontSize:17, fontWeight:600, color:'#085041', marginBottom:6 }}>Submitted Successfully</h3>
          <p style={{ fontSize:14, color:'#64748b' }}>Your work has been locked. The teacher will grade it soon.</p>
          <Btn onClick={onClose} style={{ marginTop:20 }}>Close</Btn>
        </div>
      ) : confirm ? (
        <div style={{ textAlign:'center', padding:20 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>⚠️</div>
          <h3 style={{ fontSize:16, fontWeight:600, color:'#0f172a', marginBottom:8 }}>Are you sure?</h3>
          <p style={{ fontSize:14, color:'#64748b', marginBottom:20 }}>
            Once submitted, you <strong>cannot</strong> go back or edit. It will be locked permanently.
          </p>
          <ErrorMsg message={err} />
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <Btn variant="secondary" onClick={()=>setConfirm(false)}>Go back</Btn>
            <Btn onClick={handleConfirm} loading={saving}>Yes, submit</Btn>
          </div>
        </div>
      ) : (
        <>
          <ErrorMsg message={err} />
          <div style={{ background:'#f8fafc', borderRadius:8, padding:12, marginBottom:16, fontSize:14, color:'#334155', lineHeight:1.6 }}>
            <Linkify text={workItem.instructions} />
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:5, textTransform:'uppercase' }}>Your Answer *</label>
            <textarea value={content} onChange={e=>setContent(e.target.value)} rows={8}
              placeholder="Write your answer here..."
              style={{ width:'100%', padding:'10px 12px', borderRadius:8, fontSize:14, border:'1.5px solid #e2e8f0', outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }}
              onFocus={e=>e.target.style.borderColor='#378add'}
              onBlur={e=>e.target.style.borderColor='#e2e8f0'}
            />
          </div>
          <Btn onClick={()=>{ if(!content.trim()){setErr('Please write your answer first.');return;} setErr(''); setConfirm(true); }} style={{ width:'100%' }}>
            Submit Assignment
          </Btn>
        </>
      )}
    </Modal>
  );
}

// ── QUIZ MODAL ─────────────────────────────────────────────────────────────────
function QuizModal({ workItem, onClose }) {
  const { now } = useTime();
  const [qs,       setQs]       = useState([]);
  const [answers,  setAnswers]  = useState({});
  const [confirm,  setConfirm]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [correct,  setCorrect]  = useState({});
  const [timeLeft, setTimeLeft] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err,      setErr]      = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    api.student.getQuestions(workItem.id)
      .then(d => { setQs(d.questions||[]); setLoading(false); })
      .catch(e => { setErr(e.message); setLoading(false); });
  }, [workItem.id]);

  // Countdown timer for close_at window using synced server time
  useEffect(() => {
    if (!workItem.close_at) return;
    
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(workItem.close_at) - now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        handleAutoSubmit();
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [qs, now]); // eslint-disable-line

  const handleAutoSubmit = async () => {
    clearInterval(timerRef.current);
    await doSubmit();
  };

  const doSubmit = async () => {
    setSubmitting(true); setErr('');
    try {
      const res = await api.student.submit({ workItemId: workItem.id, content: JSON.stringify(answers) });
      setResult(res.submission);
      setCorrect(res.correctAnswers || {});
    } catch(e) { setErr(e.message); }
    finally { setSubmitting(false); }
  };

  const fmtTime = s => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  if (loading) return <Modal title={workItem.title}><Spinner/></Modal>;

  return (
    <Modal title={workItem.title} width={600}>
      {result ? (
        <div style={{ textAlign:'center', padding:'20px 10px' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🎯</div>
          <h3 style={{ fontSize:18, fontWeight:700, color:'#0c447c', marginBottom:4 }}>Quiz Complete!</h3>
          <div style={{ fontSize:36, fontWeight:800, color:'#185fa5', margin:'10px 0' }}>
            {result.score}/{result.max_score}
          </div>
          <p style={{ fontSize:14, color:'#64748b', marginBottom:16 }}>
            {Math.round((result.score/result.max_score)*100)}% —{' '}
            {result.score===result.max_score?'🏆 Perfect!':result.score>=result.max_score*0.7?'👍 Good job!':'📚 Keep studying!'}
          </p>
          <div style={{ textAlign:'left' }}>
            {qs.map((q,i)=>{
              const selected = answers[q.id];
              const isRight  = selected === correct[q.id];
              return (
                <div key={q.id} style={{ background:isRight?'#eaf3de':'#fcebeb', borderRadius:8, padding:12, marginBottom:8,
                  border:`0.5px solid ${isRight?'#c0dd97':'#f7c1c1'}` }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'#0f172a', marginBottom:4 }}>Q{i+1}: {q.question_text}</div>
                  <div style={{ fontSize:12, color:isRight?'#085041':'#791f1f' }}>
                    {isRight?'✓ Correct':`✗ You chose: ${q.options?.[selected]??'Not answered'}`}
                  </div>
                  {!isRight && <div style={{ fontSize:12, color:'#085041', marginTop:2 }}>Correct: {q.options?.[correct[q.id]]}</div>}
                </div>
              );
            })}
          </div>
          <Btn onClick={onClose} style={{ marginTop:16 }}>Close</Btn>
        </div>
      ) : confirm ? (
        <div style={{ textAlign:'center', padding:20 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>⚠️</div>
          <h3 style={{ fontSize:16, fontWeight:600, color:'#0f172a', marginBottom:8 }}>Submit Quiz?</h3>
          <p style={{ fontSize:14, color:'#64748b', marginBottom:20 }}>
            {Object.keys(answers).length}/{qs.length} questions answered. Locked permanently after submission.
          </p>
          <ErrorMsg message={err} />
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <Btn variant="secondary" onClick={()=>setConfirm(false)}>Go back</Btn>
            <Btn onClick={doSubmit} loading={submitting}>Yes, submit</Btn>
          </div>
        </div>
      ) : (
        <>
          {timeLeft!==null && (
            <div style={{ background:timeLeft<60?'#fcebeb':'#faeeda', borderRadius:8, padding:'8px 14px', marginBottom:16,
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:13, fontWeight:600, color:timeLeft<60?'#791f1f':'#633806' }}>⏱ Time remaining</span>
              <span style={{ fontSize:18, fontWeight:800, fontFamily:'monospace', color:timeLeft<60?'#791f1f':'#633806' }}>{fmtTime(timeLeft)}</span>
            </div>
          )}
          <ErrorMsg message={err} />
          <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
            <Linkify text={workItem.instructions} />
          </p>
          {qs.map((q,qi)=>(
            <div key={q.id} style={{ background:'#f8fafc', borderRadius:10, padding:14, marginBottom:12, border:'0.5px solid #e2e8f0' }}>
              <p style={{ fontSize:14, fontWeight:500, color:'#0f172a', margin:'0 0 12px' }}>
                <span style={{ color:'#185fa5', fontWeight:700 }}>Q{qi+1}.</span> {q.question_text}
              </p>
              {(q.options||[]).map((opt,oi)=>(
                <label key={oi} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:7, marginBottom:6, cursor:'pointer',
                  background:answers[q.id]===oi?'#e6f1fb':'#fff', border:`1.5px solid ${answers[q.id]===oi?'#378add':'#e2e8f0'}` }}>
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id]===oi} onChange={()=>setAnswers(a=>({...a,[q.id]:oi}))} style={{ accentColor:'#185fa5' }} />
                  <span style={{ fontSize:13, color:'#334155' }}>{opt}</span>
                </label>
              ))}
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
            <span style={{ fontSize:13, color:'#64748b' }}>{Object.keys(answers).length}/{qs.length} answered</span>
            <Btn onClick={()=>setConfirm(true)}>Submit Quiz</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── MATERIALS ──────────────────────────────────────────────────────────────────
export function StudentMaterials() {
  const { markMultipleAsSeen, getSeenIds } = useNotifications();
  const { toKigali } = useTime();
  const { data, loading } = useData(api.student.getMaterials);
  const materials = useMemo(() => data?.materials || [], [data]);

  useEffect(() => {
    if (data) {
      markMultipleAsSeen(materials.map(mat => `mat-${mat.id}`));
    }
  }, [data, materials, markMultipleAsSeen]);

  const grouped = materials.reduce((acc,mat)=>{ (acc[mat.module_id]||(acc[mat.module_id]=[])).push(mat); return acc; },{});

  return (
    <Page>
      <SectionHeader title="Materials" subtitle="Notes and files from your teachers — download only" />
      {loading ? <Spinner /> : materials.length===0 ? <Empty message="No materials yet." /> : (
        Object.entries(grouped).map(([modId,mats])=>(
          <div key={modId} style={{ marginBottom:24 }}>
            <h3 style={{ fontSize:14, fontWeight:600, color:'#185fa5', marginBottom:10, textTransform:'uppercase', letterSpacing:'.3px' }}>
              {mats[0].module_name}
            </h3>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {mats.map(mat=>(
                <Card key={mat.id} padding="12px 16px">
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <FileIcon type={mat.file_type} />
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ fontSize:14, fontWeight:500, color:'#0f172a' }}>{mat.title}</div>
                          {!getSeenIds().includes(`mat-${mat.id}`) && (
                            <span style={{ background:'#10b981', color:'#fff', fontSize:8, fontWeight:800, padding:'1px 4px', borderRadius:3 }}>NEW</span>
                          )}
                        </div>
                        <div style={{ fontSize:12, color:'#64748b' }}>Uploaded {toKigali(mat.uploaded_at)}</div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <Badge color="gray">{(mat.file_type||'').toUpperCase()}</Badge>
                      <Btn size="sm" variant="secondary"
                        onClick={()=>{
                          const url = mat.file_url.startsWith('http') ? mat.file_url : `${process.env.REACT_APP_API_URL || ''}${mat.file_url}`;
                          window.open(url, '_blank');
                        }}>
                        ⬇ Download
                      </Btn>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </Page>
  );
}

// ── ANNOUNCEMENTS ──────────────────────────────────────────────────────────────
export function StudentAnnouncements() {
  const { markMultipleAsSeen } = useNotifications();
  const { toKigali } = useTime();
  const { data, loading, reload } = useData(api.student.getAnnouncements);
  const announcements = useMemo(() => data?.announcements || [], [data]);

  // Background polling for new announcements
  useEffect(() => {
    const timer = setInterval(() => reload(true), 15000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (data) {
      markMultipleAsSeen(announcements.map(ann => ann.id));
    }
  }, [data, announcements, markMultipleAsSeen]);
  const allReplies    = data?.replies       || [];
  const [replyText, setReplyText] = useState({});
  const [posting, setPosting]     = useState({});

  const getReplies = (annId) => allReplies.filter(r=>r.announcement_id===annId);

  const handleReply = async (annId) => {
    if (!replyText[annId]?.trim()) return;
    setPosting(p=>({...p,[annId]:true}));
    try {
      await api.student.postReply(annId, replyText[annId].trim());
      setReplyText(r=>({...r,[annId]:''}));
      reload();
    } catch(e) { alert(e.message); }
    finally { setPosting(p=>({...p,[annId]:false})); }
  };

  return (
    <Page>
      <SectionHeader title="Announcements" subtitle="School-wide and module announcements" />
      {loading ? <Spinner /> : announcements.length===0 ? <Empty message="No announcements yet." /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {announcements.map(ann=>{
            const replies = getReplies(ann.id);
            return (
              <Card key={ann.id} padding="16px 18px">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                    <Badge color={ann.poster_role==='admin' ? 'red' : 'green'}>
                      {ann.poster_role==='admin' ? '🏫 School-wide (Admin)' : `📚 ${ann.module_name||'Teacher'}`}
                    </Badge>
                    <span style={{ fontSize:12, color:'#94a3b8' }}>by {ann.poster_name}</span>
                  </div>
                  <span style={{ fontSize:12, color:'#94a3b8' }}>{toKigali(ann.created_at)}</span>
                </div>
                <p style={{ fontSize:14, color:'#1e293b', lineHeight:1.65, margin:'0 0 12px' }}>
                  <Linkify text={ann.body} />
                </p>
                {replies.length>0 && (
                  <div style={{ paddingTop:10, borderTop:'0.5px solid #f1f5f9', marginBottom:10 }}>
                    {replies.map(r=>(
                      <div key={r.id} style={{ fontSize:13, padding:'6px 10px', background:'#f8fafc', borderRadius:7, marginBottom:5, border:'0.5px solid #f1f5f9' }}>
                        <strong style={{ color:'#185fa5' }}>{r.student_name}</strong>: <Linkify text={r.body} />
                        <span style={{ fontSize:11, color:'#94a3b8', marginLeft:8 }}>{toKigali(r.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:'flex', gap:8 }}>
                  <input value={replyText[ann.id]||''} onChange={e=>setReplyText(r=>({...r,[ann.id]:e.target.value}))}
                    placeholder="Reply to this announcement..."
                    onKeyDown={e=>{ if(e.key==='Enter') handleReply(ann.id); }}
                    style={{ flex:1, padding:'7px 12px', borderRadius:8, border:'1.5px solid #e2e8f0', fontSize:13, outline:'none' }}
                    onFocus={e=>e.target.style.borderColor='#378add'}
                    onBlur={e=>e.target.style.borderColor='#e2e8f0'}
                  />
                  <Btn size="sm" onClick={()=>handleReply(ann.id)} loading={posting[ann.id]}>Reply</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

// ── RESULTS ────────────────────────────────────────────────────────────────────
export function StudentResults() {
  const { markMultipleAsSeen, getSeenIds } = useNotifications();
  const { toKigali } = useTime();
  const { data, loading } = useData(api.student.getResults);
  const results = useMemo(() => data?.results || [], [data]);

  useEffect(() => {
    if (data) {
      const gradedIds = results.filter(r => r.score !== null).map(r => `result-${r.id}`);
      markMultipleAsSeen(gradedIds);
    }
  }, [data, results, markMultipleAsSeen]);

  const grouped = results.reduce((acc,r)=>{ (acc[r.module_id]||(acc[r.module_id]=[])).push(r); return acc; },{});

  return (
    <Page>
      <SectionHeader title="My Results" subtitle="Your scores per subject and assessment" />
      {loading ? <Spinner /> : results.length===0 ? <Empty message="No results yet. Submit some work first." /> : (
        Object.entries(grouped).map(([modId,items])=>{
          const graded  = items.filter(x=>x.score!==null);
          const avg     = graded.length>0 ? (graded.reduce((a,x)=>a+(x.score/x.max_score),0)/graded.length*100).toFixed(0) : null;
          return (
            <Card key={modId} style={{ marginBottom:16 }} padding="16px 20px">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div>
                  <h3 style={{ fontSize:16, fontWeight:700, color:'#0c447c', margin:0 }}>{items[0].module_name}</h3>
                  <p style={{ fontSize:12, color:'#64748b', margin:'2px 0 0' }}>{items[0].class_name}</p>
                </div>
                {avg!==null && (
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:2 }}>Module Average</div>
                    <div style={{ fontSize:20, fontWeight:800, color:parseInt(avg)>=70?'#085041':parseInt(avg)>=50?'#ba7517':'#a32d2d' }}>
                      {avg}%
                    </div>
                  </div>
                )}
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc' }}>
                      {['Assessment','Type','Deadline','Score','Tag'].map(h=>(
                        <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0', fontSize:11, whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item,i)=>(
                      <tr key={i} style={{ borderBottom:'0.5px solid #f1f5f9' }}>
                        <td style={{ padding:'9px 10px', fontWeight:500, color:'#0f172a', whiteSpace:'nowrap' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            {item.title}
                            {item.is_late && <Badge color="red">LATE</Badge>}
                            {item.score !== null && !getSeenIds().includes(`result-${item.id}`) && (
                              <span style={{ background:'#10b981', color:'#fff', fontSize:8, fontWeight:800, padding:'1px 4px', borderRadius:3 }}>NEW</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding:'9px 10px' }}><Badge color={item.type==='quiz'?'purple':'blue'}>{item.type}</Badge></td>
                        <td style={{ padding:'9px 10px', color:'#64748b', fontSize:12, whiteSpace:'nowrap' }}>{toKigali(item.deadline)}</td>
                        <td style={{ padding:'9px 10px' }}><ScoreChip score={item.score} maxScore={item.max_score} /></td>
                        <td style={{ padding:'9px 10px' }}><TagChip tag={item.tag} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })
      )}
    </Page>
  );
}

// ── CHANGE PASSWORD (student) ─────────────────────────────────────────────────
export { ChangePassword } from '../teacher/TeacherPages';
