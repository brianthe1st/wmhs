// ── Central API client ────────────────────────────────────────────────────────
// All requests go through here — handles auth headers, errors, token expiry.

const BASE = process.env.REACT_APP_API_URL || '';

export const getToken = () => { try { return localStorage.getItem('wmhs_token'); } catch { return null; } };

export function clearSession() {
  try { localStorage.removeItem('wmhs_token'); localStorage.removeItem('wmhs_user'); localStorage.removeItem('wmhs_seen_ids'); } catch { /* storage unavailable */ }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('clear-caches');
  }
}

async function request(method, path, body, isFormData = false) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && !isFormData) headers['Content-Type'] = 'application/json';

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  let res;
  try { res = await fetch(`${BASE}${path}`, opts); }
  catch { throw new Error('Cannot reach the server. Check your internet connection and try again.'); }

  const isAuthCall = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register') || path.startsWith('/api/auth/forgot');
  if (res.status === 401 && !isAuthCall) {
    clearSession();
    window.location.href = '/';
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new Event('wmhs:password-change-required'));
    }
    if (res.status === 429) throw new Error(data.error || 'Too many requests. Please wait a moment and try again.');
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const qs = (o) => {
  const p = Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
};

// Authenticated file download. Local files stream as a blob; Cloudinary files come back as {url}.
async function downloadFile(path, fallbackName = 'download') {
  const token = getToken();
  let res;
  try { res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
  catch { throw new Error('Cannot reach the server.'); }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Download failed (${res.status})`);
  }
  const type = res.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    const d = await res.json();
    if (d.url) { window.open(d.url, '_blank', 'noopener'); return; }
    throw new Error('File not available.');
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Save text (e.g. a CSV built in the browser) as a file.
export function saveText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export const api = {
  auth: {
    login:          (email, password)            => request('POST', '/api/auth/login', { email, password }),
    register:       (name, email, pw, joinCode)  => request('POST', '/api/auth/register', { name, email, password: pw, joinCode }),
    forgot:         (email)                      => request('POST', '/api/auth/forgot', { email }),
    me:             ()                           => request('GET',  '/api/auth/me'),
    changePassword: (currentPassword, newPassword) => request('PATCH', '/api/auth/password', { currentPassword, newPassword }),
  },

  meta: {
    years: () => request('GET', '/api/meta/years'),
  },

  files: {
    material:   (id, name) => downloadFile(`/api/files/materials/${id}`, name),
    submission: (id, name) => downloadFile(`/api/files/submissions/${id}`, name),
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  admin: {
    stats:          ()         => request('GET',    '/api/admin/stats'),
    getClasses:     ()         => request('GET',    '/api/admin/classes'),
    createClass:    (level, stream) => request('POST', '/api/admin/classes', { level, stream }),
    resetCode:      (id)       => request('PATCH',  `/api/admin/classes/${id}/reset-code`),
    resetAllCodes:  ()         => request('POST',   '/api/admin/classes/reset-all-codes'),
    toggleCode:     (id)       => request('PATCH',  `/api/admin/classes/${id}/toggle-code`),
    getModules:     (classId)  => request('GET',    `/api/admin/classes/${classId}/modules`),
    assignModule:   (data)     => request('POST',   '/api/admin/modules', data),
    getTeachers:    ()         => request('GET',    '/api/admin/teachers'),
    createTeacher:  (data)     => request('POST',   '/api/admin/teachers', data),
    deleteTeacher:  (id)       => request('DELETE', `/api/admin/teachers/${id}`),
    getStudents:    (params)   => request('GET',    `/api/admin/students${qs(params)}`),
    deleteStudent:  (id, permanent) => request('DELETE', `/api/admin/students/${id}${permanent ? '?permanent=true' : ''}`),
    restoreStudent: (id)       => request('POST',   `/api/admin/students/${id}/restore`),
    moveStudent:    (id, classId) => request('PATCH', `/api/admin/students/${id}/class`, { classId }),
    importStudents: (classId, csv) => request('POST', '/api/admin/students/import', { classId, csv }),
    resetUserPassword: (id)    => request('PATCH',  `/api/admin/users/${id}/reset-password`),
    passwordRequests: ()       => request('GET',    '/api/admin/password-requests'),
    dismissPasswordRequest: (id) => request('POST', `/api/admin/password-requests/${id}/dismiss`),
    audit:          (limit)    => request('GET',    `/api/admin/audit${qs({ limit })}`),
    years:          ()         => request('GET',    '/api/admin/years'),
    promotionPreview: ()       => request('GET',    '/api/admin/promotion/preview'),
    promotionCommit:  (data)   => request('POST',   '/api/admin/promotion/commit', data),
    promotionUndo:    (batchId) => request('POST',  '/api/admin/promotion/undo', { batchId }),
    promotionHistory: ()       => request('GET',    '/api/admin/promotion/history'),
    getAnnouncements: ()       => request('GET',    '/api/announcements'),
    postAnnouncement: (body)   => request('POST',   '/api/announcements', { body }),
    editAnnouncement: (id, body) => request('PATCH', `/api/announcements/${id}`, { body }),
    deleteAnnouncement: (id)   => request('DELETE', `/api/announcements/${id}`),
    getReplies:     (id)       => request('GET',    `/api/announcements/${id}/replies`),
    postReply:      (id, body) => request('POST',   `/api/announcements/${id}/replies`, { body }),
  },

  // ── Teacher ────────────────────────────────────────────────────────────────
  teacher: {
    getModules:       ()           => request('GET',    '/api/teacher/modules'),
    getWorkItems:     (year)       => request('GET',    `/api/teacher/work-items${qs({ year })}`),
    createWorkItem:   (data)       => request('POST',   '/api/teacher/work-items', data),
    updateWorkItem:   (id, data)   => request('PATCH',  `/api/teacher/work-items/${id}`, data),
    deleteWorkItem:   (id)         => request('DELETE', `/api/teacher/work-items/${id}`),
    getQuestions:     (wiId)       => request('GET',    `/api/teacher/questions/${wiId}`),
    saveQuestions:    (wiId, qs_)  => request('POST',   `/api/teacher/questions/${wiId}`, { questions: qs_ }),
    getSubmissions:   (params)     => request('GET',    `/api/teacher/submissions${qs(params)}`),
    gradeSubmission:  (id, data)   => request('PATCH',  `/api/teacher/submissions/${id}/grade`, data),
    getMaterials:     ()           => request('GET',    '/api/teacher/materials'),
    uploadMaterial:   (formData)   => request('POST',   '/api/teacher/materials', formData, true),
    renameMaterial:   (id, title)  => request('PATCH',  `/api/teacher/materials/${id}`, { title }),
    deleteMaterial:   (id)         => request('DELETE', `/api/teacher/materials/${id}`),
    getAnnouncements: ()           => request('GET',    '/api/teacher/announcements'),
    postAnnouncement: (data)       => request('POST',   '/api/teacher/announcements', data),
    editAnnouncement: (id, body)   => request('PATCH',  `/api/teacher/announcements/${id}`, { body }),
    deleteAnnouncement:(id)        => request('DELETE', `/api/teacher/announcements/${id}`),
    postReply:        (id, body)   => request('POST',   `/api/teacher/announcements/${id}/replies`, { body }),
    getReport:        (moduleId, year) => request('GET', `/api/teacher/reports/${moduleId}${qs({ year })}`),
    exportReport:     (moduleId, year) => downloadFile(`/api/teacher/reports/${moduleId}/export${qs({ year })}`, 'report.csv'),
  },

  // ── Student ────────────────────────────────────────────────────────────────
  student: {
    getWorkItems:     ()      => request('GET',  '/api/student/work-items'),
    getQuestions:     (wiId)  => request('GET',  `/api/student/questions/${wiId}`),
    // data = plain object (JSON) or FormData (when a file is attached)
    submit:           (data)  => (typeof FormData !== 'undefined' && data instanceof FormData)
                                   ? request('POST', '/api/student/submissions', data, true)
                                   : request('POST', '/api/student/submissions', data),
    getSubmissions:   ()      => request('GET',  '/api/student/submissions'),
    getMaterials:     ()      => request('GET',  '/api/student/materials'),
    getAnnouncements: ()      => request('GET',  '/api/student/announcements'),
    postReply:        (annId, body) => request('POST', `/api/student/announcements/${annId}/replies`, { body }),
    getResults:       ()      => request('GET',  '/api/student/results'),
  },

  // ── Calendar ───────────────────────────────────────────────────────────────
  calendar: {
    getEvents:   ()     => request('GET',    '/api/calendar'),
    createEvent: (data) => request('POST',   '/api/calendar', data),
    deleteEvent: (id)   => request('DELETE', `/api/calendar/${id}`),
  },

  getServerTime: () => request('GET', '/api/server-time'),
};
