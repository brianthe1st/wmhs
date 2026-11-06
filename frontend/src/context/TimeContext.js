import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const TimeContext = createContext();

export const useTime = () => useContext(TimeContext);

export const TimeProvider = ({ children }) => {
  const [serverTime, setServerTime] = useState(null);
  const [timeOffset, setTimeOffset] = useState(0); // diff between server and local clock
  const [loading, setLoading] = useState(true);

  const syncTime = useCallback(async () => {
    try {
      const start = Date.now();
      const data = await api.getServerTime();
      const end = Date.now();
      const latency = (end - start) / 2;
      
      const serverDate = new Date(data.serverTime);
      const localNow = Date.now();
      const offset = (serverDate.getTime() + latency) - localNow;
      
      setTimeOffset(offset);
      setServerTime(new Date(localNow + offset));
      setLoading(false);
    } catch (err) {
      console.error('Failed to sync server time:', err);
    }
  }, []);

  useEffect(() => {
    syncTime();
    // Re-sync every 5 minutes (not while the tab is hidden). The clock only needs a periodic correction.
    const syncInterval = setInterval(() => { if (!document.hidden) syncTime(); }, 5 * 60 * 1000);
    const onVisible = () => { if (!document.hidden) syncTime(); };
    document.addEventListener('visibilitychange', onVisible);

    // Ticker to update serverTime state every second for UI countdowns
    const ticker = setInterval(() => {
      if (document.hidden) return;
      setServerTime(prev => prev ? new Date(prev.getTime() + 1000) : null);
    }, 1000);

    return () => {
      clearInterval(syncInterval);
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [syncTime]);

  /**
   * Returns current synced server time
   */
  const now = useCallback(() => {
    return new Date(Date.now() + timeOffset);
  }, [timeOffset]);

  /**
   * Converts a date string/object to Africa/Kigali display string
   */
  const toKigali = useCallback((date) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    // Kigali is UTC+2
    return d.toLocaleString('en-GB', { 
      timeZone: 'Africa/Kigali',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }, []);

  return (
    <TimeContext.Provider value={{ now, toKigali, loading, serverTime }}>
      {children}
    </TimeContext.Provider>
  );
};
