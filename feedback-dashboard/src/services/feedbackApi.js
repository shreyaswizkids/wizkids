export async function fetchAllFeedback() {
  const response = await fetch('/api/feedback/all');
  if (!response.ok) {
    throw new Error('Failed to fetch feedback data');
  }
  return response.json();
}
