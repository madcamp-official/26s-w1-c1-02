-- 공유 코어 스키마 (게임 무관, 모든 기능 공용) — idempotent
-- 게임별 전용 테이블은 각 모듈의 schema.sql 참고 (예: src/vowel_game/schema.sql)

-- 계정 (로그인/회원가입)
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT     NOT NULL,          -- 로그인 아이디
  email         TEXT,                       -- 소셜 로그인은 이메일 동의항목이 없을 수 있어 NULL 허용
  password_hash TEXT,                       -- bcrypt 해시 (소셜 로그인 계정은 NULL)
  nickname      TEXT     NOT NULL,
  provider      TEXT     NOT NULL DEFAULT 'local',  -- 'local' | 'kakao' | 'google' | 'naver'
  provider_id   TEXT,                       -- 소셜 플랫폼이 부여한 고유 ID (local 계정은 NULL)
  avatar        TEXT     NOT NULL DEFAULT '🙂',  -- 프로필 아이콘(이모지 중 선택, 파일 업로드 아님)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (username)
);

-- 기존 테이블에 이미 만들어져 있던 환경을 위한 보정(idempotent)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT '🙂';

-- provider+provider_id 중복 가입 방지 (local 계정은 provider_id가 NULL이라 서로 충돌하지 않음)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_provider_account ON users (provider, provider_id);

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
-- 유저당 1행(PK: user_id). level/exp 는 싱글+멀티 종합 경험치(유저 단위).
-- 게임별 혼자하기 레벨 진행도는 meta 에 저장: {"jamo": {"level": N}, "spot": {"level": M}}
-- (구 (user_id, game) 복합키 스키마에서의 이관은 1회성 수동 마이그레이션으로 수행함)
CREATE TABLE IF NOT EXISTS user_game_progress (
  user_id     BIGINT      PRIMARY KEY,
  level       INTEGER     NOT NULL DEFAULT 1,    -- 종합 레벨
  exp         INTEGER     NOT NULL DEFAULT 0,    -- 종합 경험치
  best_score  INTEGER     NOT NULL DEFAULT 0,    -- 유저 최고 점수(프로필 통계용)
  meta        JSONB       NOT NULL DEFAULT '{}', -- 게임별 solo 레벨 진행도
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
