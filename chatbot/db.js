const Database = require('better-sqlite3');
const db = new Database('work_logs.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS work_logs (
    user_id   TEXT,
    log_date  TEXT,
    type      TEXT,
    start_time TEXT,
    end_time  TEXT,
    ext_mins  INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, log_date)
  )
`);

function getLogs(userId, fromDate, toDate) {
  return db.prepare(
    'SELECT * FROM work_logs WHERE user_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date'
  ).all(userId, fromDate, toDate);
}

function saveLog(userId, logDate, type, startTime, endTime, extMins = 0) {
  db.prepare(`
    INSERT INTO work_logs (user_id, log_date, type, start_time, end_time, ext_mins)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, log_date) DO UPDATE SET
      type       = excluded.type,
      start_time = excluded.start_time,
      end_time   = excluded.end_time,
      ext_mins   = excluded.ext_mins
  `).run(userId, logDate, type, startTime, endTime, extMins);
}

function deleteLog(userId, logDate) {
  db.prepare('DELETE FROM work_logs WHERE user_id = ? AND log_date = ?').run(userId, logDate);
}

module.exports = { getLogs, saveLog, deleteLog };
