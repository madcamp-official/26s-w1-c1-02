-- 공유 코어 스키마 (게임 무관, 모든 기능 공용) — idempotent
-- 게임별 전용 테이블은 각 모듈의 schema.sql 참고 (예: src/vowel_game/schema.sql)

-- 계정 (로그인/회원가입). 기존 MongoDB → Postgres 로 통합.
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT     NOT NULL,          -- 로그인 아이디
  email         TEXT     NOT NULL,
  password_hash TEXT     NOT NULL,          -- bcrypt 해시
  nickname      TEXT     NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (username)
);

-- 플레이 기록 (모든 게임 공용). puzzle_id 는 게임별 문제 식별자(FK 없음: 게임 독립성 유지)
CREATE TABLE IF NOT EXISTS game_results (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT,                   -- 로그인 전엔 NULL(게스트)
  game           TEXT     NOT NULL,        -- 'jamo' 등
  puzzle_id      UUID,
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

-- 게임별 진행도 (모든 게임 공용)
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
