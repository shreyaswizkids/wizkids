'use strict';
// ============================================================
// SERVER: config-loader.js
// Reads config/learning-paths.json and syncs it into the
// SQLite learning_paths / learning_path_topics /
// student_learning_paths tables.
//
// Called:
//   1. On server startup (server/index.js → syncConfig())
//   2. On POST /api/config/reload  (hot-reload without restart)
// ============================================================

const fs   = require('fs');
const path = require('path');
const { LPQ } = require('./db');

// Config file location — can be overridden by env var
const CONFIG_PATH = process.env.CONFIG_PATH ||
  path.resolve(__dirname, '../config/learning-paths.json');

/** Read and parse the config file. Returns null if file does not exist. */
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn('[GKConfig] config file not found at', CONFIG_PATH);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error('[GKConfig] failed to parse config file:', e.message);
    return null;
  }
}

/**
 * Sync config file → SQLite.
 * - Upserts all learning paths and their topics.
 * - Assigns students to their paths (deactivates previous assignments first).
 * Returns { paths: number, assignments: number } or null on error.
 */
function syncConfig() {
  const config = readConfig();
  if (!config) return null;

  let pathCount = 0;
  let assignCount = 0;

  // ── Learning paths ────────────────────────────────────────────────────────
  (config.learningPaths || []).forEach(lp => {
    LPQ.upsertLearningPath({
      id:          lp.id,
      name:        lp.name,
      description: lp.description,
      grade:       lp.grade,
      isActive:    lp.isActive !== false
    });
    LPQ.setLearningPathTopics(lp.id, lp.topics || []);
    pathCount++;
  });

  // ── Student assignments ───────────────────────────────────────────────────
  (config.studentAssignments || []).forEach(a => {
    if (!a.studentId || !a.pathId) return;
    // Tarun's safer version: wrap in try/catch so invalid student IDs don't crash startup
    try {
      LPQ.assignStudentToPath(a.studentId, a.pathId, a.assignedBy || null);
      assignCount++;
    } catch (err) {
      console.warn(
        `[GKConfig] skipped assignment ${a.studentId} → ${a.pathId}:`,
        err.message
      );
    }
  });

  console.log(`[GKConfig] synced ${pathCount} paths, ${assignCount} student assignments from`, CONFIG_PATH);
  return { paths: pathCount, assignments: assignCount };
}

/** Return the config file path (shown to user in API response). */
function getConfigPath() { return CONFIG_PATH; }

module.exports = { syncConfig, readConfig, getConfigPath };
