-- Additive metadata for existing and future daily quizzes.
ALTER TABLE daily_quizzes ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE daily_quizzes ADD COLUMN difficulty TEXT NOT NULL DEFAULT '' CHECK (difficulty IN ('', '초급', '중급', '고급'));
