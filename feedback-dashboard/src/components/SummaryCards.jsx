export default function SummaryCards({ overall }) {
  if (!overall) return null;

  return (
    <div className="summary-grid">
      <div className="summary-card">
        <div className="summary-label">Total Feedback</div>
        <div className="summary-value">{overall.totalFeedback}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Total Students</div>
        <div className="summary-value">{overall.totalStudents}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Positive Feedback</div>
        <div className="summary-value">{overall.positivePercentage}%</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Avg Per Student</div>
        <div className="summary-value">{overall.averagePerStudent}</div>
      </div>
    </div>
  );
}
