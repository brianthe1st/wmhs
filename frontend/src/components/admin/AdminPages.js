import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../../utils/api';
import { useTime } from '../../context/TimeContext';
import {
  Page, Card, Btn, Badge, Input, Select, Textarea, Modal, StatCard,
  SectionHeader, Empty, ErrorMsg, Spinner, Linkify
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
export function AdminDashboard({ setActivePage }) {
  const { data, loading } = useData(api.admin.stats);
  return (
    <Page>
      <SectionHeader title="Admin Dashboard" subtitle="World Mission High School overview"/>
      {loading ? <Spinner/> : (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:14,marginBottom:28}}>
            <StatCard label="Classes"   value={data?.classes}   bg="#e6f1fb" color="#0c447c"/>
            <StatCard label="Teachers"  value={data?.teachers}  bg="#e1f5ee" color="#085041"/>
            <StatCard label="Students"  value={data?.students}  bg="#eeedfe" color="#3c3489"/>
            <StatCard label="Work Items" value={data?.workItems} bg="#faeeda" color="#633806"/>
          </div>
          <Card>
            <h3 style={{fontSize:15,fontWeight:600,color:'#0f172a',marginBottom:14}}>Quick Actions</h3>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))',gap:8}}>
              {[
                {label:'Manage Classes & Join Codes', page:'classes',       color:'#0c447c', bg:'#e6f1fb'},
                {label:'Add a Teacher Account',       page:'teachers',      color:'#085041', bg:'#e1f5ee'},
                {label:'View All Students',           page:'students',      color:'#3c3489', bg:'#eeedfe'},
                {label:'Post Announcement',           page:'announcements', color:'#633806', bg:'#faeeda'},
              ].map(a=>(
                <button key={a.page} onClick={()=>setActivePage(a.page)}
                  style={{background:a.bg,border:'none',color:a.color,borderRadius:8,
                    padding:'12px 16px',cursor:'pointer',textAlign:'left',fontSize:13,fontWeight:500}}>
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
export function AdminClasses() {
  const { data, loading, reload } = useData(api.admin.getClasses);
  const { data: trData }          = useData(api.admin.getTeachers);
  const teachers = useMemo(() => trData?.teachers || [], [trData]);
  const [showAssign, setShowAssign] = useState(null);
  const [assignForm, setAssignForm] = useState({ moduleName:'', teacherId:'' });
  const [err, setErr] = useState('');
  const [actioning, setActioning] = useState('');

  useEffect(() => {
    if (showAssign) {
      setAssignForm({ moduleName: '', teacherId: '' });
      setErr('');
    }
  }, [showAssign]);

  const STREAM_MODULES = {
    SOD: ['Networking','Programming','Web Development','Databases','Operating Systems','Software Engineering'],
    NIT: ['Networking','Databases','IT Support','Programming','Cybersecurity','Cloud Computing'],
    MMP: ['Multimedia Production','Graphic Design','Web Development','Photography','Video Editing','Animation'],
  };

  const doReset  = async (id) => { setActioning(id+'reset');  try{await api.admin.resetCode(id); reload();}catch(e){alert(e.message);}finally{setActioning('');} };
  const doToggle = async (id) => { setActioning(id+'toggle'); try{await api.admin.toggleCode(id); reload();}catch(e){alert(e.message);}finally{setActioning('');} };

  const doAssign = async () => {
    setErr('');
    if (!assignForm.moduleName||!assignForm.teacherId) return setErr('All fields required.');
    try {
      await api.admin.assignModule({ classId: showAssign.id, moduleName: assignForm.moduleName, teacherId: assignForm.teacherId });
      setShowAssign(null); reload();
    } catch(e) { setErr(e.message); }
  };

  const classes = useMemo(() => data?.classes || [], [data]);
  if (loading) return <Page><Spinner/></Page>;

  return (
    <Page>
      <SectionHeader title="Classes & Join Codes" subtitle="Manage all 9 classes, codes, and module assignments"/>
      {[3,4,5].map(level=>(
        <div key={level} style={{marginBottom:28}}>
          <h3 style={{fontSize:14,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:12}}>Level {level}</h3>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))',gap:14}}>
            {classes.filter(c=>c.level===level).map(cls=>(
              <Card key={cls.id} padding="14px 16px">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                  <h4 style={{fontSize:15,fontWeight:700,color:'#0c447c',margin:0}}>{cls.name}</h4>
                  <Badge color={cls.code_active?'green':'red'}>{cls.code_active?'Active':'Disabled'}</Badge>
                </div>
                <div style={{background:'#f0f7ff',borderRadius:7,padding:'8px 10px',marginBottom:10,border:'0.5px solid #bfdbfe'}}>
                  <div style={{fontSize:11,color:'#64748b',marginBottom:2,fontWeight:600}}>JOIN CODE</div>
                  <div style={{fontSize:20,fontWeight:800,color:'#1e293b',letterSpacing:'1px'}}>{cls.join_code}</div>
                </div>
                <div style={{display:'flex',gap:6,marginBottom:12}}>
                  <Btn size="sm" variant="secondary" onClick={()=>doReset(cls.id)} loading={actioning===cls.id+'reset'}>Reset</Btn>
                  <Btn size="sm" variant={cls.code_active?'danger':'success'} onClick={()=>doToggle(cls.id)} loading={actioning===cls.id+'toggle'}>
                    {cls.code_active?'Disable':'Enable'}
                  </Btn>
                </div>
                <div style={{borderTop:'0.5px solid #e2e8f0',paddingTop:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#64748b',marginBottom:6}}>MODULES</div>
                  {(!cls.modules || cls.modules.length===0) ? <div style={{fontSize:12,color:'#94a3b8'}}>No modules</div> : cls.modules.map(m=>(
                    <div key={m.id} style={{fontSize:12,color:'#334155',marginBottom:3,display:'flex',justifyContent:'space-between'}}>
                      <span>{m.name}</span>
                      <span style={{color:'#94a3b8'}}>{m.teacher_name}</span>
                    </div>
                  ))}
                  <Btn size="sm" variant="ghost" style={{width:'100%',marginTop:8,fontSize:11}} onClick={()=>setShowAssign(cls)}>+ Assign Module</Btn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {showAssign && (
        <Modal title={`Assign Module to ${showAssign.name}`} onClose={()=>setShowAssign(null)}>
          <ErrorMsg message={err}/>
          <Select label="Module Name" value={assignForm.moduleName} onChange={e=>setAssignForm(f=>({...f,moduleName:e.target.value}))}
            options={[{value:'',label:'— Select module —'}, ...STREAM_MODULES[showAssign.stream].map(m=>({value:m,label:m}))]}/>
          <Select label="Teacher" value={assignForm.teacherId} onChange={e=>setAssignForm(f=>({...f,teacherId:e.target.value}))}
            options={[{value:'',label:'— Select teacher —'}, ...teachers.map(t=>({value:t.id,label:t.name}))]}/>
          <Btn onClick={doAssign} style={{width:'100%'}}>Assign Now</Btn>
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

  const handleCreate = async () => {
    setErr('');
    if (!form.name||!form.email||!form.password) return setErr('All fields required.');
    setSaving(true);
    try { await api.admin.createTeacher(form); setShowCreate(false); setForm({name:'',email:'',password:''}); reload(); }
    catch(e){ setErr(e.message); }
    finally{ setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this teacher account?')) return;
    try { await api.admin.deleteTeacher(id); reload(); } catch(e){ alert(e.message); }
  };

  return (
    <Page>
      <SectionHeader title="Teachers" subtitle="Manage teacher accounts and access"
        action={<Btn onClick={()=>setShowCreate(true)}>+ Add Teacher</Btn>}/>
      {loading ? <Spinner/> : teachers.length===0 ? <Empty message="No teachers found."/> : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {teachers.map(t=>(
            <Card key={t.id} padding="12px 16px">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{t.name}</div>
                  <div style={{fontSize:12,color:'#64748b'}}>{t.email} · Joined {toKigali(t.created_at)}</div>
                </div>
                <Btn size="sm" variant="danger" onClick={()=>handleDelete(t.id)}>Delete</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Create Teacher Account" onClose={()=>setShowCreate(null)}>
          <ErrorMsg message={err}/>
          <Input label="Full Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required placeholder="Mr./Ms. Full Name"/>
          <Input label="Email" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required placeholder="teacher@wmhs.ac.rw"/>
          <Input label="Temporary Password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} required placeholder="Min. 6 characters"/>
          <Btn onClick={handleCreate} loading={saving} style={{width:'100%'}}>Create Account</Btn>
        </Modal>
      )}
    </Page>
  );
}

// ── STUDENTS ───────────────────────────────────────────────────────────────────
export function AdminStudents() {
  const [filterClass, setFilterClass] = useState('');
  const { data: clsData } = useData(api.admin.getClasses);
  const { data, loading, reload }    = useData(()=>api.admin.getStudents(filterClass), [filterClass]);
  const classes = useMemo(() => clsData?.classes || [], [clsData]);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this student?')) return;
    try { await api.admin.deleteStudent(id); reload(); } catch(e) { alert(e.message); }
  };

  return (
    <Page>
      <SectionHeader title="All Students"/>
      <div style={{marginBottom:16}}>
        <Select label="" value={filterClass} onChange={e=>setFilterClass(e.target.value)}
          options={[{value:'',label:'All Classes'},...classes.map(c=>({value:c.id,label:c.name}))]}/>
      </div>
      {loading ? <Spinner/> : (
        (data?.students||[]).length===0 ? <Empty message="No students found."/> : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {data.students.map(s=>(
              <Card key={s.id} padding="12px 16px">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{s.name}</div>
                    <div style={{fontSize:12,color:'#64748b'}}>{s.email} · {s.class_name}</div>
                  </div>
                  <Btn size="sm" variant="danger" onClick={()=>handleDelete(s.id)}>Remove</Btn>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </Page>
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

  const handlePost = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try { await api.admin.postAnnouncement(body.trim()); setShowCreate(false); setBody(''); reload(); }
    catch(e){ setErr(e.message); }
    finally{ setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete announcement?')) return;
    try { await api.admin.deleteAnnouncement(id); reload(); } catch(e){ alert(e.message); }
  };

  return (
    <Page>
      <SectionHeader title="Announcements" subtitle="School-wide announcements visible to all students and teachers"
        action={<Btn onClick={()=>setShowCreate(true)}>+ Post New</Btn>}/>
      {loading ? <Spinner/> : announcements.length===0 ? <Empty message="No announcements."/> : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {announcements.map(ann=>(
            <Card key={ann.id} padding="16px 18px">

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{display:'flex', gap:6, alignItems:'center'}}>
                  <Badge color="red">🏫 Admin</Badge>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{toKigali(ann.created_at)}</span>
                </div>
                <Btn size="sm" variant="danger" onClick={()=>handleDelete(ann.id)}>Delete</Btn>
              </div>
              <p style={{fontSize:14,color:'#1e293b',lineHeight:1.6,margin:0}}>
                <Linkify text={ann.body} />
              </p>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Post School Announcement" onClose={()=>setShowCreate(null)}>
          <ErrorMsg message={err}/>
          <Textarea label="Message" value={body} onChange={e=>setBody(e.target.value)} placeholder="Type announcement here..." required/>
          <Btn onClick={handlePost} loading={saving} style={{width:'100%'}}>Post to Everyone</Btn>
        </Modal>
      )}
    </Page>
  );
}

// ── PASSWORD RESET ─────────────────────────────────────────────────────────────
export function AdminPasswordReset() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [resetting, setResetting] = useState('');

  const { data: clsData } = useData(api.admin.getClasses);
  const { data: trData, loading: trLoading, reload: trReload } = useData(api.admin.getTeachers);
  const { data: stData, loading: stLoading, reload: stReload } = useData(() => api.admin.getStudents(), []);

  const classes = useMemo(() => clsData?.classes || [], [clsData]);
  const teachers = useMemo(() => trData?.teachers || [], [trData]);
  const students = useMemo(() => stData?.students || [], [stData]);

  // Merge all users for searching
  const allUsers = useMemo(() => {
    const t = teachers.map(u => ({ ...u, role: 'teacher', displayRole: 'Teacher', displayClass: '-' }));
    const s = students.map(u => ({ ...u, role: 'student', displayRole: 'Student', displayClass: u.class_name }));
    return [...t, ...s];
  }, [teachers, students]);

  const filteredUsers = useMemo(() => {
    return allUsers.filter(u => {
      const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           u.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = !filterRole || u.role === filterRole;
      const matchesClass = !filterClass || u.class_id === filterClass;
      return matchesSearch && matchesRole && matchesClass;
    });
  }, [allUsers, searchTerm, filterRole, filterClass]);

  const handleReset = async (user) => {
    if (!window.confirm(`Are you sure you want to reset password for ${user.name}? The new password will be '1234567'.`)) return;
    setResetting(user.id);
    try {
      const res = await api.admin.resetUserPassword(user.id);
      alert(res.message);
      if (user.role === 'teacher') trReload(true);
      else stReload(true);
    } catch (e) {
      alert(e.message);
    } finally {
      setResetting('');
    }
  };

  const isLoading = trLoading || stLoading;

  return (
    <Page>
      <SectionHeader title="Password Reset" subtitle="Reset any teacher or student password to '1234567'"/>
      
      <Card style={{marginBottom: 20}}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12}}>
          <Input 
            label="Search Name or Email" 
            value={searchTerm} 
            onChange={e => setSearchTerm(e.target.value)} 
            placeholder="Search..."
          />
          <Select 
            label="Filter by Role" 
            value={filterRole} 
            onChange={e => setFilterRole(e.target.value)}
            options={[
              {value:'', label:'All Roles'},
              {value:'teacher', label:'Teachers'},
              {value:'student', label:'Students'}
            ]}
          />
          <Select 
            label="Filter by Class" 
            value={filterClass} 
            onChange={e => setFilterClass(e.target.value)}
            options={[
              {value:'', label:'All Classes'},
              ...classes.map(c => ({value:c.id, label:c.name}))
            ]}
          />
        </div>
      </Card>

      {isLoading ? <Spinner/> : (
        filteredUsers.length === 0 ? <Empty message="No users found matching your filters."/> : (
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {filteredUsers.map(user => (
              <Card key={user.id} padding="12px 16px">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:14, fontWeight:600, color:'#0f172a'}}>
                      {user.name} <Badge color={user.role === 'teacher' ? 'green' : 'blue'} style={{marginLeft:6}}>{user.displayRole}</Badge>
                    </div>
                    <div style={{fontSize:12, color:'#64748b'}}>{user.email} {user.role === 'student' && `· ${user.displayClass}`}</div>
                  </div>
                  <Btn 
                    size="sm" 
                    variant="warning" 
                    onClick={() => handleReset(user)}
                    loading={resetting === user.id}
                  >
                    Reset Password
                  </Btn>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </Page>
  );
}

