// ============================================================
// DATA LAYER: feedback-data.js
// Single source of truth for all student feedback questions.
// Consumed by: js/feedback.js (BL layer only — never by UI directly).
// Three question sets:
//   GK_FEEDBACK_QUESTIONS          – end-of-session (existing)
//   GK_SUBTOPIC_FEEDBACK_QUESTIONS – quick pulse after each subtopic game
//   GK_MODULE_FEEDBACK_QUESTIONS   – deeper check after completing a full module
// ============================================================

// ---- Quick post-subtopic feedback (2 questions) ----
// Tarun's version: rich rating/choice questions with emoji options
const GK_SUBTOPIC_FEEDBACK_QUESTIONS = [
  {
    id: "understood",
    question: "Did you understand this subtopic?",
    type: "rating",
    options: [
      { value: 1, label: "Not really 😕",  emoji: "😕" },
      { value: 2, label: "Mostly 🤔",      emoji: "🤔" },
      { value: 3, label: "Yes! 😊",        emoji: "😊" },
      { value: 4, label: "Completely! 🌟", emoji: "🌟" }
    ]
  },
  {
    id: "activity_fun",
    question: "How was the activity / game?",
    type: "choice",
    options: [
      { value: "boring",    label: "Too boring 😴"    },
      { value: "ok",        label: "It was okay 😐"   },
      { value: "fun",       label: "Fun! 🎉"           },
      { value: "very_fun",  label: "Super fun! 🎮🔥"  }
    ]
  },
  // Aditya's additional open-text questions for dashboard analysis
  {
    id: "enjoyedMost",
    question: "What did you enjoy the most?",
    type: "text",
  },
  {
    id: "improvementPoint",
    question: "What is the improvement point you suggest?",
    type: "text",
  },
];

// ---- Post-module feedback (Tarun's rich + Aditya's text questions) ----
const GK_MODULE_FEEDBACK_QUESTIONS = [
  {
    id: "module_clarity",
    question: "How well did you understand the whole topic?",
    type: "rating",
    options: [
      { value: 1, label: "Very confused 😵",   emoji: "😵" },
      { value: 2, label: "Slightly unclear 🤔", emoji: "🤔" },
      { value: 3, label: "Mostly clear 😊",     emoji: "😊" },
      { value: 4, label: "Crystal clear! 💡",  emoji: "💡" }
    ]
  },
  {
    id: "module_difficulty",
    question: "How was the difficulty across this module?",
    type: "choice",
    options: [
      { value: "too_easy",   label: "Too Easy — needs more challenge 😴" },
      { value: "just_right", label: "Just Right 🎯"                      },
      { value: "too_hard",   label: "Too Hard — need more practice 😅"   }
    ]
  },
  {
    id: "needs_help",
    question: "Which part would you like more help with?",
    type: "choice",
    options: [
      { value: "concepts",    label: "Understanding concepts 📖"  },
      { value: "practice",    label: "More practice games 🎮"      },
      { value: "assessment",  label: "Quiz strategies 📊"          },
      { value: "nothing",     label: "I'm good — all clear! ✅"   }
    ]
  },
  // Aditya's open-text questions (needed by /api/feedback/all dashboard)
  {
    id: "enjoyedMost",
    question: "What did you enjoy the most about this module?",
    type: "text",
  },
  {
    id: "improvementPoint",
    question: "What is your improvement point?",
    type: "text",
  },
];

// ---- End-of-session feedback (Tarun's rich + Aditya's text questions) ----
const GK_FEEDBACK_QUESTIONS = [
  {
    id: "ai_helpful",
    question: "Was Ask Acharya helpful?",
    type: "rating",
    options: [
      { value: 1, label: "Not helpful",   emoji: "😞" },
      { value: 2, label: "Somewhat",      emoji: "😐" },
      { value: 3, label: "Helpful",       emoji: "😊" },
      { value: 4, label: "Very helpful",  emoji: "🤩" }
    ]
  },
  {
    id: "difficulty",
    question: "How was the difficulty level?",
    type: "choice",
    options: [
      { value: "too_easy",   label: "Too Easy 😴"    },
      { value: "just_right", label: "Just Right 🎯"  },
      { value: "too_hard",   label: "Too Hard 😅"    }
    ]
  },
  {
    id: "would_return",
    question: "Would you like to continue learning tomorrow?",
    type: "choice",
    options: [
      { value: "yes",   label: "Yes, definitely! 🚀" },
      { value: "maybe", label: "Maybe 🤔"             },
      { value: "no",    label: "Need a break 😴"      }
    ]
  },
  {
    id: "highlight",
    question: "What was the best part of today's session?",
    type: "choice",
    options: [
      { value: "concepts",   label: "Learning concepts 📖" },
      { value: "games",      label: "The games 🎮"          },
      { value: "assessment", label: "The challenge quiz 📊"  },
      { value: "acharya",    label: "Ask Acharya help 🤖"   }
    ]
  },
  // Aditya's open-text questions (needed by /api/feedback/all dashboard)
  {
    id: "enjoyedMost",
    question: "What did you enjoy the most in today's session?",
    type: "text",
  },
  {
    id: "improvementPoint",
    question: "What is one thing you want to improve or understand better?",
    type: "text",
  },
];
