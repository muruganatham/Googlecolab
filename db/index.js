const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new Database(dbPath, { verbose: console.log });

// Initialize database schema
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId TEXT NOT NULL,
    allocationId TEXT NOT NULL,
    moduleId TEXT,
    timestamp TEXT NOT NULL,
    code TEXT NOT NULL,
    notebookId TEXT
  )
`);

module.exports = db;
