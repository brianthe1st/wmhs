import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Logo } from './UI';
import { motion } from 'framer-motion';
import { ModernCalendar } from './ModernCalendar';

const NAV = {
  admin:   [
    { key:'dashboard',     label:'Dashboard',      icon:'⊞' },
    { key:'classes',       label:'Classes',         icon:'🏫' },
    { key:'teachers',      label:'Teachers',        icon:'👨‍🏫' },
    { key:'students',      label:'Students',        icon:'👥' },
    { key:'announcements', label:'Announcements',   icon:'📢' },
    { key:'reset-password', label:'Password Reset', icon:'🔑' },
    { key:'password',      label:'Change Password', icon:'🔒' },
  ],
  teacher: [
    { key:'dashboard',     label:'Dashboard',      icon:'⊞' },
    { key:'mymodules',     label:'My Modules',      icon:'📚' },
    { key:'assignments',   label:'Assignments',     icon:'📝' },
    { key:'grading',       label:'Grading',         icon:'✅' },
    { key:'materials',     label:'Materials',       icon:'📁' },
    { key:'announcements', label:'Announcements',   icon:'📢' },
    { key:'reports',       label:'Reports',         icon:'📊' },
    { key:'password',      label:'Change Password', icon:'🔒' },
  ],
  student: [
    { key:'dashboard',     label:'Dashboard',      icon:'⊞' },
    { key:'mywork',        label:'My Work',         icon:'📝' },
    { key:'materials',     label:'Materials',       icon:'📁' },
    { key:'announcements', label:'Announcements',   icon:'📢' },
    { key:'results',       label:'My Results',      icon:'📊' },
    { key:'password',      label:'Change Password', icon:'🔒' },
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
  if (!currentUser) return null;
  const nav = NAV[currentUser.role] || [];
  const rc  = RC[currentUser.role]  || RC.admin;
  const initials = currentUser.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'#f0f7ff',
      fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      {/* Sidebar */}
      <aside className="responsive-sidebar" style={{ width:220, background:'#fff', borderRight:'0.5px solid #e2e8f0',
        display:'flex', flexDirection:'column', flexShrink:0,
        position:'sticky', top:0, height:'100vh', overflowY:'auto', transition:'width 0.2s' }}>

        <div style={{ padding:'20px 16px 14px', borderBottom:'0.5px solid #e2e8f0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Logo size={36}/>
            <div className="logo-text">
              <div style={{ fontSize:11, fontWeight:700, color:'#0c447c', lineHeight:1.3 }}>WORLD MISSION</div>
              <div style={{ fontSize:10, color:'#64748b' }}>HIGH SCHOOL</div>
            </div>
          </div>
        </div>

        <div style={{ padding:'8px 16px', background:rc.bg }} className="portal-tag-container">
          <span className="portal-tag" style={{ fontSize:11, fontWeight:600, color:rc.text, textTransform:'uppercase', letterSpacing:'.5px' }}>
            {currentUser.role==='admin'?'Administrator':currentUser.role==='teacher'?'Teacher':'Student'} Portal
          </span>
        </div>

        <nav style={{ padding:'10px 8px', flex:1 }}>
          {nav.map(item=>(
            <button key={item.key} onClick={()=>setActivePage(item.key)}
              className="nav-item"
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%',
                padding:'9px 12px', border:'none', borderRadius:8, cursor:'pointer',
                fontSize:13, fontWeight:activePage===item.key?600:400,
                background:activePage===item.key?'#e6f1fb':'transparent',
                color:activePage===item.key?'#185fa5':'#334155',
                marginBottom:2, textAlign:'left', transition:'all .15s',
                position: 'relative' }}>
              <span className="nav-icon" style={{ fontSize:15 }}>{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              
              {unseenCounts[item.key] > 0 && (
                <motion.div
                  className="notification-dot"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#ef4444',
                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)'
                  }}
                />
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding:'12px 16px', borderTop:'0.5px solid #e2e8f0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <div style={{ width:34, height:34, borderRadius:'50%', background:rc.bg, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:13, fontWeight:700, color:rc.acc }}>
              {initials}
            </div>
            <div style={{ minWidth:0 }} className="user-info">
              <div style={{ fontSize:13, fontWeight:600, color:'#0f172a', overflow:'hidden',
                textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentUser.name}</div>
              <div style={{ fontSize:11, color:'#64748b', overflow:'hidden',
                textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentUser.email}</div>
            </div>
          </div>
          <button onClick={logout} className="signout-btn" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%', padding:'7px',
            background:'#fcebeb', border:'0.5px solid #f7c1c1', borderRadius:7,
            color:'#791f1f', fontSize:12, fontWeight:500, cursor:'pointer' }}>
            <span className="nav-label">Sign out</span>
            <span className="signout-icon" style={{display:'none'}}>🚪</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, overflowY:'auto', minHeight:'100vh', minWidth: 0 }}>
        <div style={{ background:'#fff', borderBottom:'0.5px solid #e2e8f0',
          padding:'12px 28px', display:'flex', alignItems:'center', justifyContent:'space-between',
          position:'sticky', top:0, zIndex:100 }} className="main-header">
          <h1 style={{ fontSize:16, fontWeight:600, color:'#0f172a', margin:0 }}>
            {nav.find(n=>n.key===activePage)?.label||'Portal'}
          </h1>
          <div style={{ fontSize:12, color:'#64748b' }} className="header-subtitle">World Mission High School</div>
        </div>
        <div>{children}</div>
      </main>

      <ModernCalendar />
    </div>
  );
}
