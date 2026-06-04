import React from 'react';
import { useFeedback } from '../hooks/useFeedback';
import SummaryCards from '../components/SummaryCards';
import OverallAnalysis from '../components/OverallAnalysis';
import StudentAnalysis from '../components/StudentAnalysis';
import TopStudents from '../components/TopStudents';
import RecentFeedback from '../components/RecentFeedback';

export default function FeedbackDashboard() {
  const { studentMetrics, overall, topStudents, bottomStudents, recentFeedback, loading, error } = useFeedback();

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="state-container">
          <div>⏳ Loading feedback data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="state-container" style={{ color: 'var(--status-negative)' }}>
          <div>❌ Unable to load feedback data.</div>
        </div>
      </div>
    );
  }

  if (!studentMetrics || studentMetrics.length === 0) {
    return (
      <div className="dashboard-container">
        <div className="state-container" style={{ color: 'var(--pc-text-light)' }}>
          <div>📭 No feedback available yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>📊 Feedback Dashboard</h1>
      </div>

      <SummaryCards overall={overall} />

      <div className="dashboard-grid">
        <div>
          <StudentAnalysis studentMetrics={studentMetrics} />
        </div>
        <div>
          <OverallAnalysis overall={overall} />
          <TopStudents students={topStudents} title="Top Positive Students" />
          <TopStudents students={bottomStudents} title="Needs Attention" isNegative={true} />
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <RecentFeedback feedback={recentFeedback} />
      </div>
    </div>
  );
}
