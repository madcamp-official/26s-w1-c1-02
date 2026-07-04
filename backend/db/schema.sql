-- 미니게임천국 스키마 (idempotent: 부팅 시 반복 실행 안전)

-- 1) 사전
CREATE TABLE IF NOT EXISTS words (
  id             BIGSERIAL PRIMARY KEY,
  word           TEXT     NOT NULL,
  jamo_key       TEXT     NOT NULL,   -- 자모 정렬 키 (애너그램 매칭)
  syllable_count SMALLINT NOT NULL,
  jamo_count     SMALLINT NOT NULL,
  pos            TEXT,
  freq           INTEGER  NOT NULL DEFAULT 0,
  is_puzzle_seed BOOLEAN  NOT NULL DEFAULT TRUE, -- 출제 후보로 쓸지
  is_answer_ok   BOOLEAN  NOT NULL DEFAULT TRUE, -- 정답으로 인정할지
  source         TEXT     NOT NULL DEFAULT 'seed', -- 'seed' | 'stdict'(API 캐시)
  UNIQUE (word)
);
CREATE INDEX IF NOT EXISTS idx_words_jamokey   ON words (jamo_key);
CREATE INDEX IF NOT EXISTS idx_words_seed_pick ON words (syllable_count, freq) WHERE is_puzzle_seed;

-- 2) 발급된 문제 (정답 서버 보관)
CREATE TABLE IF NOT EXISTS jamo_puzzles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jamo_key       TEXT     NOT NULL,
  jamo_display   JSONB    NOT NULL,        -- 셔플된 자모 배열
  difficulty     SMALLINT NOT NULL DEFAULT 1,
  solution_count INTEGER  NOT NULL DEFAULT 0,
  source_word_id BIGINT   REFERENCES words(id),
  room_id        UUID,                     -- 멀티: 방/라운드 (싱글은 NULL)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_puzzles_room ON jamo_puzzles (room_id);

-- 3) 플레이 기록
CREATE TABLE IF NOT EXISTS game_results (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT,                   -- 로그인 전엔 NULL(게스트)
  game           TEXT     NOT NULL DEFAULT 'jamo',
  puzzle_id      UUID     REFERENCES jamo_puzzles(id),
  submitted_word TEXT,
  is_correct     BOOLEAN  NOT NULL,
  score          INTEGER  NOT NULL DEFAULT 0,
  elapsed_ms     INTEGER,
  mode           TEXT     NOT NULL DEFAULT 'solo',
  room_id        UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_results_leaderboard ON game_results (game, score DESC);
CREATE INDEX IF NOT EXISTS idx_results_user        ON game_results (user_id, game);

-- 4) 싱글 진행도
CREATE TABLE IF NOT EXISTS user_game_progress (
  user_id       BIGINT   NOT NULL,
  game          TEXT     NOT NULL,
  level         INTEGER  NOT NULL DEFAULT 1,
  exp           INTEGER  NOT NULL DEFAULT 0,
  cleared_count INTEGER  NOT NULL DEFAULT 0,
  best_score    INTEGER  NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game)
);
