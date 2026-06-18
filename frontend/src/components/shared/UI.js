import React from 'react';

export function Badge({ children, color = 'blue' }) {
  const colors = {
    blue:   { bg: '#e6f1fb', text: '#0c447c', border: '#b5d4f4' },
    green:  { bg: '#eaf3de', text: '#27500a', border: '#c0dd97' },
    red:    { bg: '#fcebeb', text: '#791f1f', border: '#f7c1c1' },
    amber:  { bg: '#faeeda', text: '#633806', border: '#fac775' },
    teal:   { bg: '#e1f5ee', text: '#085041', border: '#9fe1cb' },
    purple: { bg: '#eeedfe', text: '#3c3489', border: '#cecbf6' },
    gray:   { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  };
  const c = colors[color] || colors.blue;
  return (
    <span style={{ display:'inline-block', fontSize:11, padding:'2px 8px', borderRadius:4,
      background:c.bg, color:c.text, border:`0.5px solid ${c.border}`, fontWeight:500, lineHeight:1.6 }}>
      {children}
    </span>
  );
}

export function Btn({ children, onClick, variant='primary', size='md', disabled, style={}, type='button', loading }) {
  const base = {
    display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
    border:'none', borderRadius:8, cursor: disabled||loading ? 'not-allowed':'pointer',
    fontWeight:500, transition:'all .15s', opacity: disabled||loading ? 0.6:1,
    fontSize: size==='sm'?12:size==='lg'?15:13,
    padding: size==='sm'?'5px 10px':size==='lg'?'11px 22px':'7px 14px',
  };
  const variants = {
    primary:   { background:'#185fa5', color:'#fff' },
    secondary: { background:'#e6f1fb', color:'#0c447c', border:'0.5px solid #b5d4f4' },
    danger:    { background:'#fcebeb', color:'#791f1f', border:'0.5px solid #f7c1c1' },
    ghost:     { background:'transparent', color:'#185fa5', border:'0.5px solid #b5d4f4' },
    success:   { background:'#eaf3de', color:'#27500a', border:'0.5px solid #c0dd97' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled||loading}
      style={{ ...base, ...variants[variant], ...style }}>
      {loading ? '...' : children}
    </button>
  );
}

export function Card({ children, style={}, padding='16px 20px' }) {
  return (
    <div style={{ background:'#fff', border:'0.5px solid #e2e8f0', borderRadius:12,
      padding, boxShadow:'0 1px 3px rgba(0,0,0,.04)', ...style }}>
      {children}
    </div>
  );
}

export function Input({ label, type='text', value, onChange, placeholder, required, error, style={} }) {
  const [show, setShow] = React.useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (show ? 'text' : 'password') : type;

  return (
    <div style={{ marginBottom:14 }}>
      {label && <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569',
        marginBottom:5, textTransform:'uppercase', letterSpacing:'.4px' }}>
        {label}{required && <span style={{ color:'#e24b4a', marginLeft:3 }}>*</span>}
      </label>}
      <div style={{ position: 'relative' }}>
        <input type={inputType} value={value} onChange={onChange} placeholder={placeholder}
          style={{ width:'100%', padding:'9px 12px', paddingRight: isPassword ? 40 : 12, borderRadius:8, fontSize:14,
            border:`1.5px solid ${error?'#f09595':'#e2e8f0'}`, outline:'none',
            background:'#fff', color:'#1e293b', transition:'border-color .2s',
            boxSizing:'border-box', ...style }}
          onFocus={e=>e.target.style.borderColor='#378add'}
          onBlur={e=>e.target.style.borderColor=error?'#f09595':'#e2e8f0'} />
        
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: '#64748b',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {show ? '👁️' : '👁️‍🗨️'}
          </button>
        )}
      </div>
      {error && <p style={{ fontSize:12, color:'#e24b4a', marginTop:4 }}>{error}</p>}
    </div>
  );
}

export function Textarea({ label, value, onChange, placeholder, rows=4, required }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569',
        marginBottom:5, textTransform:'uppercase', letterSpacing:'.4px' }}>
        {label}{required && <span style={{ color:'#e24b4a', marginLeft:3 }}>*</span>}
      </label>}
      <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
        style={{ width:'100%', padding:'9px 12px', borderRadius:8, fontSize:14,
          border:'1.5px solid #e2e8f0', outline:'none', background:'#fff',
          color:'#1e293b', resize:'vertical', fontFamily:'inherit',
          transition:'border-color .2s', boxSizing:'border-box' }}
        onFocus={e=>e.target.style.borderColor='#378add'}
        onBlur={e=>e.target.style.borderColor='#e2e8f0'} />
    </div>
  );
}

export function Select({ label, value, onChange, options, required }) {
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#475569',
        marginBottom:5, textTransform:'uppercase', letterSpacing:'.4px' }}>
        {label}{required && <span style={{ color:'#e24b4a', marginLeft:3 }}>*</span>}
      </label>}
      <select value={value} onChange={onChange}
        style={{ width:'100%', padding:'9px 12px', borderRadius:8, fontSize:14,
          border:'1.5px solid #e2e8f0', outline:'none', background:'#fff',
          color:'#1e293b', cursor:'pointer', boxSizing:'border-box' }}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Modal({ title, children, onClose, width=520 }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.45)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}
      onClick={e=>{ if(e.target===e.currentTarget && onClose) onClose(); }}>
      <div className="modal-content" style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:width,
        maxHeight:'90vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,.15)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'16px 20px', borderBottom:'0.5px solid #e2e8f0' }}>
          <h3 style={{ fontSize:16, fontWeight:600, color:'#0f172a', margin:0 }}>{title}</h3>
          {onClose && <button onClick={onClose} style={{ background:'none', border:'none',
            fontSize:20, cursor:'pointer', color:'#64748b', lineHeight:1 }}>×</button>}
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

export function StatCard({ label, value, color='#185fa5', bg='#e6f1fb' }) {
  return (
    <div style={{ background:bg, borderRadius:10, padding:'14px 18px' }}>
      <div style={{ fontSize:12, color:'#475569', marginBottom:4, fontWeight:500 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:700, color }}>{value ?? '—'}</div>
    </div>
  );
}

export function Empty({ message='Nothing here yet.' }) {
  return <div style={{ textAlign:'center', padding:'40px 20px', color:'#94a3b8', fontSize:14 }}>{message}</div>;
}

export function ErrorMsg({ message }) {
  if (!message) return null;
  return (
    <div style={{ padding:'10px 14px', background:'#fcebeb', border:'0.5px solid #f7c1c1',
      borderRadius:8, fontSize:13, color:'#791f1f', marginBottom:14 }}>
      {message}
    </div>
  );
}

export function Spinner() {
  return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', padding:40 }}>
      <div style={{ width:32, height:32, border:'3px solid #e2e8f0',
        borderTopColor:'#185fa5', borderRadius:'50%', animation:'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function Page({ children, style={} }) {
  return <div className="page-container" style={{ maxWidth:920, margin:'0 auto', padding:'28px 20px', ...style }}>{children}</div>;
}

export function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="section-header" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 }}>
      <div>
        <h2 style={{ fontSize:20, fontWeight:700, color:'#0f172a', margin:0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize:13, color:'#64748b', marginTop:3 }}>{subtitle}</p>}
      </div>
      {action && <div className="section-action">{action}</div>}
    </div>
  );
}

export function ScoreChip({ score, maxScore }) {
  if (score===null||score===undefined) return <Badge color="gray">Not graded</Badge>;
  const pct = maxScore>0 ? score/maxScore : 0;
  return <Badge color={pct>=0.7?'green':pct>=0.5?'amber':'red'}>{score}/{maxScore}</Badge>;
}

export const TAGS = ['Incomplete','Wrong format','Missing parts'];
export function TagChip({ tag }) {
  if (!tag) return null;
  return <Badge color="amber">{tag}</Badge>;
}

export function FileIcon({ type }) {
  const m = { pdf:'📄', pptx:'📊', docx:'📝', xlsx:'📋', jpg:'🖼', png:'🖼' };
  return <span style={{ fontSize:16 }}>{m[type]||'📁'}</span>;
}

export function Linkify({ text }) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return (
    <>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" 
               style={{ color: '#378add', textDecoration: 'underline', wordBreak: 'break-all' }}>
              {part}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB',
    { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

export function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

// Custom Logo component using image
export function Logo({ size=40 }) {
  return (
    <img 
      src="/logo-512.png" 
      alt="WMHS Logo" 
      style={{ 
        width: size, 
        height: size, 
        objectFit: 'contain', 
        flexShrink: 0,
        borderRadius: 4
      }} 
    />
  );
}
