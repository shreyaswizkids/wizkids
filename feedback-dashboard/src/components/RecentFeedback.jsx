export default function RecentFeedback({ feedback }) {
  if (!feedback || feedback.length === 0) return null;

  return (
    <div className="card">
      <h2 className="card-title">Recent Feedback</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '15%' }}>Student</th>
              <th style={{ width: '20%' }}>Date</th>
              <th style={{ width: '65%' }}>Feedback</th>
            </tr>
          </thead>
          <tbody>
            {feedback.map((entry, idx) => (
              <tr key={idx}>
                <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>{entry.userId}</td>
                <td style={{ color: 'var(--pc-text-light)', fontSize: '0.85rem' }}>
                  {new Date(entry.date).toLocaleString()}
                </td>
                <td>
                  <div style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                    {entry.text}
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <span className={"status-badge status-" + entry.sentiment} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                      {entry.sentiment}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#888', marginLeft: '8px' }}>
                      Source: {entry.source}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
