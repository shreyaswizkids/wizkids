export default function OverallAnalysis({ overall }) {
  if (!overall) return null;

  const data = [
    { label: 'Positive', value: overall.positivePercentage, color: 'var(--status-positive)' },
    { label: 'Neutral', value: overall.neutralPercentage, color: 'var(--status-neutral)' },
    { label: 'Negative', value: overall.negativePercentage, color: 'var(--status-negative)' }
  ];

  return (
    <div className="card">
      <h2 className="card-title">Overall Feedback Analysis</h2>
      <div style={{ marginTop: '1.5rem' }}>
        {data.map(item => (
          <div key={item.label} className="progress-container">
            <div className="progress-label">
              <span>{item.label}</span>
              <span>{item.value}%</span>
            </div>
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: item.value + "%", backgroundColor: item.color }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
