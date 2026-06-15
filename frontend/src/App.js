import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './components/AuthPage';
import Layout   from './components/shared/Layout';
import { Spinner } from './components/shared/UI';

import { AdminDashboard, AdminClasses, AdminTeachers, AdminStudents, AdminAnnouncements, AdminPasswordReset } from './components/admin/AdminPages';
import { TeacherDashboard, TeacherModules, TeacherAssignments, TeacherGrading, TeacherMaterials, TeacherAnnouncements, TeacherReports, ChangePassword } from './components/teacher/TeacherPages';
import { StudentDashboard, StudentMyWork, StudentMaterials, StudentAnnouncements, StudentResults } from './components/student/StudentPages';

import { NotificationProvider } from './context/NotificationContext';
import { TimeProvider } from './context/TimeContext';

function Portal() {
  const { currentUser, loading } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f0f7ff' }}>
        <Spinner />
      </div>
    );
  }

  if (!currentUser) return <AuthPage />;

  const renderPage = () => {
    if (currentUser.role === 'admin') {
      switch (activePage) {
        case 'dashboard':     return <AdminDashboard setActivePage={setActivePage} />;
        case 'classes':       return <AdminClasses />;
        case 'teachers':      return <AdminTeachers />;
        case 'students':      return <AdminStudents />;
        case 'announcements': return <AdminAnnouncements />;
        case 'reset-password': return <AdminPasswordReset />;
        case 'password':      return <ChangePassword />;
        default:              return <AdminDashboard setActivePage={setActivePage} />;
      }
    }
    if (currentUser.role === 'teacher') {
      switch (activePage) {
        case 'dashboard':     return <TeacherDashboard setActivePage={setActivePage} />;
        case 'mymodules':     return <TeacherModules />;
        case 'assignments':   return <TeacherAssignments />;
        case 'grading':       return <TeacherGrading />;
        case 'materials':     return <TeacherMaterials />;
        case 'announcements': return <TeacherAnnouncements />;
        case 'reports':       return <TeacherReports />;
        case 'password':      return <ChangePassword />;
        default:              return <TeacherDashboard setActivePage={setActivePage} />;
      }
    }
    if (currentUser.role === 'student') {
      switch (activePage) {
        case 'dashboard':     return <StudentDashboard setActivePage={setActivePage} />;
        case 'mywork':        return <StudentMyWork />;
        case 'materials':     return <StudentMaterials />;
        case 'announcements': return <StudentAnnouncements />;
        case 'results':       return <StudentResults />;
        case 'password':      return <ChangePassword />;
        default:              return <StudentDashboard setActivePage={setActivePage} />;
      }
    }
    return null;
  };

  return (
    <Layout activePage={activePage} setActivePage={setActivePage}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TimeProvider>
        <NotificationProvider>
          <Portal />
        </NotificationProvider>
      </TimeProvider>
    </AuthProvider>
  );
}
