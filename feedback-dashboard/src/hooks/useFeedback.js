import { useState, useEffect } from 'react';
import { fetchAllFeedback } from '../services/feedbackApi';
import { 
  calculateStudentMetrics, 
  calculateOverallMetrics, 
  getTopStudents, 
  getBottomStudents, 
  getRecentFeedback 
} from '../utils/feedbackAnalytics';

export function useFeedback() {
  const [data, setData] = useState({
    studentMetrics: [],
    overall: null,
    topStudents: [],
    bottomStudents: [],
    recentFeedback: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const rawData = await fetchAllFeedback();
        
        if (!rawData || rawData.length === 0) {
          setData(prev => ({ ...prev, studentMetrics: [] }));
          setLoading(false);
          return;
        }

        const studentMetrics = calculateStudentMetrics(rawData);
        const overall = calculateOverallMetrics(studentMetrics);
        const topStudents = getTopStudents(studentMetrics);
        const bottomStudents = getBottomStudents(studentMetrics);
        const recentFeedback = getRecentFeedback(studentMetrics);

        setData({
          studentMetrics,
          overall,
          topStudents,
          bottomStudents,
          recentFeedback
        });
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  return { ...data, loading, error };
}
