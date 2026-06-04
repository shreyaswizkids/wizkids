export default function TopStudents({ students, title = "Top Positive Students", isNegative = false }) {
  if (!students || students.length === 0) return null;

  return (
    <div className="card">
      <h2 className="card-title">{title}</h2>
      <ul className="ranking-list">
        {students.map(student => (
          <li key={student.userId} className="ranking-item">
            <span style={{ textTransform: 'capitalize' }}>{student.userId}</span>
            <span 
              className="ranking-score" 
              style={{ color: isNegative ? 'var(--status-negative)' : 'var(--status-positive)' }}
            >
              {student.positivePercentage}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
