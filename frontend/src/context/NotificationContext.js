import React, { createContext, useContext, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { NOTIFICATION_SOUND_B64 } from '../utils/notificationSound';

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

// Audio Alert Generator (Custom UI Sound from Base64)
const playSound = () => {
  try {
    const audio = new Audio("data:audio/mp3;base64," + NOTIFICATION_SOUND_B64);
    audio.play().catch(e => console.warn("Audio play blocked by browser. Click anywhere to enable sound."));
  } catch (e) {
    console.error("Error playing notification sound:", e);
  }
};

export const NotificationProvider = ({ children }) => {
  const [toast, setToast] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showOnlineStatus, setShowOnlineStatus] = useState(false);

  const [unseenCounts, setUnseenCounts] = useState({
    announcements: 0,
    mywork: 0,
    results: 0,
    materials: 0
  });

  // Connection monitoring
  React.useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowOnlineStatus(true);
      // Hide the "Back online" notification after 3 seconds
      setTimeout(() => setShowOnlineStatus(false), 3000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setShowOnlineStatus(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Track seen IDs in reactive state + localStorage
  const [seenIds, setSeenIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wmhs_seen_ids') || '[]');
    } catch (e) {
      return [];
    }
  });

  const getSeenIds = useCallback(() => seenIds, [seenIds]);

  const markAsSeen = useCallback((id) => {
    if (!id) return;
    setSeenIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      localStorage.setItem('wmhs_seen_ids', JSON.stringify(next));
      return next;
    });
  }, []);

  const markMultipleAsSeen = useCallback((ids) => {
    if (!ids || ids.length === 0) return;
    setSeenIds(prev => {
      const newIds = ids.filter(id => !prev.includes(id));
      if (newIds.length === 0) return prev;
      const next = [...prev, ...newIds];
      localStorage.setItem('wmhs_seen_ids', JSON.stringify(next));
      return next;
    });
  }, []);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    playSound();
    // Auto hide after 5 seconds
    setTimeout(() => setToast(null), 5000);
  }, []);

  const updateUnseen = useCallback((key, items) => {
    const unseen = items.filter(item => !seenIds.includes(item.id));
    
    setUnseenCounts(prev => ({
      ...prev,
      [key]: unseen.length
    }));
  }, [seenIds]);

  return (
    <NotificationContext.Provider value={{ showToast, markAsSeen, markMultipleAsSeen, unseenCounts, updateUnseen, getSeenIds }}>
      {children}
      
      {/* Offline Status Pill */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%', scale: 0.9 }}
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              zIndex: 10000,
              background: 'rgba(239, 68, 68, 0.9)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: '99px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 10px 25px rgba(239, 68, 68, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              whiteSpace: 'nowrap'
            }}
          >
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              📡
            </motion.span>
            Offline
          </motion.div>
        )}
      </AnimatePresence>

      {/* Online Status Pill */}
      <AnimatePresence>
        {isOnline && showOnlineStatus && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, x: '-50%', scale: 0.9 }}
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              zIndex: 10000,
              background: 'rgba(34, 197, 94, 0.9)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: '99px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 10px 25px rgba(34, 197, 94, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              whiteSpace: 'nowrap'
            }}
          >
            <span>✅</span>
            Back online
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Toast UI */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 20, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            style={{
              position: 'fixed',
              top: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9999,
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(10px)',
              padding: '12px 24px',
              borderRadius: '12px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
              border: '1px solid rgba(255,255,255,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              minWidth: '300px'
            }}
          >
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#3c3489',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '16px'
            }}>
              {toast.type === 'announcement' ? '📢' : '📝'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                New {toast.type}
              </div>
              <div style={{ fontSize: '14px', color: '#1e293b', fontWeight: 500 }}>
                {toast.message}
              </div>
            </div>
            <button 
              onClick={() => setToast(null)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', color: '#94a3b8' }}
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </NotificationContext.Provider>
  );
};

