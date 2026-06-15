import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useTime } from '../../context/TimeContext';
import {
  Page, Card, Btn, Badge, Input, Select, Textarea, Modal,
  StatCard, SectionHeader, Empty, ErrorMsg, Spinner,
  ScoreChip, TagChip, TAGS, FileIcon, Linkify
} from '../shared/UI';

function useData(fetcher, deps = []) {
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
export function TeacherDashboard({ setActivePage }) {
  const { currentUser } = useAuth();
  const { toKigali } = useTime();
  const { data: modData, loading: modLoading } = useData(api.teacher.getModules);
  const { data: wiData  } = useData(api.teacher.getWorkItems);
  const { data: subData } = useData(() => api.teacher.getSubmissions());

  const modules   = useMemo(() => modData?.modules     || [], [modData]);
  const workItems = useMemo(() => wiData?.workItems    || [], [wiData]);
  const subs      = useMemo(() => subData?.submissions  || [], [subData]);
  const pending   = useMemo(() => subs.filter(s => s.score === null && s.graded_by !== 'system'), [subs]);

  return (
    <Page>
      <SectionHeader title={`Welcome, ${currentUser.name.split(' ')[0]}`} subtitle="Your teaching overview" />
      {modLoading ? <Spinner /> : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:14, marginBottom:28 }}>
            <StatCard label="My Modules"      value={modules.length}   bg="#e1f5ee" color="#085041" />
            <StatCard label="Work Items"      value={workItems.length} bg="#e6f1fb" color="#0c447c" />
            <StatCard label="Total Submitted" value={subs.length}      bg="#eeedfe" color="#3c3489" />
            <StatCard label="Needs Grading"   value={pending.length}   bg="#faeeda" color="#633806" />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:20 }}>
            <Card>
              <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', marginBottom:14 }}>My Modules</h3>
              {modules.length === 0 ? <Empty message="No modules assigned yet." /> : modules.map(m => (
                <div key={m.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:'0.5px solid #f1f5f9' }}>
                  <div>
                    <span style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>{m.name}</span>
                    <span style={{ fontSize:12, color:'#64748b', marginLeft:8 }}>→ {m.class_name}</span>
                  </div>
                  <Badge color="teal">{m.student_count} students</Badge>
                </div>
              ))}
            </Card>
            <Card>
              <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', marginBottom:14 }}>Needs Grading</h3>
              {pending.length === 0
                ? <div style={{ textAlign:'center', padding:20, color:'#64748b', fontSize:13 }}>✅ All caught up!</div>
                : pending.slice(0,5).map(s => (
                    <div key={s.id} style={{ padding:'8px 0', borderBottom:'0.5px solid #f1f5f9', fontSize:13 }}>
                      <div style={{ fontWeight:500, color:'#0f172a', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span>{s.work_title}</span>
                        {s.is_late && <span style={{ fontSize:10, color:'#ef4444', fontWeight:800, border:'1px solid #ef4444', padding:'1px 4px', borderRadius:4 }}>LATE</span>}
                      </div>
                      <div style={{ fontSize:12, color:'#94a3b8' }}>{s.student_name} · {toKigali(s.submitted_at)}</div>
                    </div>
                  ))
              }
              {pending.length > 0 && (
                <Btn size="sm" variant="secondary" style={{ width:'100%', marginTop:12 }} onClick={() => setActivePage('grading')}>
                  Go to Grading →
                </Btn>
              )}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

// ── MY MODULES ─────────────────────────────────────────────────────────────────
export function TeacherModules() {
  const { data, loading } = useData(api.teacher.getModules);
  const modules = data?.modules || [];
  return (
    <Page>
      <SectionHeader title="My Modules" subtitle="All classes and modules you teach" />
      {loading ? <Spinner /> : modules.length === 0 ? <Empty message="No modules assigned. Ask admin to assign you." /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {modules.map(m => (
            <Card key={m.id} padding="16px 20px">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div>
                  <h3 style={{ fontSize:16, fontWeight:700, color:'#0c447c', margin:0 }}>{m.name}</h3>
                  <p style={{ fontSize:13, color:'#64748b', margin:'2px 0 0' }}>{m.class_name} — Level {m.level}</p>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <Badge color="blue">{m.student_count} students</Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

// ── ASSIGNMENTS & QUIZZES ──────────────────────────────────────────────────────
export function TeacherAssignments() {
  const { toKigali } = useTime();
  const { data: modData } = useData(api.teacher.getModules);
  const { data: wiData, loading, reload } = useData(api.teacher.getWorkItems);
  const modules   = modData?.modules   || [];
  const workItems = wiData?.workItems  || [];

  const [showCreate, setShowCreate] = useState(false);
  const [tab,   setTab]   = useState('assignment');
  const [form,  setForm]  = useState({ title:'', instructions:'', moduleId:'', deadline:'', openAt:'', closeAt:'', maxScore:'20' });
  const [qs,    setQs]    = useState([{ questionText:'', options:['','','',''], correctOption:0 }]);
  const [err,   setErr]   = useState('');
  const [saving, setSaving] = useState(false);
  const [viewWork, setViewWork] = useState(null);
  const [viewQs,   setViewQs]  = useState([]);

  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const handleCreate = async () => {
    setErr('');
    if (!form.title.trim() || !form.moduleId) return setErr('Title and module are required.');
    if (tab === 'quiz' && qs.some(q => !q.questionText.trim() || q.options.some(o => !o.trim()))) {
      return setErr('All questions and options must be filled in.');
    }
    setSaving(true);
    try {
      const toUTC = (val) => val ? new Date(val + ':00+02:00').toISOString() : null;

      const wi = await api.teacher.createWorkItem({
        moduleId:     form.moduleId,
        type:         tab,
        title:        form.title.trim(),
        instructions: form.instructions.trim(),
        maxScore:     parseInt(form.maxScore) || 20,
        deadline:     toUTC(form.deadline),
        openAt:       toUTC(form.openAt),
        closeAt:      toUTC(form.closeAt),
      });
      if (tab === 'quiz') {
        await api.teacher.saveQuestions(wi.workItem.id, qs);
      }
      setShowCreate(false);
      setForm({ title:'', instructions:'', moduleId:'', deadline:'', openAt:'', closeAt:'', maxScore:'20' });
      setQs([{ questionText:'', options:['','','',''], correctOption:0 }]);
      reload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this work item? All submissions will also be deleted.')) return;
    try { await api.teacher.deleteWorkItem(id); reload(); } catch(e) { alert(e.message); }
  };

  const openView = async (w) => {
    setViewWork(w);
    if (w.type === 'quiz') {
      const d = await api.teacher.getQuestions(w.id);
      setViewQs(d.questions || []);
    }
  };

  const addQ    = () => setQs(q => [...q, { questionText:'', options:['','','',''], correctOption:0 }]);
  const updateQ = (i,k,v) => setQs(q => q.map((x,idx) => idx===i ? {...x,[k]:v} : x));
  const updateO = (qi,oi,v) => setQs(q => q.map((x,idx) => idx===qi ? {...x, options:x.options.map((o,oidx) => oidx===oi?v:o)} : x));
  const removeQ = (i) => setQs(q => q.filter((_,idx) => idx!==i));

  return (
    <Page>
      <SectionHeader title="Assignments & Quizzes"
        subtitle={`${workItems.length} total work items across your modules`}
        action={<Btn onClick={() => setShowCreate(true)}>+ Create</Btn>}
      />
      {loading ? <Spinner /> : workItems.length === 0 ? <Empty message="No assignments or quizzes yet." /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {workItems.map(w => (
            <Card key={w.id} padding="14px 18px">
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', gap:6, marginBottom:4, flexWrap:'wrap' }}>
                    <Badge color={w.type==='quiz'?'purple':'blue'}>{w.type==='quiz'?'📝 Quiz':'📋 Assignment'}</Badge>
                    <Badge color="teal">{w.class_name} · {w.module_name}</Badge>
                  </div>
                  <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', margin:'4px 0' }}>{w.title}</h3>
                  <p style={{ fontSize:12, color:'#64748b', margin:0 }}>
                    {w.deadline?`Due: ${toKigali(w.deadline)}` : 'No deadline'}
                    {w.open_at && ` · Opens: ${toKigali(w.open_at)}`}
                    {w.close_at && ` · Closes: ${toKigali(w.close_at)}`}
                  </p>

                  <div style={{ fontSize:12, color:'#94a3b8', marginTop:2 }}>{w.submission_count} submitted · Max score: {w.max_score}</div>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <Btn size="sm" variant="secondary" onClick={() => openView(w)}>View</Btn>
                  <Btn size="sm" variant="danger" onClick={() => handleDelete(w.id)}>Delete</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreate && (
        <Modal title="Create Assignment / Quiz" onClose={() => { setShowCreate(false); setErr(''); }} width={640}>
          <div style={{ display:'flex', gap:8, marginBottom:18 }}>
            {['assignment','quiz'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ flex:1, padding:9, border:'none', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:13,
                  background:tab===t?'#185fa5':'#f1f5f9', color:tab===t?'#fff':'#475569' }}>
                {t==='assignment' ? '📋 Assignment (manual grade)' : '📝 Quiz (MCQ auto-grade)'}
              </button>
            ))}
          </div>
          <ErrorMsg message={err} />
          <Input label="Title" value={form.title} onChange={e=>set('title',e.target.value)} required placeholder="e.g. OSI Model Report" />
          <Textarea label="Instructions" value={form.instructions} onChange={e=>set('instructions',e.target.value)} placeholder="What should students do?" />
          <Select label="Module / Class" value={form.moduleId} onChange={e=>set('moduleId',e.target.value)}
            options={[{value:'',label:'— Select module —'}, ...modules.map(m=>({value:m.id,label:`${m.class_name} · ${m.name}`}))]}
          />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:8 }}>
            {[['maxScore','Max Score','20'],['deadline','Deadline',''],['openAt','Opens At',''],['closeAt','Closes At','']].map(([k,lbl,ph])=>(
              <div key={k}>
                <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:5, textTransform:'uppercase', letterSpacing:'.4px' }}>{lbl}</label>
                <input type={k==='maxScore'?'number':'datetime-local'} value={form[k]}
                  onChange={e=>set(k,e.target.value)} placeholder={ph}
                  style={{ width:'100%', padding:'9px 10px', borderRadius:8, border:'1.5px solid #e2e8f0', fontSize:12, outline:'none', boxSizing:'border-box' }} />
              </div>
            ))}
          </div>
          <p style={{ fontSize:11, color:'#94a3b8', marginBottom:14 }}>If no window is set, work stays open until the deadline (or forever if no deadline).</p>

          {tab === 'quiz' && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', marginBottom:12 }}>Questions ({qs.length})</div>
              {qs.map((q,qi) => (
                <div key={qi} style={{ background:'#f8fafc', borderRadius:10, padding:14, marginBottom:12, border:'0.5px solid #e2e8f0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#185fa5' }}>Q{qi+1}</span>
                    {qs.length > 1 && <Btn size="sm" variant="danger" onClick={() => removeQ(qi)}>Remove</Btn>}
                  </div>
                  <Input label="Question" value={q.questionText} onChange={e=>updateQ(qi,'questionText',e.target.value)} placeholder="Enter the question..." />
                  {q.options.map((opt,oi) => (
                    <div key={oi} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                      <input type="radio" name={`correct-${qi}`} checked={q.correctOption===oi} onChange={() => updateQ(qi,'correctOption',oi)} style={{ accentColor:'#185fa5' }} />
                      <input value={opt} onChange={e=>updateO(qi,oi,e.target.value)} placeholder={`Option ${oi+1}`}
                        style={{ flex:1, padding:'7px 10px', borderRadius:7, border:'1.5px solid #e2e8f0', fontSize:13, outline:'none' }} />
                      {q.correctOption===oi && <span style={{ fontSize:11, color:'#27500a', fontWeight:600 }}>✓</span>}
                    </div>
                  ))}
                </div>
              ))}
              <Btn variant="ghost" size="sm" onClick={addQ}>+ Add Question</Btn>
            </div>
          )}
          <Btn onClick={handleCreate} loading={saving} style={{ width:'100%', marginTop:16 }}>
            Create {tab==='quiz'?'Quiz':'Assignment'}
          </Btn>
        </Modal>
      )}

      {/* VIEW MODAL */}
      {viewWork && (
        <Modal title={viewWork.title} onClose={() => setViewWork(null)}>
          <Badge color={viewWork.type==='quiz'?'purple':'blue'}>{viewWork.type}</Badge>
          <p style={{ fontSize:14, color:'#334155', marginTop:10, lineHeight:1.6 }}>
            <Linkify text={viewWork.instructions} />
          </p>
          {viewWork.deadline && <p style={{ fontSize:13, color:'#64748b' }}>Deadline: {toKigali(viewWork.deadline)}</p>}
          {viewWork.type==='quiz' && viewQs.length > 0 && (
            <div style={{ marginTop:12 }}>
              <h4 style={{ fontSize:13, fontWeight:600, color:'#0f172a', marginBottom:8 }}>Questions</h4>
              {viewQs.map((q,i) => (
                <div key={q.id} style={{ background:'#f8fafc', borderRadius:8, padding:12, marginBottom:8 }}>
                  <p style={{ fontSize:13, fontWeight:500, color:'#0f172a', margin:'0 0 8px' }}>Q{i+1}: {q.question_text}</p>
                  {(q.options||[]).map((o,oi) => (
                    <div key={oi} style={{ fontSize:13, padding:'3px 0', color:oi===q.correct_option?'#085041':'#475569' }}>
                      {oi===q.correct_option?'✓ ':'○ '}{o}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Page>
  );
}

// ── GRADING ───────────────────────────────────────────────────────────────────
export function TeacherGrading() {
  const { toKigali } = useTime();
  const { data: wiData } = useData(api.teacher.getWorkItems);

  const [filterWork, setFilterWork]   = useState('all');
  const { data: subData, loading, reload } = useData(
    () => filterWork === 'all' ? api.teacher.getSubmissions() : api.teacher.getSubmissions(filterWork),
    [filterWork]
  );
  const [gradeModal, setGradeModal]   = useState(null);
  const [gradeForm,  setGradeForm]    = useState({ score:'', tag:'' });
  const [saving, setSaving]           = useState(false);
  const [err,    setErr]              = useState('');

  const assignmentItems = (wiData?.workItems || []).filter(w => w.type === 'assignment');
  const subs = subData?.submissions || [];

  const handleGrade = async () => {
    setErr('');
    const score = parseInt(gradeForm.score);
    if (isNaN(score) || score < 0) return setErr('Enter a valid score.');
    setSaving(true);
    try {
      await api.teacher.gradeSubmission(gradeModal.id, { score, tag: gradeForm.tag || null });
      setGradeModal(null); reload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Page>
      <SectionHeader title="Grading" subtitle="Review and grade student submissions" />
      <div style={{ marginBottom:16 }}>
        <Select label="" value={filterWork} onChange={e=>setFilterWork(e.target.value)}
          options={[{value:'all',label:'All Work Items'}, ...assignmentItems.map(w=>({value:w.id,label:`${w.class_name} — ${w.title}`}))]}
        />
      </div>
      {loading ? <Spinner /> : subs.length === 0 ? <Empty message="No submissions to grade." /> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Student','Work Item','Submitted','Status','Score','Tag','Action'].map(h => (
                  <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0', fontSize:12, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id} style={{ borderBottom:'0.5px solid #f1f5f9' }}>
                  <td style={{ padding:'10px 12px' }}>
                    <div style={{ fontWeight:500, color:'#0f172a' }}>{s.student_name}</div>
                    {s.duplicate_flag && <Badge color="red">⚠ Duplicate</Badge>}
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    <div style={{ color:'#334155' }}>{s.work_title}</div>
                    <div style={{ fontSize:11, color:'#94a3b8' }}>{s.class_name}</div>
                  </td>
                  <td style={{ padding:'10px 12px', color:'#64748b', whiteSpace:'nowrap' }}>
                    <div>{toKigali(s.submitted_at)}</div>
                    {s.is_late && <span style={{ fontSize:9, color:'#ef4444', fontWeight:800, textTransform:'uppercase' }}>⚠ Late Submission</span>}
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    {s.graded_by==='system' ? <Badge color="teal">Auto</Badge>
                      : s.score!==null ? <Badge color="green">Graded</Badge>
                      : <Badge color="amber">Pending</Badge>}
                  </td>
                  <td style={{ padding:'10px 12px' }}><ScoreChip score={s.score} maxScore={s.max_score} /></td>
                  <td style={{ padding:'10px 12px' }}><TagChip tag={s.tag} /></td>
                  <td style={{ padding:'10px 12px' }}>
                    {s.graded_by !== 'system' && (
                      <Btn size="sm" variant={s.score!==null?'ghost':'primary'}
                        onClick={() => { setGradeModal(s); setGradeForm({ score: s.score??'', tag: s.tag??'' }); setErr(''); }}>
                        {s.score!==null?'Edit':'Grade'}
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gradeModal && (
        <Modal title="Grade Submission" onClose={() => setGradeModal(null)} width={480}>
          <div style={{ background:'#f8fafc', borderRadius:8, padding:12, marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#0f172a', marginBottom:4 }}>{gradeModal.student_name}</div>
            <div style={{ fontSize:13, color:'#475569', marginBottom:8 }}>{gradeModal.work_title}</div>
            <div style={{ fontSize:13, color:'#334155', lineHeight:1.6, maxHeight:140, overflow:'auto', whiteSpace:'pre-wrap' }}>
              {gradeModal.content}
            </div>
            {gradeModal.duplicate_flag && (
              <div style={{ marginTop:8, padding:'6px 10px', background:'#fcebeb', borderRadius:6, fontSize:12, color:'#791f1f' }}>
                ⚠ Similar content detected in another submission. Review carefully before grading.
              </div>
            )}
          </div>
          <ErrorMsg message={err} />
          <Input label={`Score (out of ${gradeModal.max_score})`} type="number"
            value={gradeForm.score} onChange={e=>setGradeForm(f=>({...f,score:e.target.value}))}
            placeholder={`0–${gradeModal.max_score}`} />
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:6, textTransform:'uppercase' }}>
              Quick Tag (optional)
            </label>
            <div style={{ display:'flex', gap:8 }}>
              {TAGS.map(t => (
                <button key={t} onClick={() => setGradeForm(f=>({...f, tag: f.tag===t?'':t}))}
                  style={{ padding:'6px 12px', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:gradeForm.tag===t?600:400,
                    border:`1.5px solid ${gradeForm.tag===t?'#ba7517':'#e2e8f0'}`,
                    background:gradeForm.tag===t?'#faeeda':'#fff',
                    color:gradeForm.tag===t?'#633806':'#475569' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <Btn onClick={handleGrade} loading={saving} style={{ width:'100%' }}>Save Grade</Btn>
        </Modal>
      )}
    </Page>
  );
}

// ── MATERIALS ──────────────────────────────────────────────────────────────────
export function TeacherMaterials() {
  const { toKigali } = useTime();
  const { data: modData } = useData(api.teacher.getModules);
  const { data, loading, reload } = useData(api.teacher.getMaterials);
  const modules   = modData?.modules  || [];
  const materials = data?.materials   || [];

  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ moduleId:'', title:'' });
  const [file, setFile] = useState(null);
  const [err,  setErr]  = useState('');
  const [saving, setSaving] = useState(false);

  const handleUpload = async () => {
    setErr('');
    if (!form.moduleId || !form.title.trim()) return setErr('Module and title are required.');
    if (!file) return setErr('Please select a file.');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('moduleId', form.moduleId);
      fd.append('title', form.title.trim());
      await api.teacher.uploadMaterial(fd);
      setShowUpload(false); setForm({ moduleId:'', title:'' }); setFile(null); reload();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this material?')) return;
    try { await api.teacher.deleteMaterial(id); reload(); } catch(e) { alert(e.message); }
  };

  return (
    <Page>
      <SectionHeader title="Materials"
        subtitle="Upload notes and files — students download only"
        action={<Btn onClick={() => setShowUpload(true)}>+ Upload</Btn>}
      />
      {loading ? <Spinner /> : materials.length === 0 ? <Empty message="No materials yet." /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {materials.map(mat => (
            <Card key={mat.id} padding="12px 16px">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <FileIcon type={mat.file_type} />
                  <div>
                    <div style={{ fontSize:14, fontWeight:500, color:'#0f172a' }}>{mat.title}</div>
                    <div style={{ fontSize:12, color:'#64748b' }}>{mat.class_name} · {mat.module_name} · {toKigali(mat.uploaded_at)}</div>

                    {mat.file_size && <div style={{ fontSize:11, color:'#94a3b8' }}>{(mat.file_size/1024).toFixed(0)} KB</div>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <Badge color="gray">{(mat.file_type||'').toUpperCase()}</Badge>
                  <Btn size="sm" variant="secondary"
                    onClick={()=>{
                      const url = mat.file_url.startsWith('http') ? mat.file_url : `${process.env.REACT_APP_API_URL || ''}${mat.file_url}`;
                      window.open(url, '_blank');
                    }}>
                    View
                  </Btn>
                  <Btn size="sm" variant="danger" onClick={() => handleDelete(mat.id)}>Delete</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showUpload && (
        <Modal title="Upload Material" onClose={() => { setShowUpload(false); setErr(''); }}>
          <ErrorMsg message={err} />
          <Select label="Module / Class" value={form.moduleId} onChange={e=>setForm(f=>({...f,moduleId:e.target.value}))}
            options={[{value:'',label:'— Select module —'}, ...modules.map(m=>({value:m.id,label:`${m.class_name} · ${m.name}`}))]}
          />
          <Input label="Title / File Name" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Chapter 1 Notes" required />
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:5, textTransform:'uppercase' }}>File *</label>
            <input type="file" accept=".pdf,.pptx,.docx,.xlsx,.jpg,.png" onChange={e=>setFile(e.target.files[0])}
              style={{ width:'100%', fontSize:13, color:'#334155' }} />
            <p style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>Allowed: PDF, PPTX, DOCX, XLSX, JPG, PNG. Max: {process.env.REACT_APP_MAX_FILE_MB||10}MB</p>
          </div>
          <Btn onClick={handleUpload} loading={saving} style={{ width:'100%' }}>Upload</Btn>
        </Modal>
      )}
    </Page>
  );
}

// ── ANNOUNCEMENTS ──────────────────────────────────────────────────────────────
export function TeacherAnnouncements() {
  const { currentUser } = useAuth();
  const { toKigali } = useTime();
  const { data: modData } = useData(api.teacher.getModules);
  const { data, loading, reload } = useData(api.teacher.getAnnouncements);
  const modules       = modData?.modules         || [];
  const announcements = data?.announcements      || [];

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ body:'', moduleId:'' });
  const [err,  setErr]  = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {    setErr('');
    if (!form.body.trim() || !form.moduleId) return setErr('Please fill in all fields.');
    setSaving(true);
    try { await api.teacher.postAnnouncement({ body: form.body.trim(), moduleId: form.moduleId }); setShowCreate(false); setForm({body:'',moduleId:''}); reload(); }
    catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete announcement?')) return;
    try { await api.teacher.deleteAnnouncement(id); reload(); } catch(e) { alert(e.message); }
  };

  return (
    <Page>
      <SectionHeader title="Announcements"
        subtitle="Post to your module — visible to that class only"
        action={<Btn onClick={() => setShowCreate(true)}>+ Post</Btn>}
      />
      {loading ? <Spinner /> : announcements.length===0 ? <Empty message="No announcements yet." /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {announcements.map(ann => (
            <Card key={ann.id} padding="16px 18px">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <Badge color={ann.poster_role==='admin' ? 'red' : 'green'}>
                    {ann.poster_role==='admin' ? '🏫 Admin' : `📚 ${ann.class_name||''} · ${ann.module_name||''}`}
                  </Badge>
                  <span style={{ fontSize:12, color:'#94a3b8' }}>by {ann.poster_name}</span>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{ fontSize:12, color:'#94a3b8' }}>{toKigali(ann.created_at)}</span>
                  {ann.posted_by===currentUser.id && (
                    <Btn size="sm" variant="danger" onClick={() => handleDelete(ann.id)}>Delete</Btn>
                  )}
                </div>
              </div>
              <p style={{ fontSize:14, color:'#1e293b', lineHeight:1.6, margin:0 }}>
                <Linkify text={ann.body} />
              </p>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Post Module Announcement" onClose={() => { setShowCreate(false); setErr(''); }}>
          <ErrorMsg message={err} />
          <Select label="Module / Class" value={form.moduleId} onChange={e=>setForm(f=>({...f,moduleId:e.target.value}))}
            options={[{value:'',label:'— Select module —'}, ...modules.map(m=>({value:m.id,label:`${m.class_name} · ${m.name}`}))]}
          />
          <Textarea label="Message" value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={4} required placeholder="Type your announcement..." />
          <p style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>Only students in the selected class will see this.</p>
          <Btn onClick={handleCreate} loading={saving} style={{ width:'100%' }}>Post</Btn>
        </Modal>
      )}
    </Page>
  );
}

// ── REPORTS ────────────────────────────────────────────────────────────────────
export function TeacherReports() {
  const { data: modData } = useData(api.teacher.getModules);
  const modules = modData?.modules || [];
  const [selectedModule, setSelectedModule] = useState('');
  useEffect(() => { if (modules.length > 0 && !selectedModule) setSelectedModule(modules[0].id); }, [modules]); // eslint-disable-line

  const { data, loading } = useData(
    () => selectedModule ? api.teacher.getReport(selectedModule) : Promise.resolve(null),
    [selectedModule]
  );

  const students   = data?.students   || [];
  const workItems  = data?.workItems  || [];
  const subs       = data?.submissions || [];

  const getSub = (studentId, wiId) => subs.find(s => s.student_id===studentId && s.work_item_id===wiId);

  return (
    <Page>
      <SectionHeader title="Reports & Performance" subtitle="Track student scores per assessment" />
      <div style={{ marginBottom:20 }}>
        <Select label="Select Module" value={selectedModule} onChange={e=>setSelectedModule(e.target.value)}
          options={modules.map(m=>({value:m.id, label:`${m.class_name} · ${m.name}`}))}
        />
      </div>

      {loading ? <Spinner /> : !selectedModule ? null : (
        <>
          {/* Performance table */}
          <Card style={{ marginBottom:20 }}>
            <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', marginBottom:14 }}>Performance Table</h3>
            {workItems.length===0 ? <Empty message="No work items in this module." /> : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f0f7ff' }}>
                      <th style={{ padding:'10px 12px', textAlign:'left', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>Student</th>
                      {workItems.map(wi => (
                        <th key={wi.id} style={{ padding:'10px 12px', textAlign:'center', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>
                          <div style={{ fontSize:11 }}>{wi.title}</div>
                          <div style={{ fontSize:10, color:'#94a3b8', fontWeight:400 }}>{wi.type} / {wi.max_score}</div>
                        </th>
                      ))}
                      <th style={{ padding:'10px 12px', textAlign:'center', fontWeight:600, color:'#475569', borderBottom:'1px solid #e2e8f0' }}>Avg%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map(st => {
                      const scores = workItems.map(wi => { const s=getSub(st.id,wi.id); return s?.score!=null?s.score/s.max_score:null; });
                      const graded = scores.filter(s=>s!==null);
                      const avg    = graded.length>0 ? (graded.reduce((a,b)=>a+b,0)/graded.length*100).toFixed(0) : null;
                      return (
                        <tr key={st.id} style={{ borderBottom:'0.5px solid #f1f5f9' }}>
                          <td style={{ padding:'10px 12px', fontWeight:500, color:'#0f172a', whiteSpace:'nowrap' }}>{st.name}</td>
                          {workItems.map(wi => {
                            const s = getSub(st.id, wi.id);
                            return (
                              <td key={wi.id} style={{ padding:'10px 12px', textAlign:'center' }}>
                                {s ? <ScoreChip score={s.score} maxScore={s.max_score} /> : <Badge color="gray">—</Badge>}
                              </td>
                            );
                          })}
                          <td style={{ padding:'10px 12px', textAlign:'center', fontWeight:700, color:'#185fa5', fontSize:13 }}>{avg??'—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Submission tracking */}
          <h3 style={{ fontSize:15, fontWeight:600, color:'#0f172a', marginBottom:12 }}>Submission Tracking</h3>
          {workItems.map(wi => {
            const submitted = students.filter(st => getSub(st.id, wi.id));
            const missing   = students.filter(st => !getSub(st.id, wi.id));
            return (
              <Card key={wi.id} style={{ marginBottom:12 }} padding="14px 16px">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:14, fontWeight:600, color:'#0f172a' }}>{wi.title}</span>
                  <div style={{ display:'flex', gap:8 }}>
                    <Badge color="green">✓ {submitted.length} submitted</Badge>
                    <Badge color="red">✗ {missing.length} missing</Badge>
                  </div>
                </div>
                {missing.length>0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {missing.map(s=>(
                      <span key={s.id} style={{ fontSize:12, padding:'3px 9px', background:'#fcebeb', borderRadius:12, color:'#791f1f', border:'0.5px solid #f7c1c1' }}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}

// ── CHANGE PASSWORD ────────────────────────────────────────────────────────────
export function ChangePassword() {
  const { changePassword } = useAuth();
  const [form, setForm] = useState({ currentPassword:'', newPassword:'', confirm:'' });
  const [err,  setErr]  = useState('');
  const [ok,   setOk]   = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async (e) => {
    e.preventDefault(); setErr(''); setOk('');
    if (form.newPassword !== form.confirm) return setErr('New passwords do not match.');
    if (form.newPassword.length < 6) return setErr('New password must be at least 6 characters.');
    setLoading(true);
    try { await changePassword(form.currentPassword, form.newPassword); setOk('Password updated successfully.'); setForm({currentPassword:'',newPassword:'',confirm:''}); }
    catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Page style={{ maxWidth:440 }}>
      <SectionHeader title="Change Password" />
      <Card>
        {ok && <div style={{ padding:'10px 14px', background:'#eaf3de', borderRadius:8, fontSize:13, color:'#27500a', marginBottom:14 }}>{ok}</div>}
        <ErrorMsg message={err} />
        <form onSubmit={handle}>
          <Input label="Current Password" type="password" value={form.currentPassword} onChange={e=>setForm(f=>({...f,currentPassword:e.target.value}))} required />
          <Input label="New Password" type="password" value={form.newPassword} onChange={e=>setForm(f=>({...f,newPassword:e.target.value}))} required />
          <Input label="Confirm New Password" type="password" value={form.confirm} onChange={e=>setForm(f=>({...f,confirm:e.target.value}))} required />
          <Btn type="submit" loading={loading} style={{ width:'100%' }}>Update Password</Btn>
        </form>
      </Card>
    </Page>
  );
}
