// ============================================================
// BUSINESS LOGIC: feedback.js
// Processes student feedback.
// Reads question definitions from: data/feedback-data.js
// Never accessed directly by the UI — always via these methods.
// ============================================================

const GKFeedback = (() => {

  // -- Data layer reference (read-only via BL methods below) --
  // GK_FEEDBACK_QUESTIONS is defined in data/feedback-data.js

  function getQuestions() {
    return GK_FEEDBACK_QUESTIONS;
  }

  /**
   * Translates a raw response value into a human-readable label.
   * Used by the mentor dashboard to display feedback in a readable form.
   */
  function getReadableLabel(questionId, value) {
    const question = GK_FEEDBACK_QUESTIONS.find(q => q.id === questionId);
    if (!question) return String(value);
    if (!question.options || question.options.length === 0)
      return String(value);
    const option = question.options.find(o => o.value === value);
    return option ? `${option.emoji || ''} ${option.label}`.trim() : String(value);
  }

  /**
   * Returns a formatted summary of all feedback responses for display.
   * Each entry has { questionText, label } for UI rendering.
   */
  function getFormattedResponses(responses) {
    if (!responses) return [];
    return GK_FEEDBACK_QUESTIONS.map(q => ({
      questionId: q.id,
      questionText: q.question,
      label: getReadableLabel(q.id, responses[q.id]),
      raw: responses[q.id]
    })).filter(r => r.raw !== undefined && r.raw !== null);
  }

  function processFeedback(responses) {
    const insights = [];

    if (responses.ai_helpful <= 2) {
      insights.push("AI hints will be made clearer for your next session.");
    }
    if (responses.difficulty === 'too_easy') {
      insights.push("We'll increase the challenge level next time!");
    } else if (responses.difficulty === 'too_hard') {
      insights.push("We'll start with simpler concepts next time to build confidence.");
    }
    if (responses.would_return === 'yes') {
      insights.push("See you tomorrow — your learning streak continues! 🔥");
    }
    if (responses.highlight === 'games') {
      insights.push("More interactive games queued for your next session! 🎮");
    } else if (responses.highlight === 'concepts') {
      insights.push("Deeper concept explorations planned ahead! 📖");
    }

    return {
      responses,
      insights,
      savedAt: new Date().toISOString()
    };
  }

  function validate(responses) {
    return GK_FEEDBACK_QUESTIONS.every(
      q => responses[q.id] !== undefined && responses[q.id] !== null
    );
  }

  return { getQuestions, getReadableLabel, getFormattedResponses, processFeedback, validate };
})();
