-- Additive daily safety quiz and point ledger foundation.
CREATE TABLE daily_quizzes (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_date TEXT NOT NULL,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  explanation TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_daily_quizzes_active_date ON daily_quizzes(quiz_date) WHERE is_active = 1;

CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  selected_option TEXT NOT NULL CHECK (selected_option IN ('A','B','C','D')),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0,1)),
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (quiz_id) REFERENCES daily_quizzes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (quiz_id, user_id)
);

CREATE TABLE point_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('quiz_correct')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('daily_quiz')),
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_point_ledger_quiz_correct
  ON point_ledger(user_id, reference_type, reference_id, reason)
  WHERE reason = 'quiz_correct';
CREATE INDEX idx_point_ledger_user_created ON point_ledger(user_id, created_at DESC);
