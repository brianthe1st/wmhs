import React, { useState, useEffect, useMemo } from 'react';
import { api, saveText } from '../../utils/api';
import { useTime } from '../../context/TimeContext';
import {
  Page, Card, Btn, Badge, Input, Select, Modal, StatCard,
  SectionHeader, Empty, ErrorMsg, Spinner, Linkify, Notice
} from '../shared/UI';
import { useData, CopyBtn, TempPasswordModal, ReplyThread, EditTextModal } from '../shared/Common';

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
export function AdminDashboard({ setActivePage }) {
  const { data, loading } = useData(api.admin.stats, [], 60000);
  return (
    <Page>
      <SectionHeader title="Admin Dashboard" subtitle={`World Mission High School overview${data?.currentYear ? ` · Academic year ${data.currentYear}` : ''}`}/>
      {loading ? <Spinner/> : (
        <>
          {data?.passwordRequests > 0 && (
            <button onClick={()=>setActivePage('reset-password')} style={{ width:'100%', textAlign:'left', cursor:'pointer', marginBottom:16,
              background:'#faeeda', border:'1px solid #fac775', color:'#633806', borderRadius:10, padding:'12px 16px', fontSize:14, fontWeight:600 }}>
              🔑 {data.passwordRequests} {data.passwordRequests === 1 ? 'person is' : 'people are'} waiting for a password reset →
            </button>
          )}
          <div className="grid-auto stat-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:14,marginBottom:28}}>
            <StatCard label="Classes"   value={data?.classes}   bg="#e6f1fb" color="#0c447c"/>
            <StatCard label="Teachers"  value={data?.teachers}  bg="#e1f5ee" color="#085041"/>
            <StatCard label="Active students"  value={data?.students}  bg="#eeedfe" color="#3c3489"/>
            <StatCard label="Work this year" value={data?.workItems} bg="#faeeda" color="#633806"/>
          </div>
          <Card>
            <h3 style={{fontSize:15,fontWeight:600,color:'#0f172a',marginBottom:14}}>Quick Actions</h3>
            <div className="grid-auto" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:8}}>
              {[
                {label:'Manage Classes & Join Codes', page:'classes',       color:'#0c447c', bg:'#e6f1fb'},
                {label:'Add a Teacher Account',       page:'teachers',      color:'#085041', bg:'#e1f5ee'},
                {label:'Students & CSV import',       page:'students',      color:'#3c3489', bg:'#eeedfe'},
                {label:'Post Announcement',           page:'announcements', color:'#633806', bg:'#faeeda'},
                {label:'Start a new academic year',   page:'promotion',     color:'#791f1f', bg:'#fcebeb'},
              ].map(a=>(
                <button key={a.page} onClick={()=>setActivePage(a.page)}
                  style={{background:a.bg,border:'none',color:a.color,borderRadius:8,
                    padding:'14px 16px',cursor:'pointer',textAlign:'left',fontSize:13,fontWeight:500}}>
                  {a.label} →
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

// ── CLASSES ────────────────────────────────────────────────────────────────────
const SUGGESTED_MODULES = {
  SOD: ['Networking','Programming','Web Development','Databases','Operating Systems','Software Engineering'],
  NIT: ['Networking','Databases','IT Support','Programming','Cybersecurity','Cloud Computing'],
  MMP: ['Multimedia Production','Graphic Design','Web Development','Photography','Video Editing','Animation'],
};

export function AdminClasses() {
  const { data, loading, reload } = useData(api.admin.getClasses);
  const { data: trData }          = useData(api.admin.getTeachers);
  const teachers = useMemo(() => trData?.teachers || [], [trData]);
  const [showAssign, setShowAssign] = useState(null);
  const [assignForm, setAssignForm] = useState({ moduleName:'', teacherId:'' });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ level:'3', stream:'' });
  const [err, setErr] = useState('');
  const [actioning, setActioning] = useState('');

  useEffect(() => { if (showAssign) { setAssignForm({ moduleName:'', teacherId:'' }); setErr(''); } }, [showAssign]);

  const doReset  = async (id) => { setActioning(id+'reset');  try{await api.admin.resetCode(id); reload(true);}catch(e){alert(e.message);}finally{setActioning('');} };
  const doToggle = async (id) => { setActioning(id+'toggle'); try{await api.admin.toggleCode(id); reload(true);}catch(e){alert(e.message);}finally{setActioning('');} };
  const doResetAll = async () => {
    if (!window.confirm('Give EVERY class a brand-new join code? Old codes stop working immediately.')) return;
    try { const r = await api.admin.resetAllCodes(); alert(r.message); reload(true); } catch(e){ alert(e.message); }
  };

  const doAssign = async () => {
    setErr('');
    if (!assignForm.moduleName.trim()||!assignForm.teacherId) return setErr('Module name and teacher are required.');
    try {
      await api.admin.assignModule({ classId: showAssign.id, moduleName: assignForm.moduleName.trim(), teacherId: assignForm.teacherId });
      setShowAssign(null); reload(true);
    } catch(e) { setErr(e.message); }
  };

  const doAdd = async () => {
    setErr('');
    try { await api.admin.createClass(parseInt(addForm.level, 10), addForm.stream.trim()); setShowAdd(false); setAddForm({ level:'3', stream:'' }); reload(true); }
    catch(e) { setErr(e.message); }
  };

  const classes = useMemo(() => data?.classes || [], [data]);
  const levels = useMemo(() => [...new Set(classes.map(c => c.level))].sort((a,b)=>a-b), [classes]);
  if (loading) return <Page><Spinner/></Page>;

  return (
    <Page>
      <SectionHeader title="Classes & Join Codes" subtitle={`${classes.length} classes — codes, modules and teachers`}
        action={<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <Btn variant="ghost" onClick={doResetAll}>Reset all codes</Btn>
          <Btn onClick={()=>{setErr('');setShowAdd(true);}}>+ Add class</Btn>
        </div>}/>
      {levels.map(level=>(
        <div key={level} style={{marginBottom:28}}>
          <h3 style={{fontSize:14,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:12}}>Level {level}</h3>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(250px, 1fr))',gap:14}}>
            {classes.filter(c=>c.level===level).map(cls=>(
              <Card key={cls.id} padding="14px 16px">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                  <h4 style={{fontSize:15,fontWeight:700,color:'#0c447c',margin:0}}>{cls.name} <span style={{fontSize:12,fontWeight:400,color:'#64748b'}}>· {cls.student_count} students</span></h4>
                  <Badge color={cls.code_active?'green':'red'}>{cls.code_active?'Open':'Closed'}</Badge>
                </div>
                <div style={{background:'#f0f7ff',borderRadius:7,padding:'8px 10px',marginBottom:10,border:'0.5px solid #bfdbfe'}}>
                  <div style={{fontSize:11,color:'#64748b',marginBottom:2,fontWeight:600}}>JOIN CODE</div>
                  <div style={{fontSize:20,fontWeight:800,color:'#1e293b',letterSpacing:'1px'}}>{cls.join_code}</div>
                </div>
                <div style={{display:'flex',gap:6,marginBottom:12}}>
                  <Btn size="sm" variant="secondary" onClick={()=>doReset(cls.id)} loading={actioning===cls.id+'reset'}>New code</Btn>
                  <Btn size="sm" variant={cls.code_active?'danger':'success'} onClick={()=>doToggle(cls.id)} loading={actioning===cls.id+'toggle'}>
                    {cls.code_active?'Close sign-up':'Open sign-up'}
                  </Btn>
                </div>
                <div style={{borderTop:'0.5px solid #e2e8f0',paddingTop:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:6}}>MODULES</div>
                  {(!cls.modules || cls.modules.length===0) ? <div style={{fontSize:12,color:'#94a3b8'}}>No modules</div> : cls.modules.map(m=>(
                    <div key={m.id} style={{fontSize:12,color:'#334155',marginBottom:3,display:'flex',justifyContent:'space-between',gap:8}}>
                      <span>{m.name}</span>
                      <span style={{color:'#94a3b8',textAlign:'right'}}>{m.teacher_name}</span>
                    </div>
                  ))}
                  <Btn size="sm" variant="ghost" style={{width:'100%',marginTop:8,fontSize:12}} onClick={()=>setShowAssign(cls)}>+ Assign module</Btn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {showAssign && (
        <Modal title={`Assign module to ${showAssign.name}`} onClose={()=>setShowAssign(null)}>
          <ErrorMsg message={err}/>
          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569', marginBottom:5, textTransform:'uppercase', letterSpacing:'.4px' }}>Module name</label>
            <input list="module-suggestions" value={assignForm.moduleName} maxLength={100}
              onChange={e=>setAssignForm(f=>({...f,moduleName:e.target.value}))} placeholder="Pick a suggestion or type your own"
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, fontSize:14, border:'1.5px solid #e2e8f0' }}/>
            <datalist id="module-suggestions">
              {(SUGGESTED_MODULES[showAssign.stream] || []).map(m => <option key={m} value={m}/>)}
            </datalist>
          </div>
          <Select label="Teacher" value={assignForm.teacherId} onChange={e=>setAssignForm(f=>({...f,teacherId:e.target.value}))}
            options={[{value:'',label:'— Select teacher —'}, ...teachers.map(t=>({value:t.id,label:t.name}))]}/>
          <Btn onClick={doAssign} style={{width:'100%'}}>Assign now</Btn>
        </Modal>
      )}

      {showAdd && (
        <Modal title="Add a class" onClose={()=>setShowAdd(false)} width={420}>
          <ErrorMsg message={err}/>
          <Select label="Level" value={addForm.level} onChange={e=>setAddForm(f=>({...f,level:e.target.value}))}
            options={[1,2,3,4,5,6,7,8,9].map(n=>({value:String(n),label:`Level ${n}`}))}/>
          <Input label="Stream / trade (letters, e.g. SOD)" value={addForm.stream} maxLength={10}
            onChange={e=>setAddForm(f=>({...f,stream:e.target.value.toUpperCase()}))} placeholder="SOD"/>
          <p style={{fontSize:12,color:'#64748b',marginBottom:12}}>
            Promotion moves students from level N to level N+1 of the <b>same stream</b>. A class with no next level graduates its students.
          </p>
          <Btn onClick={doAdd} style={{width:'100%'}}>Create class</Btn>
        </Modal>
      )}
    </Page>
  );
}

// ── TEACHERS ───────────────────────────────────────────────────────────────────
export function AdminTeachers() {
  const { toKigali } = useTime();
  const { data, loading, reload } = useData(api.admin.getTeachers);
  const teachers = useMemo(() => data?.teachers || [], [data]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name:'', email:'', password:'' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [temp, setTemp] = useState(null);

  const handleCreate = async () => {
    setErr('');
    if (!form.name.trim()||!form.email.trim()) return setErr('Name and email are required.');
    setSaving(true);
    try {
      const body = { name: form.name.trim(), email: form.email.trim() };
      if (form.password) body.password = form.password;
      const r = await api.admin.createTeacher(body);
      setShowCreate(false); setForm({name:'',email:'',password:''}); reload(true);
      if (r.tempPassword) setTemp({ who: r.teacher.name, password: r.tempPassword });
    } catch(e){ setErr(e.message); }
    finally{ setSaving(false); }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete ${t.name}? Their modules stay but become unassigned.`)) return;
    try { await api.admin.deleteTeacher(t.id); reload(true); } catch(e){ alert(e.message); }
  };

  return (
    <Page>
      <SectionHeader title="Teachers" subtitle="Manage teacher accounts and access"
        action={<Btn onClick={()=>{setErr('');setShowCreate(true);}}>+ Add Teacher</Btn>}/>
      {loading ? <Spinner/> : teachers.length===0 ? <Empty message="No teachers yet."/> : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {teachers.map(t=>(
            <Card key={t.id} padding="12px 16px">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{t.name} {t.must_change_password && <Badge color="amber">Has not set own password</Badge>}</div>
                  <div style={{fontSize:12,color:'#64748b',wordBreak:'break-all'}}>{t.email} · Joined {toKigali(t.created_at)}</div>
                  {t.modules && <div style={{fontSize:12,color:'#475569',marginTop:4}}>{t.modules.map(m=>`${m.moduleName} (${m.className})`).join(' · ')}</div>}
                </div>
                <Btn size="sm" variant="danger" onClick={()=>handleDelete(t)}>Delete</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Create Teacher Account" onClose={()=>setShowCreate(false)}>
          <ErrorMsg message={err}/>
          <Input label="Full Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required placeholder="Mr./Ms. Full Name"/>
          <Input label="Email" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required placeholder="teacher@school.rw"/>
          <Input label="Password (optional)" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="Leave empty to generate one"/>
          <p style={{fontSize:12,color:'#64748b',marginBottom:12}}>The teacher must choose a new password the first time they sign in.</p>
          <Btn onClick={handleCreate} loading={saving} style={{width:'100%'}}>Create account</Btn>
        </Modal>
      )}
      {temp && <TempPasswordModal who={temp.who} password={temp.password} onClose={()=>setTemp(null)}/>}
    </Page>
  );
}

// ── STUDENTS ───────────────────────────────────────────────────────────────────
const PAGE = 100;

export function AdminStudents() {
  const [filterClass, setFilterClass] = useState('');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [showImport, setShowImport] = useState(false);
  const [moving, setMoving] = useState(null);
  const [temp, setTemp] = useState(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setLimit(PAGE); }, [filterClass, status, debounced]);

  const { data: clsData } = useData(api.admin.getClasses);
  const { data, loading, reload } = useData(
    () => api.admin.getStudents({ classId: filterClass, status, q: debounced, limit }), [filterClass, status, debounced, limit]);
  const classes = useMemo(() => clsData?.classes || [], [clsData]);
  const students = data?.students || [];

  const act = async (fn) => { try { await fn(); reload(true); } catch(e) { alert(e.message); } };
  const deactivate = (s) => window.confirm(`Deactivate ${s.name}? They can no longer sign in. Their grades are kept and you can restore them later.`) && act(() => api.admin.deleteStudent(s.id));
  const erase = (s) => window.confirm(`PERMANENTLY erase ${s.name} and ALL their submissions and grades? This cannot be undone.`) && act(() => api.admin.deleteStudent(s.id, true));
  const reset = async (s) => {
    if (!window.confirm(`Create a new temporary password for ${s.name}?`)) return;
    try { const r = await api.admin.resetUserPassword(s.id); setTemp({ who: s.name, password: r.tempPassword }); } catch(e) { alert(e.message); }
  };

  const badge = (s) => s.status === 'graduated' ? <Badge color="purple">Graduated</Badge> : s.status === 'inactive' ? <Badge color="gray">Inactive</Badge> : null;

  return (
    <Page>
      <SectionHeader title="Students" subtitle={data ? `${data.total} ${status === 'all' ? '' : status} student${data.total === 1 ? '' : 's'}` : ''}
        action={<Btn onClick={()=>setShowImport(true)}>⬆ Import from CSV</Btn>}/>
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
        {[['active','Active'],['graduated','Graduated'],['inactive','Inactive'],['all','All']].map(([k,l]) => (
          <Btn key={k} size="sm" variant={status===k?'primary':'ghost'} onClick={()=>setStatus(k)}>{l}</Btn>
        ))}
      </div>
      <div className="grid-auto" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Input label="" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name or email…"/>
        <Select label="" value={filterClass} onChange={e=>setFilterClass(e.target.value)}
          options={[{value:'',label:'All classes'},...classes.map(c=>({value:c.id,label:c.name}))]}/>
      </div>
      {loading && !data ? <Spinner/> : students.length===0 ? <Empty message="No students found."/> : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {students.map(s=>(
            <Card key={s.id} padding="12px 16px">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{s.name} {badge(s)}</div>
                  <div style={{fontSize:12,color:'#64748b',wordBreak:'break-all'}}>{s.email} · {s.class_name || 'No class'}</div>
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {s.status === 'active' ? <>
                    <Btn size="sm" variant="secondary" onClick={()=>setMoving(s)}>Move class</Btn>
                    <Btn size="sm" variant="warning" onClick={()=>reset(s)}>Reset password</Btn>
                    <Btn size="sm" variant="danger" onClick={()=>deactivate(s)}>Deactivate</Btn>
                  </> : <>
                    <Btn size="sm" variant="success" onClick={()=>act(()=>api.admin.restoreStudent(s.id))}>Restore</Btn>
                    {s.status !== 'graduated' || true ? <Btn size="sm" variant="secondary" onClick={()=>setMoving(s)}>Assign class</Btn> : null}
                  </>}
                  <Btn size="sm" variant="ghost" onClick={()=>erase(s)} style={{color:'#791f1f'}}>Erase</Btn>
                </div>
              </div>
            </Card>
          ))}
          {data && data.total > students.length && (
            <Btn variant="ghost" onClick={()=>setLimit(l=>l+PAGE)}>Show more ({data.total - students.length} left)</Btn>
          )}
        </div>
      )}

      {moving && <MoveModal student={moving} classes={classes} onClose={()=>setMoving(null)} onDone={()=>{setMoving(null);reload(true);}}/>}
      {showImport && <ImportModal classes={classes} onClose={()=>setShowImport(false)} onDone={()=>reload(true)}/>}
      {temp && <TempPasswordModal who={temp.who} password={temp.password} onClose={()=>setTemp(null)}/>}
    </Page>
  );
}

function MoveModal({ student, classes, onClose, onDone }) {
  const [classId, setClassId] = useState(student.class_id || '');
  const [err, setErr] = useState('');
  const save = async () => {
    if (!classId) return setErr('Choose a class.');
    try {
      if (student.status !== 'active') await api.admin.restoreStudent(student.id);
      await api.admin.moveStudent(student.id, classId);
      onDone();
    } catch(e) { setErr(e.message); }
  };
  return (
    <Modal title={`Move ${student.name}`} onClose={onClose} width={420}>
      <ErrorMsg message={err}/>
      <Select label="Class" value={classId} onChange={e=>setClassId(e.target.value)}
        options={[{value:'',label:'— Select class —'},...classes.map(c=>({value:c.id,label:c.name}))]}/>
      {student.status !== 'active' && <Notice tone="info">This will also make the student active again.</Notice>}
      <Btn onClick={save} style={{width:'100%'}}>Save</Btn>
    </Modal>
  );
}

function ImportModal({ classes, onClose, onDone }) {
  const [classId, setClassId] = useState('');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 200000) return setErr('File too large (max 200 KB).');
    const r = new FileReader();
    r.onload = () => { setCsv(String(r.result || '')); setErr(''); };
    r.readAsText(f);
  };

  const run = async () => {
    setErr('');
    if (!classId) return setErr('Choose the class these students belong to.');
    if (!csv.trim()) return setErr('Choose a CSV file or paste the list.');
    setBusy(true);
    try { setResult(await api.admin.importStudents(classId, csv)); onDone(); }
    catch(e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const download = () => saveText(`new-students-${result.class}.csv`,
    'name,email,temporary password\n' + result.created.map(c => `"${c.name.replace(/"/g,'""')}",${c.email},${c.tempPassword}`).join('\n'));

  if (result) return (
    <Modal title="Import finished" onClose={onClose}>
      <Notice tone="ok"><b>{result.created.length}</b> students added to {result.class}. {result.skipped.length > 0 && <>{result.skipped.length} skipped.</>}</Notice>
      {result.created.length > 0 && (
        <>
          <Notice tone="warn">Download the list of temporary passwords now — it is not shown again. Each student must choose their own password at first sign-in.</Notice>
          <Btn onClick={download} style={{width:'100%',marginBottom:12}}>⬇ Download passwords (CSV)</Btn>
        </>
      )}
      {result.skipped.length > 0 && (
        <div style={{maxHeight:160,overflowY:'auto',fontSize:12,color:'#475569',border:'0.5px solid #e2e8f0',borderRadius:8,padding:8}}>
          {result.skipped.map((s,i)=><div key={i}>Row {s.row}: {s.email || '(blank)'} — {s.reason}</div>)}
        </div>
      )}
      <Btn variant="ghost" onClick={onClose} style={{width:'100%',marginTop:12}}>Close</Btn>
    </Modal>
  );

  return (
    <Modal title="Import students from CSV" onClose={onClose}>
      <ErrorMsg message={err}/>
      <p style={{fontSize:13,color:'#475569',marginBottom:12}}>Two columns: <b>name</b>, <b>email</b> (a header row is fine). Up to 200 students at a time. Each gets a random temporary password.</p>
      <Select label="Class" value={classId} onChange={e=>setClassId(e.target.value)}
        options={[{value:'',label:'— Select class —'},...classes.map(c=>({value:c.id,label:c.name}))]}/>
      <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{marginBottom:10,fontSize:14}}/>
      <textarea value={csv} onChange={e=>setCsv(e.target.value)} rows={6} placeholder={'name,email\nAline Uwase,aline@example.com'}
        style={{width:'100%',padding:'9px 12px',borderRadius:8,fontSize:13,border:'1.5px solid #e2e8f0',fontFamily:'monospace',marginBottom:12}}/>
      <Btn onClick={run} loading={busy} style={{width:'100%'}}>Import</Btn>
    </Modal>
  );
}

// ── ANNOUNCEMENTS ──────────────────────────────────────────────────────────────
export function AdminAnnouncements() {
  const { toKigali } = useTime();
  const { data, loading, reload } = useData(api.admin.getAnnouncements);
  const announcements = useMemo(() => data?.announcements || [], [data]);

  const [showCreate, setShowCreate] = useState(false);
  const [body, setBody]   = useState('');
  const [err,  setErr]    = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState({});      // id → replies[] | null (open)

  const handlePost = async () => {
    if (!body.trim()) return;
    setSaving(true); setErr('');
    try { await api.admin.postAnnouncement(body.trim()); setShowCreate(false); setBody(''); reload(true); }
    catch(e){ setErr(e.message); }
    finally{ setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this announcement and its replies?')) return;
    try { await api.admin.deleteAnnouncement(id); reload(true); } catch(e){ alert(e.message); }
  };

  const toggle = async (id) => {
    if (open[id]) return setOpen(o => ({ ...o, [id]: undefined }));
    try { const r = await api.admin.getReplies(id); setOpen(o => ({ ...o, [id]: r.replies })); } catch(e) { alert(e.message); }
  };
  const sendReply = async (id, text) => {
    await api.admin.postReply(id, text);
    const r = await api.admin.getReplies(id);
    setOpen(o => ({ ...o, [id]: r.replies }));
    reload(true);
  };

  return (
    <Page>
      <SectionHeader title="Announcements" subtitle="School-wide announcements visible to all students and teachers"
        action={<Btn onClick={()=>{setErr('');setShowCreate(true);}}>+ Post New</Btn>}/>
      {loading ? <Spinner/> : announcements.length===0 ? <Empty message="No announcements."/> : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {announcements.map(ann=>(
            <Card key={ann.id} padding="16px 18px">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8,flexWrap:'wrap'}}>
                <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
                  <Badge color="red">🏫 Admin</Badge>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{toKigali(ann.created_at)}</span>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <Btn size="sm" variant="secondary" onClick={()=>setEditing(ann)}>Edit</Btn>
                  <Btn size="sm" variant="danger" onClick={()=>handleDelete(ann.id)}>Delete</Btn>
                </div>
              </div>
              <p style={{fontSize:14,color:'#1e293b',lineHeight:1.6,margin:0,whiteSpace:'pre-wrap',wordBreak:'break-word'}}><Linkify text={ann.body} /></p>
              <div style={{marginTop:10}}>
                <Btn size="sm" variant="ghost" onClick={()=>toggle(ann.id)}>💬 Replies ({ann.reply_count})</Btn>
              </div>
              {open[ann.id] && <ReplyThread replies={open[ann.id]} onSend={(t)=>sendReply(ann.id, t)}/>}
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Post School Announcement" onClose={()=>setShowCreate(false)}>
          <ErrorMsg message={err}/>
          <textarea value={body} onChange={e=>setBody(e.target.value)} rows={6} maxLength={5000} placeholder="Type announcement here..."
            style={{width:'100%',padding:'9px 12px',borderRadius:8,fontSize:14,border:'1.5px solid #e2e8f0',marginBottom:12}}/>
          <Btn onClick={handlePost} loading={saving} style={{width:'100%'}}>Post to everyone</Btn>
        </Modal>
      )}
      {editing && <EditTextModal title="Edit announcement" initial={editing.body}
        onSave={async (t)=>{ await api.admin.editAnnouncement(editing.id, t); reload(true); }} onClose={()=>setEditing(null)}/>}
    </Page>
  );
}

// ── PASSWORD REQUESTS & RESET ─────────────────────────────────────────────────
export function AdminPasswordReset() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [resetting, setResetting] = useState('');
  const [temp, setTemp] = useState(null);

  const { data: reqData, reload: reqReload } = useData(api.admin.passwordRequests, [], 30000);
  const { data: trData, loading: trLoading } = useData(api.admin.getTeachers);
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(searchTerm), 300); return () => clearTimeout(t); }, [searchTerm]);
  const { data: stData, loading: stLoading } = useData(() => api.admin.getStudents({ q: debounced, limit: 50 }), [debounced]);

  const requests = reqData?.requests || [];
  const users = useMemo(() => {
    const t = (trData?.teachers || []).map(u => ({ ...u, role: 'teacher', info: 'Teacher' }));
    const s = (stData?.students || []).map(u => ({ ...u, role: 'student', info: u.class_name || '' }));
    const term = searchTerm.toLowerCase();
    return [...t, ...s].filter(u => (!filterRole || u.role === filterRole) &&
      (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)));
  }, [trData, stData, searchTerm, filterRole]);

  const doReset = async (id, name) => {
    if (!window.confirm(`Create a new temporary password for ${name}? Their current password stops working immediately.`)) return;
    setResetting(id);
    try {
      const res = await api.admin.resetUserPassword(id);
      setTemp({ who: name, password: res.tempPassword });
      reqReload(true);
    } catch (e) { alert(e.message); }
    finally { setResetting(''); }
  };

  return (
    <Page>
      <SectionHeader title="Password Requests" subtitle="Give people a temporary password in person. They choose their own at first sign-in."/>

      {requests.length > 0 && (
        <Card style={{marginBottom:20, border:'1px solid #fac775', background:'#fffbf2'}}>
          <h3 style={{fontSize:14,fontWeight:700,color:'#633806',marginBottom:10}}>Waiting for a reset ({requests.length})</h3>
          {requests.map(r => (
            <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 0',borderTop:'0.5px solid #f1e3c4'}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600}}>{r.name} <Badge color={r.role==='teacher'?'green':'blue'}>{r.role}</Badge></div>
                <div style={{fontSize:12,color:'#64748b',wordBreak:'break-all'}}>{r.email}{r.class_name ? ` · ${r.class_name}` : ''}</div>
              </div>
              <div style={{display:'flex',gap:6}}>
                <Btn size="sm" variant="warning" loading={resetting===r.user_id} onClick={()=>doReset(r.user_id, r.name)}>Reset</Btn>
                <Btn size="sm" variant="ghost" onClick={async()=>{ try{ await api.admin.dismissPasswordRequest(r.id); reqReload(true);}catch(e){alert(e.message);} }}>Dismiss</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card style={{marginBottom: 20}}>
        <div className="grid-auto" style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:12}}>
          <Input label="Find anyone" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Name or email…"/>
          <Select label="Role" value={filterRole} onChange={e => setFilterRole(e.target.value)}
            options={[{value:'',label:'All'},{value:'teacher',label:'Teachers'},{value:'student',label:'Students'}]}/>
        </div>
      </Card>

      {(trLoading || stLoading) && !stData ? <Spinner/> : users.length === 0 ? <Empty message="No users match."/> : (
        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {users.map(u => (
            <Card key={u.id} padding="12px 16px">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14, fontWeight:600}}>{u.name} <Badge color={u.role === 'teacher' ? 'green' : 'blue'}>{u.role}</Badge></div>
                  <div style={{fontSize:12, color:'#64748b', wordBreak:'break-all'}}>{u.email}{u.role==='student' && u.info ? ` · ${u.info}` : ''}</div>
                </div>
                <Btn size="sm" variant="warning" loading={resetting===u.id} onClick={() => doReset(u.id, u.name)}>Reset password</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
      {temp && <TempPasswordModal who={temp.who} password={temp.password} onClose={()=>setTemp(null)}/>}
    </Page>
  );
}

// ── NEW ACADEMIC YEAR / PROMOTION ─────────────────────────────────────────────
export function AdminPromotion({ setActivePage }) {
  const { data, loading, reload, error } = useData(api.admin.promotionPreview);
  const { data: hist, reload: histReload } = useData(api.admin.promotionHistory);
  const [yearName, setYearName] = useState('');
  const [hold, setHold] = useState(new Set());
  const [resetCodes, setResetCodes] = useState(true);
  const [openCls, setOpenCls] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => { if (data && !yearName) setYearName(data.suggestedNextYear || ''); }, [data, yearName]);

  const classes = data?.classes || [];
  const totals = useMemo(() => {
    let promote = 0, repeat = 0, graduate = 0;
    classes.forEach(c => c.students.forEach(s => {
      if (hold.has(s.id)) repeat++; else if (c.target) promote++; else graduate++;
    }));
    return { promote, repeat, graduate };
  }, [classes, hold]);

  const toggleHold = (id) => setHold(h => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const commit = async () => {
    setErr('');
    if (!yearName.trim()) return setErr('Name the new academic year (e.g. 2027).');
    const msg = `Start academic year "${yearName.trim()}"?\n\n• ${totals.promote} students move up\n• ${totals.repeat} repeat their class\n• ${totals.graduate} graduate (read-only access for 12 months)\n${resetCodes ? '• All join codes are replaced\n' : ''}\nLast year's work and grades are kept. You can undo this until a teacher adds new work.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const r = await api.admin.promotionCommit({ newYearName: yearName.trim(), holdBackIds: [...hold], resetCodes });
      setDone(r); setHold(new Set()); setYearName(''); reload(true); histReload(true);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    if (!window.confirm('Undo the last promotion? Students go back to their previous classes and the previous year becomes current again.')) return;
    setErr('');
    try {
      const r = await api.admin.promotionUndo(data.lastBatch.id);
      setDone({ message: r.skipped ? `Undone. ${r.skipped} students were left where they are because you had already moved them.` : r.message });
      reload(true); histReload(true); setYearName('');
    } catch (e) { setErr(e.message); }
  };

  if (loading && !data) return <Page><Spinner/></Page>;
  if (error && !data) return <Page><ErrorMsg message={error}/></Page>;

  const lb = data?.lastBatch;

  return (
    <Page>
      <SectionHeader title="New Academic Year" subtitle={`Current year: ${data?.currentYear || '—'}`}/>
      <ErrorMsg message={err}/>
      {done && <Notice tone="ok">{done.message} {done.promoted !== undefined && `Moved up: ${done.promoted}, repeating: ${done.repeated}, graduated: ${done.graduated}.`}</Notice>}

      {lb && (
        <Card style={{marginBottom:16,background:'#f8fafc'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <div style={{fontSize:13,color:'#334155'}}>
              Last promotion: <b>{lb.from_year} → {lb.to_year}</b> ({lb.promoted} up, {lb.repeated} repeat, {lb.graduated} graduated)
            </div>
            {lb.canUndo ? <Btn size="sm" variant="danger" onClick={undo}>Undo</Btn>
              : <span style={{fontSize:12,color:'#64748b'}}>Can no longer be undone — work has been added to the new year.</span>}
          </div>
        </Card>
      )}

      <Card style={{marginBottom:16}}>
        <h3 style={{fontSize:15,fontWeight:700,marginBottom:6}}>What happens</h3>
        <ul style={{fontSize:13,color:'#475569',lineHeight:1.7,paddingLeft:18}}>
          <li>Each student moves to the next level of the <b>same stream</b> (L3-SOD → L4-SOD).</li>
          <li>Classes with no next level <b>graduate</b>. Graduates keep read-only access to their results for 12 months, then are blocked.</li>
          <li>Last year's assignments, quizzes and grades are <b>kept</b> and appear under that year in reports and results. The new year starts empty; learning materials carry over.</li>
          <li>Tick anyone below who must <b>repeat</b> their class.</li>
        </ul>
      </Card>

      <Card style={{marginBottom:16}}>
        <Input label="Name of the new academic year" value={yearName} onChange={e=>setYearName(e.target.value)} placeholder="e.g. 2027" maxLength={30}/>
        <label style={{display:'flex',gap:8,alignItems:'center',fontSize:14,cursor:'pointer',minHeight:32}}>
          <input type="checkbox" checked={resetCodes} onChange={e=>setResetCodes(e.target.checked)} style={{width:18,height:18}}/>
          Replace all class join codes (recommended — last year's codes stop working)
        </label>
      </Card>

      <h3 style={{fontSize:14,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.5px',margin:'20px 0 10px'}}>Preview</h3>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {classes.filter(c => c.students.length > 0).map(c => {
          const held = c.students.filter(s => hold.has(s.id)).length;
          return (
            <Card key={c.id} padding="12px 16px">
              <button onClick={()=>setOpenCls(o=>({...o,[c.id]:!o[c.id]}))} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,background:'none',border:'none',cursor:'pointer',textAlign:'left',padding:0,minHeight:36}}>
                <span style={{fontSize:14,fontWeight:700,color:'#0c447c'}}>{c.name} <span style={{color:'#64748b',fontWeight:400}}>→</span> {c.target ? c.target.name : <Badge color="purple">Graduate</Badge>}</span>
                <span style={{fontSize:12,color:'#64748b'}}>{c.students.length} students{held ? ` · ${held} repeating` : ''} {openCls[c.id] ? '▲' : '▼'}</span>
              </button>
              {openCls[c.id] && (
                <div style={{marginTop:8,borderTop:'0.5px solid #e2e8f0'}}>
                  {c.students.map(s => (
                    <label key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',fontSize:13,cursor:'pointer',borderBottom:'0.5px solid #f1f5f9'}}>
                      <input type="checkbox" checked={hold.has(s.id)} onChange={()=>toggleHold(s.id)} style={{width:18,height:18,flexShrink:0}}/>
                      <span style={{flex:1,minWidth:0}}>{s.name}</span>
                      {hold.has(s.id) && <Badge color="amber">Repeats</Badge>}
                    </label>
                  ))}
                  <div style={{fontSize:11,color:'#94a3b8',paddingTop:6}}>Tick = repeats {c.name} instead of moving on.</div>
                </div>
              )}
            </Card>
          );
        })}
        {classes.every(c => c.students.length === 0) && <Empty message="No active students to promote."/>}
      </div>

      <Card style={{marginTop:16,position:'sticky',bottom:'calc(72px + env(safe-area-inset-bottom,0px))',boxShadow:'0 -4px 16px rgba(0,0,0,.08)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <div style={{fontSize:13,color:'#334155'}}>
            <b>{totals.promote}</b> move up · <b>{totals.repeat}</b> repeat · <b>{totals.graduate}</b> graduate
          </div>
          <Btn variant="danger" onClick={commit} loading={busy}>Start new academic year</Btn>
        </div>
      </Card>

      {hist?.history?.length > 0 && (
        <div style={{marginTop:24}}>
          <h3 style={{fontSize:14,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>History</h3>
          {hist.history.map(h => (
            <div key={h.id} style={{fontSize:13,color:'#475569',padding:'6px 0',borderBottom:'0.5px solid #e2e8f0'}}>
              {new Date(h.created_at).toLocaleDateString('en-GB')} — {h.from_year} → {h.to_year}: {h.promoted} up, {h.repeated} repeat, {h.graduated} graduated
            </div>
          ))}
        </div>
      )}
      <div style={{height:10}}/>
      <button onClick={()=>setActivePage('students')} style={{background:'none',border:'none',color:'#185fa5',cursor:'pointer',fontSize:13,padding:'10px 0'}}>Manage graduates under Students → Graduated</button>
    </Page>
  );
}

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────
const LABELS = {
  'student.deactivate':'Deactivated student', 'student.restore':'Restored student', 'student.move':'Moved student',
  'student.delete_permanent':'ERASED student', 'student.import':'Imported students', 'teacher.create':'Created teacher',
  'teacher.delete':'Deleted teacher', 'user.reset_password':'Reset password', 'class.create':'Created class',
  'class.reset_code':'New join code', 'class.reset_all_codes':'Reset all join codes', 'module.assign':'Assigned module',
  'promotion.commit':'Started new academic year', 'promotion.undo':'Undid promotion', 'announcement.delete':'Deleted announcement',
};
export function AdminActivity() {
  const { data, loading } = useData(()=>api.admin.audit(200), [], 60000);
  const { toKigali } = useTime();
  return (
    <Page>
      <SectionHeader title="Activity Log" subtitle="Who changed what — the 200 most recent actions"/>
      {loading ? <Spinner/> : !data?.entries?.length ? <Empty message="Nothing recorded yet."/> : (
        <Card padding="4px 16px">
          {data.entries.map(e => (
            <div key={e.id} style={{padding:'10px 0',borderBottom:'0.5px solid #f1f5f9',fontSize:13}}>
              <div style={{fontWeight:600,color:'#0f172a'}}>{LABELS[e.action] || e.action}{e.target ? <span style={{fontWeight:400,color:'#475569',wordBreak:'break-all'}}> · {e.target}</span> : null}</div>
              <div style={{fontSize:12,color:'#94a3b8'}}>{e.actor_name || 'System'} · {toKigali(e.created_at)}</div>
            </div>
          ))}
        </Card>
      )}
    </Page>
  );
}

export { CopyBtn };
