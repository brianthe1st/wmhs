import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Logo, Btn, Input, ErrorMsg } from './shared/UI';

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode]     = useState('login');
  const [form, setForm]     = useState({ email:'', password:'', name:'', joinCode:'', confirm:'' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(form.email.trim(), form.password); }
    catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault(); setError('');
    if (!form.name.trim())      return setError('Please enter your full name.');
    if (!form.email.trim())     return setError('Please enter your email.');
    if (form.password.length<6) return setError('Password must be at least 6 characters.');
    if (form.password!==form.confirm) return setError('Passwords do not match.');
    if (!form.joinCode.trim())  return setError('Please enter your class join code.');
    setLoading(true);
    try { await register(form.name.trim(), form.email.trim(), form.password, form.joinCode.trim()); }
    catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-container" style={{ minHeight:'100vh',
      background:'linear-gradient(135deg,#dbeafe 0%,#f0f7ff 60%,#e0f2fe 100%)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
      fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <Logo size={72}/>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#0c447c', margin:'10px 0 2px' }}>
            World Mission High School
          </h1>
          <p style={{ fontSize:13, color:'#64748b' }}>Student & Staff Portal</p>
        </div>

        <div style={{ background:'#fff', borderRadius:16, border:'0.5px solid #bfdbfe', overflow:'hidden' }}>
          <div style={{ display:'flex', borderBottom:'0.5px solid #e2e8f0' }}>
            {[{key:'login',label:'Sign In'},{key:'register',label:'Join as Student'}].map(t=>(
              <button key={t.key} onClick={()=>{setMode(t.key);setError('');}}
                style={{ flex:1, padding:14, border:'none', cursor:'pointer', fontSize:14, fontWeight:600,
                  background:mode===t.key?'#fff':'#f8fafc',
                  color:mode===t.key?'#185fa5':'#64748b',
                  borderBottom:mode===t.key?'2px solid #185fa5':'2px solid transparent',
                  transition:'all .15s' }}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ padding:24 }}>
            <ErrorMsg message={error}/>
            {mode==='login' ? (
              <form onSubmit={handleLogin}>
                <Input label="Email" type="email" value={form.email}
                  onChange={e=>set('email',e.target.value)} placeholder="you@wmhs.ac.rw" required/>
                <Input label="Password" type="password" value={form.password}
                  onChange={e=>set('password',e.target.value)} placeholder="••••••••" required/>
                <Btn type="submit" style={{width:'100%'}} size="lg" loading={loading}>Sign In</Btn>
              </form>
            ) : (
              <form onSubmit={handleRegister}>
                <Input label="Full Name" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Your full name" required/>
                <Input label="Email" type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="you@student.wmhs.ac.rw" required/>
                <Input label="Class Join Code" value={form.joinCode} onChange={e=>set('joinCode',e.target.value)} placeholder="e.g. XK7-R2" required/>
                <Input label="Password" type="password" value={form.password} onChange={e=>set('password',e.target.value)} placeholder="Min. 6 characters" required/>
                <Input label="Confirm Password" type="password" value={form.confirm} onChange={e=>set('confirm',e.target.value)} placeholder="Repeat password" required/>
                <Btn type="submit" style={{width:'100%'}} size="lg" loading={loading}>Create Account</Btn>
                <p style={{fontSize:12,color:'#64748b',textAlign:'center',marginTop:10}}>
                  Your join code is given to you by the school admin.
                </p>
              </form>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
