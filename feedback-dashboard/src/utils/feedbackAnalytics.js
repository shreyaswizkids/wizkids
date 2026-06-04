export function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') return 'neutral';
  const t = text.toLowerCase();
  const positive = ['fun', 'great', 'good', 'easy', 'understood', 'awesome', 'clear', 'nice', 'enjoyed', 'loved', 'helpful', 'interesting', 'liked'];
  const negative = ['hard', 'difficult', 'confusing', 'boring', 'bad', 'tough', 'complicated', 'did not get', 'did not understand'];
  
  let posCount = 0;
  let negCount = 0;
  
  positive.forEach(w => { if (t.includes(w)) posCount++; });
  negative.forEach(w => { if (t.includes(w)) negCount++; });
  
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

function extractAllFeedbackEntries(studentData) {
  const entries = [];
  
  studentData.sessions?.forEach(s => {
    if (s.enjoyedMost || s.improvementPoint) {
      entries.push({ date: s.savedAt, source: 'Session', text: ((s.enjoyedMost || '') + ' ' + (s.improvementPoint || '')).trim() });
    }
  });

  studentData.modules?.forEach(m => {
    if (m.feedback && (m.feedback.enjoyedMost || m.feedback.improvementPoint)) {
      entries.push({ date: m.savedAt, source: "Module (" + m.topicName + ")", text: ((m.feedback.enjoyedMost || '') + ' ' + (m.feedback.improvementPoint || '')).trim() });
    }
    m.subtopics?.forEach(st => {
      if (st.feedback && (st.feedback.enjoyedMost || st.feedback.improvementPoint)) {
        entries.push({ date: st.savedAt, source: "Subtopic (" + st.subtopicName + ")", text: ((st.feedback.enjoyedMost || '') + ' ' + (st.feedback.improvementPoint || '')).trim() });
      }
    });
  });

  return entries;
}

export function calculateStudentMetrics(data) {
  return data.map(student => {
    const entries = extractAllFeedbackEntries(student);
    let positiveCount = 0;
    
    const analyzedEntries = entries.map(e => {
      const sentiment = analyzeSentiment(e.text);
      if (sentiment === 'positive') positiveCount++;
      return { ...e, sentiment };
    });

    const total = entries.length;
    const positivePercentage = total > 0 ? Math.round((positiveCount / total) * 100) : 0;
    
    let status = 'Neutral';
    if (total === 0) status = 'No Data';
    else if (positivePercentage >= 70) status = 'Positive';
    else if (positivePercentage < 40) status = 'Needs Attention';

    return {
      userId: student.userId,
      feedbackCount: total,
      positivePercentage,
      status,
      entries: analyzedEntries
    };
  }).filter(s => s.feedbackCount > 0);
}

export function calculateOverallMetrics(studentMetrics) {
  let totalFeedback = 0;
  let totalPositive = 0;
  let totalNeutral = 0;
  let totalNegative = 0;

  studentMetrics.forEach(s => {
    totalFeedback += s.feedbackCount;
    s.entries.forEach(e => {
      if (e.sentiment === 'positive') totalPositive++;
      else if (e.sentiment === 'negative') totalNegative++;
      else totalNeutral++;
    });
  });

  const totalStudents = studentMetrics.length;
  
  return {
    totalFeedback,
    totalStudents,
    averagePerStudent: totalStudents > 0 ? (totalFeedback / totalStudents).toFixed(1) : 0,
    positivePercentage: totalFeedback > 0 ? Math.round((totalPositive / totalFeedback) * 100) : 0,
    neutralPercentage: totalFeedback > 0 ? Math.round((totalNeutral / totalFeedback) * 100) : 0,
    negativePercentage: totalFeedback > 0 ? Math.round((totalNegative / totalFeedback) * 100) : 0
  };
}

export function getTopStudents(studentMetrics) {
  return [...studentMetrics]
    .sort((a, b) => b.positivePercentage - a.positivePercentage)
    .slice(0, 5);
}

export function getBottomStudents(studentMetrics) {
  return [...studentMetrics]
    .sort((a, b) => a.positivePercentage - b.positivePercentage)
    .slice(0, 5);
}

export function getRecentFeedback(studentMetrics) {
  const allEntries = [];
  studentMetrics.forEach(student => {
    student.entries.forEach(entry => {
      allEntries.push({
        userId: student.userId,
        ...entry
      });
    });
  });
  
  return allEntries
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 15);
}
