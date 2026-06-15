import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';

const TimeContext = createContext();

export const useTime = () => useContext(TimeContext);

export const TimeProvider = ({ children }) => {
  const [serverTime, setServerTime] = useState(null);
  const [timeOffset, setTimeOffset] = useState(0); // diff between server and local clock
  const [loading, setLoading] = useState(true);
  const timerRef = useRef();

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
    // Sync every 30 seconds
    const syncInterval = setInterval(syncTime, 30000);
    
    // Ticker to update serverTime state every second for UI
    const ticker = setInterval(() => {
      setServerTime(prev => prev ? new Date(prev.getTime() + 1000) : null);
    }, 1000);

    return () => {
      clearInterval(syncInterval);
      clearInterval(ticker);
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
