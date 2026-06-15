import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useTime } from '../../context/TimeContext';
import { Badge, Btn, Modal, Input, Textarea, Select, Spinner } from './UI';

export function ModernCalendar() {
  const { currentUser } = useAuth();
  const { now } = useTime();
  const [isOpen, setIsOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewDate, setViewDate] = useState(now());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showAdd, setShowAdd] = useState(null);
  const isAdmin = currentUser?.role === 'admin';

  const [form, setForm] = useState({ title: '', description: '', type: 'event' });
  const [saving, setSaving] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const data = await api.calendar.getEvents();
      setEvents(data.events || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchEvents();
      // Poll for updates every 30 seconds while open
      const interval = setInterval(fetchEvents, 30000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const handleAddEvent = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.calendar.createEvent({ ...form, event_date: showAdd });
      setShowAdd(null);
      setForm({ title: '', description: '', type: 'event' });
      fetchEvents();
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    try {
      await api.calendar.deleteEvent(id);
      setSelectedEvent(null);
      fetchEvents();
    } catch (err) { alert(err.message); }
  };

  // Helper to get YYYY-MM-DD from a Date object
  const formatYMD = (date) => {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Calendar Logic
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = viewDate.toLocaleString('default', { month: 'long' });

  const todayStr = formatYMD(now());

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    const dayEvents = events.filter(e => e.event_date.split('T')[0] === dateStr);
    const isToday = todayStr === dateStr;

    const hasEvents = dayEvents.length > 0;
    
    // Priority logic: assessment (red) > event (green) > other (gray)
    let priorityType = 'other';
    if (dayEvents.some(e => e.type === 'assessment')) priorityType = 'assessment';
    else if (dayEvents.some(e => e.type === 'event')) priorityType = 'event';
    
    const eventColor = hasEvents ? getTypeColor(priorityType) : null;

    days.push(
      <motion.div 
        key={d} 
        whileHover={{ scale: 1.05 }}
        onClick={() => isAdmin ? setShowAdd(dateStr) : (hasEvents && setSelectedEvent(dayEvents[0]))}
        style={{ 
          height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, cursor: 'pointer', borderRadius: 10, position: 'relative',
          background: isToday ? '#185fa5' : (hasEvents ? eventColor : 'rgba(255,255,255,0.4)'),
          color: (isToday || hasEvents) ? '#fff' : '#1e293b',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: (isToday || hasEvents) ? `0 4px 12px ${isToday ? 'rgba(24,95,165,0.3)' : 'rgba(0,0,0,0.1)'}` : 'none',
          fontWeight: (isToday || hasEvents) ? 700 : 400
        }}
      >
        {d}
      </motion.div>
    );
  }

  return (
    <>
      {/* Floating Trigger Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 900,
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: 'linear-gradient(135deg, #185fa5 0%, #3c3489 100%)',
          color: '#fff', fontSize: 24, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
      >
        📅
      </motion.button>

      {/* Slide-out Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.1)', backdropFilter: 'blur(4px)', zIndex: 1000 }}
            />

            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{
                position: 'fixed', top: 0, right: 0, height: '100vh', width: '100%', maxWidth: 360,
                background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(20px) saturate(180%)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.3)', zIndex: 1001,
                boxShadow: '-10px 0 40px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column'
              }}
            >
              {/* Header */}
              <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>School Events</h2>
                  <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>Your academic schedule at a glance</p>
                  
                  {/* Legend */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Assessment</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Event</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8' }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Other</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#185fa5' }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Today</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} style={{ border: 'none', background: 'rgba(0,0,0,0.05)', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', flexShrink: 0 }}>✕</button>
              </div>

              {/* Month Nav */}
              <div style={{ padding: '0 20px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: 0 }}>{monthName} {year}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn size="sm" variant="secondary" onClick={() => setViewDate(new Date(year, month - 1, 1))}>‹</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => setViewDate(new Date(year, month + 1, 1))}>›</Btn>
                </div>
              </div>

              {/* Grid */}
              <div style={{ padding: '0 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 12 }}>
                  {['S','M','T','W','T','F','S'].map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{d}</div>
                  ))}
                  {days}
                </div>
              </div>

              {/* Upcoming List */}
              <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
                <h4 style={{ fontSize: 13, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Upcoming Highlights</h4>
                {loading ? <Spinner /> : events.filter(e => new Date(e.event_date) >= now()).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: 13, background: 'rgba(255,255,255,0.4)', borderRadius: 12 }}>No events coming up</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {events.filter(e => new Date(e.event_date) >= now()).slice(0, 5).map(e => (
                      <motion.div 
                        key={e.id} whileHover={{ x: 4 }}
                        onClick={() => setSelectedEvent(e)}
                        style={{ padding: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.8)', borderRadius: 16, cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: getTypeColor(e.type) }}>{e.type}</span>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{new Date(e.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{e.title}</div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
              
              <div style={{ padding: '20px', borderTop: '1px solid rgba(0,0,0,0.05)', textAlign: 'center' }}>
                 <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>© World Mission High School Portal</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      {showAdd && (
        <Modal title={`Schedule Event: ${showAdd}`} onClose={() => setShowAdd(null)}>
          <form onSubmit={handleAddEvent}>
            <Input label="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="Name of the event..." />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Select label="Category" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                options={[
                  {value:'event', label:'Event'}, 
                  {value:'assessment', label:'Assessment'}, 
                  {value:'other', label:'Other'}
                ]}
              />
            </div>
            <Textarea label="Notes" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Tell us more about it..." />
            <Btn type="submit" loading={saving} style={{ width: '100%' }}>Create Event</Btn>
          </form>
        </Modal>
      )}

      {selectedEvent && (
        <Modal title="Event Details" onClose={() => setSelectedEvent(null)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Badge color={getTypeBadgeColor(selectedEvent.type)}>{selectedEvent.type.toUpperCase()}</Badge>
            <span style={{ fontSize: 13, color: '#64748b' }}>{new Date(selectedEvent.event_date).toLocaleDateString('en-GB', { dateStyle: 'long' })}</span>
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 10 }}>{selectedEvent.title}</h3>
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 24 }}>
            {selectedEvent.description || 'No additional notes provided for this event.'}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="secondary" onClick={() => setSelectedEvent(null)} style={{ flex: 1 }}>Dismiss</Btn>
            {isAdmin && <Btn variant="danger" onClick={() => handleDelete(selectedEvent.id)} style={{ flex: 1 }}>Remove Event</Btn>}
          </div>
        </Modal>
      )}
    </>
  );
}

function getTypeColor(type) {
  const colors = { assessment: '#ef4444', event: '#10b981', other: '#94a3b8' };
  return colors[type] || colors.event;
}
function getTypeBadgeColor(type) {
  const colors = { assessment: 'red', event: 'green', other: 'gray' };
  return colors[type] || 'blue';
}
