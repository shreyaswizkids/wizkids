export default function StudentAnalysis({ studentMetrics }) {
  if (!studentMetrics || studentMetrics.length === 0) return null;

  return (
    <div className="card">
      <h2 className="card-title">Student-wise Analysis</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Student Name</th>
              <th>Feedback Count</th>
              <th>Positive Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {studentMetrics.map(student => {
              let statusClass = 'status-neutral';
              if (student.status === 'Positive') statusClass = 'status-positive';
              if (student.status === 'Needs Attention') statusClass = 'status-negative';
              
              return (
                <tr key={student.userId}>
                  <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>{student.userId}</td>
                  <td>{student.feedbackCount}</td>
                  <td>{student.positivePercentage}%</td>
                  <td>
                    <span className={"status-badge " + statusClass}>
                      {student.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
