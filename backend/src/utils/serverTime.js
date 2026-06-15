const { Client } = require('ntp-time');

const client = new Client('pool.ntp.org', 123, { timeout: 10000 });
let timeOffset = 0; // ms to add to local clock

async function syncTime() {
  try {
    const time = await client.syncTime();
    // time.transmitTimestamp is seconds since 1900
    // NTP Epoch is 1900-01-01, JS Epoch is 1970-01-01
    // Difference is 2208988800 seconds
    const ntpMillis = (time.transmitTimestamp - 2208988800) * 1000;
    const localMillis = Date.now();
    timeOffset = ntpMillis - localMillis;
    console.log(`[ServerTime] Synced. Offset: ${timeOffset}ms. NTP Time: ${new Date(ntpMillis).toISOString()}`);
  } catch (err) {
    console.error('[ServerTime] Sync failed:', err.message);
  }
}

// Initial sync
syncTime();

// Sync every 5 minutes
setInterval(syncTime, 5 * 60 * 1000);

/**
 * Returns the current NTP-corrected time as a Date object.
 */
function now() {
  return new Date(Date.now() + timeOffset);
}

/**
 * Checks if the current corrected time is past the given deadline.
 */
function isLate(deadline) {
  if (!deadline) return false;
  return now() > new Date(deadline);
}

/**
 * Checks if the current corrected time is within the given window.
 */
function isWithinWindow(opensAt, closesAt) {
  const currentTime = now();
  if (opensAt && currentTime < new Date(opensAt)) {
    return { open: false, reason: 'Assignment not open yet' };
  }
  if (closesAt && currentTime > new Date(closesAt)) {
    return { open: false, reason: 'Assignment is closed' };
  }
  return { open: true };
}

/**
 * Returns the status of the time synchronization.
 */
function getStatus() {
  return {
    synced: timeOffset !== 0,
    offset: timeOffset,
    serverTime: now().toISOString(),
    timezone: 'Africa/Kigali'
  };
}

module.exports = {
  now,
  isLate,
  isWithinWindow,
  getStatus
};
