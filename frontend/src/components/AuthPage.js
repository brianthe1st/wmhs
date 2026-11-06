import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { Logo, Btn, Input, ErrorMsg, Notice } from './shared/UI';

const PW_RULE = 'At least 8 characters, with a letter and a number.';
const pwProblem = (p) => {
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password needs at least one letter and one number.';
  return '';
};

// Same screen for sign in, sign up and "forgot password": left half solid blue, right half white.
export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode]     = useState('login');           // login | register | forgot
  const [form, setForm]     = useState({ email:'', password:'', name:'', joinCode:'', confirm:'' });
  const [error, setError]   = useState('');
  const [info, setInfo]     = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const go = (m) => { setMode(m); setError(''); setInfo(''); };

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
    const pp = pwProblem(form.password);
    if (pp) return setError(pp);
    if (form.password!==form.confirm) return setError('Passwords do not match.');
    if (!form.joinCode.trim())  return setError('Please enter your class join code.');
    setLoading(true);
    try { await register(form.name.trim(), form.email.trim(), form.password, form.joinCode.trim()); }
    catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleForgot = async (e) => {
    e.preventDefault(); setError(''); setInfo('');
    if (!form.email.trim()) return setError('Enter the email you signed up with.');
    setLoading(true);
    try { const r = await api.auth.forgot(form.email.trim()); setInfo(r.message); }
    catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const tabStyle = (active) => ({
    flex:1, padding:'12px 8px', border:'none', cursor:'pointer', fontSize:15, fontWeight:600, background:'none',
    color: active ? '#0c2b54' : '#64748b',
    borderBottom: active ? '3px solid #0c2b54' : '3px solid #e2e8f0', minHeight:46,
  });

  return (
    <div className="auth-split" style={{ fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      {/* LEFT / TOP — solid deep blue */}
      <div className="auth-left">
        <Logo size={110}/>
        <h1 className="auth-title" style={{ fontSize:30, fontWeight:700, margin:'18px 0 8px', lineHeight:1.2 }}>
          World Mission High School
        </h1>
        <p className="auth-motto" style={{ fontSize:16, fontStyle:'italic', opacity:.92, maxWidth:340 }}>
          Visionary Minds, Creative Innovations
        </p>
        <p className="auth-motto" style={{ fontSize:13, opacity:.75, marginTop:14 }}>Student &amp; Staff Portal</p>
      </div>

      {/* RIGHT / BOTTOM — white */}
      <div className="auth-right">
        <div className="auth-form-wrap">
          {mode !== 'forgot' && (
            <div style={{ display:'flex', marginBottom:24 }}>
              <button type="button" style={tabStyle(mode==='login')} onClick={()=>go('login')}>Sign In</button>
              <button type="button" style={tabStyle(mode==='register')} onClick={()=>go('register')}>Join as Student</button>
            </div>
          )}

          <ErrorMsg message={error}/>

          {mode==='login' && (
            <form onSubmit={handleLogin}>
              <Input label="Email" type="email" value={form.email} autoComplete="username"
                onChange={e=>set('email',e.target.value)} placeholder="you@school.rw" required/>
              <Input label="Password" type="password" value={form.password} autoComplete="current-password"
                onChange={e=>set('password',e.target.value)} placeholder="Your password" required/>
              <Btn type="submit" style={{width:'100%', background:'#0c2b54'}} size="lg" loading={loading}>Sign In</Btn>
              <div style={{ textAlign:'center', marginTop:14 }}>
                <button type="button" onClick={()=>go('forgot')}
                  style={{ background:'none', border:'none', color:'#0c2b54', fontSize:14, cursor:'pointer', padding:8, fontWeight:500 }}>
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {mode==='register' && (
            <form onSubmit={handleRegister}>
              <Input label="Full Name" value={form.name} autoComplete="name" onChange={e=>set('name',e.target.value)} placeholder="Your full name" required/>
              <Input label="Email" type="email" value={form.email} autoComplete="username" onChange={e=>set('email',e.target.value)} placeholder="you@example.com" required/>
              <Input label="Class Join Code" value={form.joinCode} onChange={e=>set('joinCode',e.target.value)} placeholder="e.g. XK7-R2" required/>
              <Input label="Password" type="password" value={form.password} autoComplete="new-password" onChange={e=>set('password',e.target.value)} placeholder={PW_RULE} required/>
              <Input label="Confirm Password" type="password" value={form.confirm} autoComplete="new-password" onChange={e=>set('confirm',e.target.value)} placeholder="Repeat password" required/>
              <Btn type="submit" style={{width:'100%', background:'#0c2b54'}} size="lg" loading={loading}>Create Account</Btn>
              <p style={{fontSize:12,color:'#64748b',textAlign:'center',marginTop:10}}>
                Your join code is given to you by the school office.
              </p>
            </form>
          )}

          {mode==='forgot' && (
            <form onSubmit={handleForgot}>
              <h2 style={{ fontSize:20, fontWeight:700, color:'#0c2b54', marginBottom:6 }}>Forgot your password?</h2>
              <p style={{ fontSize:13, color:'#64748b', marginBottom:18 }}>
                Enter your email. The school office will be notified and will give you a temporary password in person.
              </p>
              <Notice tone="ok">{info}</Notice>
              <Input label="Email" type="email" value={form.email} autoComplete="username" onChange={e=>set('email',e.target.value)} placeholder="you@school.rw" required/>
              <Btn type="submit" style={{width:'100%', background:'#0c2b54'}} size="lg" loading={loading}>Ask the office for a reset</Btn>
              <div style={{ textAlign:'center', marginTop:14 }}>
                <button type="button" onClick={()=>go('login')}
                  style={{ background:'none', border:'none', color:'#0c2b54', fontSize:14, cursor:'pointer', padding:8, fontWeight:500 }}>
                  ← Back to sign in
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
