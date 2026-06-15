// ── Central API client ────────────────────────────────────────────────────────
// All requests go through here — handles auth headers, errors, token expiry.

const BASE = process.env.REACT_APP_API_URL || '';

function getToken() {
  return localStorage.getItem('wmhs_token');
}

async function request(method, path, body, isFormData = false) {
  const token = getToken();
  const headers = {};

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  // Handle session expiry globally
  if (res.status === 401) {
    localStorage.removeItem('wmhs_token');
    localStorage.removeItem('wmhs_user');
    window.location.href = '/'; // force back to login
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  auth: {
    login:          (email, password)            => request('POST', '/api/auth/login', { email, password }),
    register:       (name, email, pw, joinCode)  => request('POST', '/api/auth/register', { name, email, password: pw, joinCode }),
    me:             ()                           => request('GET',  '/api/auth/me'),
    changePassword: (currentPassword, newPassword) => request('PATCH', '/api/auth/password', { currentPassword, newPassword }),
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  admin: {
    stats:          ()         => request('GET',    '/api/admin/stats'),
    getClasses:     ()         => request('GET',    '/api/admin/classes'),
    resetCode:      (id)       => request('PATCH',  `/api/admin/classes/${id}/reset-code`),
    toggleCode:     (id)       => request('PATCH',  `/api/admin/classes/${id}/toggle-code`),
    getModules:     (classId)  => request('GET',    `/api/admin/classes/${classId}/modules`),
    assignModule:   (data)     => request('POST',   '/api/admin/modules', data),
    getTeachers:    ()         => request('GET',    '/api/admin/teachers'),
    createTeacher:  (data)     => request('POST',   '/api/admin/teachers', data),
    deleteTeacher:  (id)       => request('DELETE', `/api/admin/teachers/${id}`),
    getStudents:    (classId)  => request('GET',    `/api/admin/students${classId ? `?classId=${classId}` : ''}`),
    deleteStudent:  (id)       => request('DELETE', `/api/admin/students/${id}`),
    resetUserPassword: (id)    => request('PATCH',  `/api/admin/users/${id}/reset-password`),
    getAnnouncements: ()       => request('GET',    '/api/announcements'),
    postAnnouncement: (body)   => request('POST',   '/api/announcements', { body }),
    deleteAnnouncement: (id)   => request('DELETE', `/api/announcements/${id}`),
  },

  // ── Teacher ────────────────────────────────────────────────────────────────
  teacher: {
    getModules:       ()           => request('GET',    '/api/teacher/modules'),
    getWorkItems:     ()           => request('GET',    '/api/teacher/work-items'),
    createWorkItem:   (data)       => request('POST',   '/api/teacher/work-items', data),
    deleteWorkItem:   (id)         => request('DELETE', `/api/teacher/work-items/${id}`),
    getQuestions:     (wiId)       => request('GET',    `/api/teacher/questions/${wiId}`),
    saveQuestions:    (wiId, qs)   => request('POST',   `/api/teacher/questions/${wiId}`, { questions: qs }),
    getSubmissions:   (wiId)       => request('GET',    `/api/teacher/submissions${wiId ? `?workItemId=${wiId}` : ''}`),
    gradeSubmission:  (id, data)   => request('PATCH',  `/api/teacher/submissions/${id}/grade`, data),
    getMaterials:     ()           => request('GET',    '/api/teacher/materials'),
    uploadMaterial:   (formData)   => request('POST',   '/api/teacher/materials', formData, true),
    deleteMaterial:   (id)         => request('DELETE', `/api/teacher/materials/${id}`),
    getAnnouncements: ()           => request('GET',    '/api/teacher/announcements'),
    postAnnouncement: (data)       => request('POST',   '/api/teacher/announcements', data),
    deleteAnnouncement:(id)        => request('DELETE', `/api/teacher/announcements/${id}`),
    getReport:        (moduleId)   => request('GET',    `/api/teacher/reports/${moduleId}`),
  },

  // ── Student ────────────────────────────────────────────────────────────────
  student: {
    getWorkItems:     ()      => request('GET',  '/api/student/work-items'),
    getQuestions:     (wiId)  => request('GET',  `/api/student/questions/${wiId}`),
    submit:           (data)  => request('POST', '/api/student/submissions', data),
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
