import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Logo } from './UI';
import { motion } from 'framer-motion';
import { ModernCalendar } from './ModernCalendar';

// `tab: true` = shown in the phone's bottom tab bar; the rest live under "More".
const NAV = {
  admin:   [
    { key:'dashboard',      label:'Dashboard',        icon:'⊞',  tab:true },
    { key:'classes',        label:'Classes',          icon:'🏫', tab:true },
    { key:'students',       label:'Students',         icon:'👥', tab:true },
    { key:'announcements',  label:'Announcements',    icon:'📢', tab:true },
    { key:'teachers',       label:'Teachers',         icon:'👨‍🏫' },
    { key:'reset-password', label:'Password Requests',icon:'🔑' },
    { key:'promotion',      label:'New Academic Year',icon:'🎓' },
    { key:'activity',       label:'Activity Log',     icon:'🧾' },
    { key:'password',       label:'Change Password',  icon:'🔒' },
  ],
  teacher: [
    { key:'dashboard',     label:'Dashboard',      icon:'⊞',  tab:true },
    { key:'assignments',   label:'Assignments',    icon:'📝', tab:true },
    { key:'grading',       label:'Grading',        icon:'✅', tab:true },
    { key:'announcements', label:'Announcements',  icon:'📢', tab:true },
    { key:'mymodules',     label:'My Modules',     icon:'📚' },
    { key:'materials',     label:'Materials',      icon:'📁' },
    { key:'reports',       label:'Reports',        icon:'📊' },
    { key:'password',      label:'Change Password',icon:'🔒' },
  ],
  student: [
    { key:'dashboard',     label:'Dashboard',      icon:'⊞',  tab:true },
    { key:'mywork',        label:'My Work',        icon:'📝', tab:true },
    { key:'announcements', label:'Announcements',  icon:'📢', tab:true },
    { key:'results',       label:'My Results',     icon:'📊', tab:true },
    { key:'materials',     label:'Materials',      icon:'📁' },
    { key:'password',      label:'Change Password',icon:'🔒' },
  ],
};

const RC = {
  admin:   { bg:'#0c447c', text:'#e6f1fb', acc:'#185fa5' },
  teacher: { bg:'#085041', text:'#e1f5ee', acc:'#0f6e56' },
  student: { bg:'#3c3489', text:'#eeedfe', acc:'#534ab7' },
};

export default function Layout({ activePage, setActivePage, children }) {
  const { currentUser, logout } = useAuth();
  const { unseenCounts } = useNotifications();
  const [sheet, setSheet] = useState(false);
  if (!currentUser) return null;

  const nav  = NAV[currentUser.role] || [];
  const rc   = RC[currentUser.role]  || RC.admin;
  const tabs = nav.filter(n => n.tab);
  const more = nav.filter(n => !n.tab);
  const initials = currentUser.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  const title = nav.find(n=>n.key===activePage)?.label || 'Portal';
  const moreActive = more.some(n => n.key === activePage);
  const moreUnseen = more.some(n => unseenCounts[n.key] > 0);
  const roleLabel = currentUser.role==='admin'?'Administrator':currentUser.role==='teacher'?'Teacher':'Student';
  const go = (key) => { setActivePage(key); setSheet(false); window.scrollTo(0, 0); };

  return (
    <div className="app-shell" style={{ background:'#f0f7ff', fontFamily:"'Segoe UI',system-ui,sans-serif" }}>

      {/* ───────── Desktop sidebar ───────── */}
      <aside className="desktop-only" style={{ width:220, background:'#fff', borderRight:'0.5px solid #e2e8f0',
        flexDirection:'column', flexShrink:0, position:'sticky', top:0, height:'100vh', overflowY:'auto' }}>

        <div style={{ padding:'20px 16px 14px', borderBottom:'0.5px solid #e2e8f0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Logo size={36}/>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#0c447c', lineHeight:1.3 }}>WORLD MISSION</div>
              <div style={{ fontSize:10, color:'#64748b' }}>HIGH SCHOOL</div>
            </div>
          </div>
        </div>

        <div style={{ padding:'8px 16px', background:rc.bg }}>
          <span style={{ fontSize:11, fontWeight:600, color:rc.text, textTransform:'uppercase', letterSpacing:'.5px' }}>
            {roleLabel} Portal
          </span>
        </div>

        <nav style={{ padding:'10px 8px', flex:1 }}>
          {nav.map(item=>(
            <button key={item.key} onClick={()=>go(item.key)}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%',
                padding:'9px 12px', border:'none', borderRadius:8, cursor:'pointer',
                fontSize:13, fontWeight:activePage===item.key?600:400,
                background:activePage===item.key?'#e6f1fb':'transparent',
                color:activePage===item.key?'#185fa5':'#334155',
                marginBottom:2, textAlign:'left', position:'relative' }}>
              <span style={{ fontSize:15 }}>{item.icon}</span>
              <span>{item.label}</span>
              {unseenCounts[item.key] > 0 && (
                <motion.div animate={{ scale:[1,1.2,1] }} transition={{ repeat:Infinity, duration:1.5 }}
                  style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                    width:8, height:8, borderRadius:'50%', background:'#ef4444', boxShadow:'0 0 8px rgba(239,68,68,.6)' }}/>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding:'12px 16px', borderTop:'0.5px solid #e2e8f0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <div style={{ width:34, height:34, borderRadius:'50%', background:rc.bg, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:rc.text }}>
              {initials}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentUser.name}</div>
              <div style={{ fontSize:11, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentUser.email}</div>
            </div>
          </div>
          <button onClick={logout} style={{ width:'100%', padding:7, background:'#fcebeb', border:'0.5px solid #f7c1c1',
            borderRadius:7, color:'#791f1f', fontSize:12, fontWeight:500, cursor:'pointer' }}>Sign out</button>
        </div>
      </aside>

      {/* ───────── Main ───────── */}
      <main className="app-main" style={{ overflowY:'auto', minHeight:'100vh' }}>
        {/* desktop header */}
        <div className="desktop-only" style={{ background:'#fff', borderBottom:'0.5px solid #e2e8f0', padding:'12px 28px',
          alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
          <h1 style={{ fontSize:16, fontWeight:600, color:'#0f172a', margin:0 }}>{title}</h1>
          <div style={{ fontSize:12, color:'#64748b' }}>World Mission High School</div>
        </div>
        {/* mobile top bar */}
        <div className="mobile-only mobile-topbar">
          <Logo size={30}/>
          <h1 style={{ fontSize:17, fontWeight:700, color:'#0c447c', margin:0, flex:1, minWidth:0,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</h1>
          <button onClick={()=>setSheet(true)} aria-label="Account menu"
            style={{ width:36, height:36, borderRadius:'50%', border:'none', background:rc.bg, color:rc.text,
              fontSize:13, fontWeight:700, cursor:'pointer', flexShrink:0 }}>{initials}</button>
        </div>

        {currentUser.status === 'graduated' && (
          <div style={{ background:'#faeeda', color:'#633806', fontSize:13, padding:'10px 16px', borderBottom:'1px solid #fac775' }}>
            🎓 You have graduated. You can still view your results, but you can no longer submit or change anything.
          </div>
        )}
        <div>{children}</div>
      </main>

      {/* ───────── Phone: bottom tab bar + "More" sheet ───────── */}
      <nav className="mobile-only mobile-tabbar" aria-label="Main">
        {tabs.map(item => (
          <button key={item.key} className={`mobile-tab${activePage===item.key?' active':''}`} onClick={()=>go(item.key)}>
            <span className="ico">{item.icon}</span>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>
              {item.label.split(' ')[0]}
            </span>
            {unseenCounts[item.key] > 0 && <span style={{ position:'absolute', top:6, right:'28%', width:9, height:9, borderRadius:'50%', background:'#ef4444' }}/>}
          </button>
        ))}
        <button className={`mobile-tab${moreActive?' active':''}`} onClick={()=>setSheet(true)}>
          <span className="ico">☰</span><span>More</span>
          {moreUnseen && <span style={{ position:'absolute', top:6, right:'28%', width:9, height:9, borderRadius:'50%', background:'#ef4444' }}/>}
        </button>
      </nav>

      {sheet && (
        <>
          <div className="sheet-backdrop mobile-only" onClick={()=>setSheet(false)}/>
          <div className="sheet mobile-only" style={{ flexDirection:'column' }} role="dialog" aria-label="Menu">
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'4px 8px 14px', borderBottom:'1px solid #e2e8f0', marginBottom:6 }}>
              <div style={{ width:42, height:42, borderRadius:'50%', background:rc.bg, color:rc.text, display:'flex',
                alignItems:'center', justifyContent:'center', fontWeight:700 }}>{initials}</div>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:15, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentUser.name}</div>
                <div style={{ fontSize:12, color:'#64748b' }}>{roleLabel}</div>
              </div>
            </div>
            {more.map(item => (
              <button key={item.key} className={`sheet-item${activePage===item.key?' active':''}`} onClick={()=>go(item.key)}>
                <span style={{ fontSize:20 }}>{item.icon}</span>{item.label}
                {unseenCounts[item.key] > 0 && <span style={{ marginLeft:'auto', width:9, height:9, borderRadius:'50%', background:'#ef4444' }}/>}
              </button>
            ))}
            <button className="sheet-item" onClick={logout} style={{ color:'#791f1f', marginTop:6, borderTop:'1px solid #e2e8f0' }}>
              <span style={{ fontSize:20 }}>🚪</span>Sign out
            </button>
          </div>
        </>
      )}

      <ModernCalendar />
    </div>
  );
}
