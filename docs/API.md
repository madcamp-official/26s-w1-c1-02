# minigameheaven API 문서

미니게임 플랫폼 백엔드의 REST · 실시간(Socket.IO) API 레퍼런스.

- **공개 URL**: `https://minigameheaven-v1.madcamp-kaist.org`
- **백엔드 포트(내부)**: `8080` (nginx 리버스 프록시 뒤)
- **전송 방식**
  - REST: HTTP + JSON (`Content-Type: application/json`)
  - 실시간: Socket.IO (`path: /socket.io`) — 로비 채팅 · 멀티플레이 방 · 실시간 대전
- **인증**: JWT Bearer 토큰 (`Authorization: Bearer <token>`)

---

## 목차

1. [인증 모델](#인증-모델)
2. [REST API](#rest-api)
   - [시스템](#시스템)
   - [계정 (회원가입 · 로그인)](#계정-회원가입--로그인)
   - [소셜 로그인 (OAuth)](#소셜-로그인-oauth)
   - [프로필](#프로필)
   - [게임: 자음 모음 조합 (jamo)](#게임-자음-모음-조합-jamo)
   - [게임: 다른 그림 찾기 (spot)](#게임-다른-그림-찾기-spot)
3. [실시간 API (Socket.IO)](#실시간-api-socketio)
   - [연결](#연결)
   - [로비 · 접속자](#로비--접속자)
   - [방 (로비/대기실)](#방-로비대기실)
   - [실시간 게임: 자음 모음 조합 (vowel)](#실시간-게임-자음-모음-조합-vowel)
   - [실시간 게임: 다른 그림 찾기 (spot)](#실시간-게임-다른-그림-찾기-spot)
   - [실시간 게임: 숫자야구 (baseball)](#실시간-게임-숫자야구-baseball)
4. [데이터 모델 요약](#데이터-모델-요약)

---

## 인증 모델

- 로그인/회원가입/소셜 로그인 성공 시 **JWT**(`expiresIn: 7d`)를 발급한다. 페이로드: `{ userId, username, nickname }`.
- 보호된 요청은 헤더에 `Authorization: Bearer <token>`을 담아 보낸다.
- 게임 API는 **`optionalAuth`** 미들웨어를 사용한다: 토큰이 있으면 검증해 `userId`를 채우고, **없거나 만료/위조면 게스트로 통과**시킨다(에러 아님). 따라서 비로그인 상태로도 플레이는 가능하되, 진행도 저장(`level-clear`, `progress`)만 로그인을 요구한다.

---

## REST API

> 별도 표기가 없으면 요청/응답 본문은 JSON이다. 아래 "인증" 열은 필요 여부를 뜻한다.

### 시스템

#### `GET /health`
헬스 체크. 인증 불필요.

- **200** `ok` (text/plain)

---

### 계정 (회원가입 · 로그인)

#### `POST /api/signup`
로컬 계정 생성. 인증 불필요.

**요청 본문**
```json
{ "username": "string", "email": "string", "password": "string", "nickname": "string" }
```

**응답 · 201**
```json
{
  "token": "<JWT>",
  "user": { "id": 1, "username": "alice", "email": "a@b.com", "nickname": "앨리스" }
}
```

**에러**
| 상태 | message | 조건 |
| --- | --- | --- |
| 400 | 아이디, 이메일, 비밀번호, 닉네임을 모두 입력해주세요. | 필드 누락 |
| 409 | 이미 사용 중인 아이디입니다. | username 중복(동시 가입 경합 포함) |
| 500 | 서버 오류로 회원가입에 실패했습니다. | 서버 오류 |

- 비밀번호는 `bcrypt`(cost 10)로 해싱해 저장한다.

#### `POST /api/login`
로컬 로그인. 인증 불필요.

**요청 본문**
```json
{ "username": "string", "password": "string" }
```

**응답 · 200** — signup과 동일한 `{ token, user }` 구조.

**에러**
| 상태 | message | 조건 |
| --- | --- | --- |
| 400 | 아이디와 비밀번호를 입력해주세요. | 필드 누락 |
| 401 | 아이디 또는 비밀번호가 올바르지 않습니다. | 계정 없음/비번 불일치 |
| 500 | 서버 오류로 로그인에 실패했습니다. | 서버 오류 |

---

### 소셜 로그인 (OAuth)

카카오 · 구글 · 네이버 3종. 브라우저 **리다이렉트 흐름**이며 JSON API가 아니다.

#### `GET /auth/kakao` · `GET /auth/google` · `GET /auth/naver`
각 공급자의 인가(authorization) 페이지로 **302 리다이렉트**시킨다. 프론트는 이 URL로 이동시키기만 하면 된다.

#### `GET /auth/kakao/callback` · `GET /auth/google/callback` · `GET /auth/naver/callback`
공급자가 인가 코드(`code`)를 붙여 되돌아오는 콜백. 서버가 액세스 토큰 교환 → 프로필 조회 → 계정 조회/생성(`provider`+`provider_id` 기준) 후, **JWT를 쿼리스트링에 담아 프론트로 리다이렉트**한다.

- 성공(신규 가입): `302 → /?token=...&username=...&nickname=...#nickname-setup`
- 성공(기존 계정): `302 → /?token=...&username=...&nickname=...#lobby`
- 실패: `302 → /?social_error=1#login`
- 네이버는 CSRF 방지용 `state` 파라미터를 검증한다(불일치 시 400).

> 신규 소셜 계정은 `username = "<provider>_<providerId>"`, `nickname = 프로필 닉네임 or "<provider>유저"`로 생성된다. 이후 [닉네임 설정](#프로필)으로 실명/기본닉을 바꾸도록 유도한다.

---

### 프로필

#### `PATCH /api/profile/nickname`
닉네임 설정/변경 (소셜 로그인 직후 실명 노출 방지 용도). **인증 필요**.

**요청 본문**
```json
{ "nickname": "string(1~20자)" }
```

**응답 · 200**
```json
{ "nickname": "새닉네임" }
```

**에러**
| 상태 | message |
| --- | --- |
| 400 | 닉네임은 1자 이상 20자 이하로 입력해주세요. |
| 401 | 로그인이 필요합니다. / 계정을 찾을 수 없습니다. 다시 로그인해주세요. |
| 500 | 서버 오류로 닉네임을 저장하지 못했습니다. |

---

### 게임: 자음 모음 조합 (jamo)

베이스 경로 `/api/games/jamo`. 모든 엔드포인트가 `optionalAuth`(게스트 허용).

#### `GET /api/games/jamo/new?difficulty=<1|2|3>`
새 문제(셔플된 자모) 발급. 서버가 정답을 보관한다.

- **쿼리**: `difficulty` (1~3, 기본 1). 음절 수 범위 → `1:[2,2] 2:[2,3] 3:[3,4]`.

**응답 · 200**
```json
{
  "puzzleId": "uuid",
  "jamo": ["ㄷ","ㅗ","ㅅ",...],
  "difficulty": 2,
  "solutionCount": 5,
  "timeLimit": 60
}
```
- **503** `{ "error": "no_seed_words" }` — 출제 가능한 시드 단어 없음
- **500** `{ "error": "server_error" }`

#### `POST /api/games/jamo/submit`
정답 제출 · 채점. 결과는 `game_results`에 기록되고, 로그인+정답이면 `user_game_progress`에 누적된다.

**요청 본문**
```json
{ "puzzleId": "uuid", "word": "도서", "elapsedMs": 12000 }
```

**응답 · 200**
```json
{ "correct": true, "score": 92, "matched": "도서", "reason": "ok" }
```
- `reason`: `"ok"` | `"JAMO_MISMATCH"`(자모 구성 불일치) | `"NOT_IN_DICTIONARY"`(사전에 없음)
- 점수 공식(정답 시): `50 + 자모수×10 + 시간보너스 + 난이도×10` (시간보너스 = `max(0, 60 − 경과초)×2`)
- **400** `bad_request` — `puzzleId`/`word` 누락
- **404** `puzzle_not_found_or_expired` — 문제 없음/만료(발급 후 5분)
- **500** `server_error`

#### `GET /api/games/jamo/puzzle/:id/solutions`
해당 문제의 가능한 정답 목록 공개.

**응답 · 200**
```json
{ "answers": ["도서", "서도", ...] }
```
- **404** `not_found` · **500** `server_error`

#### `POST /api/games/jamo/level-clear`
레벨제 싱글에서 클리어한 레벨 반영. **로그인 필요**. (공용 진행도 라우터)

**요청 본문**: `{ "level": 5 }` → 기존 레벨과 `GREATEST`로 갱신.

**응답 · 200** `{ "ok": true }`
- **401** `login_required` · **400** `bad_request` · **500** `server_error`

#### `GET /api/games/jamo/progress`
현재 유저의 레벨/클리어 수. **로그인 필요**.

**응답 · 200** `{ "level": 5, "cleared_count": 12 }` (기록 없으면 `{ "level": 1, "cleared_count": 0 }`)
- **401** `login_required` · **500** `server_error`

---

### 게임: 다른 그림 찾기 (spot)

베이스 경로 `/api/games/spot`. 싱글 게임 로직은 클라이언트 전용이고, **레벨 진행도만** 서버에 저장한다(jamo와 동일한 공용 진행도 라우터, `game="spot"`).

#### `POST /api/games/spot/level-clear`
`{ "level": <int> }` → **200** `{ "ok": true }`. **로그인 필요**(401 `login_required`).

#### `GET /api/games/spot/progress`
**200** `{ "level": <int>, "cleared_count": <int> }`. **로그인 필요**.

> 다른 그림 찾기 **멀티플레이**는 아래 [실시간 API](#실시간-게임-다른-그림-찾기-spot)에서 서버 권위로 진행되며 DB에 저장하지 않는다(휘발성).

---

## 실시간 API (Socket.IO)

로비 채팅, 멀티플레이 방(생성/참가/비밀방/방장 설정), 실시간 대전 엔진을 모두 하나의 Socket.IO 서버가 처리한다. **방/참가자/게임 상태는 서버 메모리에만 존재**(DB 미저장, 휘발성).

### 연결

```js
import { io } from "socket.io-client";
const socket = io("https://minigameheaven-v1.madcamp-kaist.org", { path: "/socket.io" });
```

연결 즉시 서버가 보내는 이벤트:
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `modes` | `[{ id, label }]` | 사용 가능한 게임 모드 목록 (`spot`, `vowel`, `baseball`) |
| `chat:history` | `[{ user, text, ts }]` | 최근 로비 채팅 50개 |
| `rooms:update` | `[RoomSummary]` | 현재 방 목록 |
| `presence` | `[{ id, name }]` | 접속 중인 전체 유저 |

- 최초 닉네임은 `손님####`(랜덤)로 배정된다.

### 로비 · 접속자

**Client → Server**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `identify` | `name: string` (최대 24자) | 표시 이름 설정 → 전체에 `presence` 갱신 |
| `chat:message` | `text: string` (최대 300자) | 로비 채팅 전송 |

**Server → Client**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `chat:message` | `{ user, text, ts }` | 로비 채팅 브로드캐스트 |
| `presence` | `[{ id, name }]` | 접속자 목록 갱신 |
| `rooms:update` | `[RoomSummary]` | 방 목록 갱신 |

**`RoomSummary`** (방 목록용 공개 정보)
```ts
{ id, name, mode, hostName, locked: boolean, cur: number, max: number,
  state: "wait"|"play", difficulty: number, rounds: number }
```

### 방 (로비/대기실)

**Client → Server** (콜백 `cb`가 있는 경우 ack로 결과 반환)
| 이벤트 | 페이로드 | 콜백/결과 |
| --- | --- | --- |
| `room:create` | `{ name, mode, maxPlayers, difficulty, rounds, private, password }` | `cb({ ok, room }\|{ ok:false, message })` |
| `room:join` | `{ roomId, password? }` | `cb({ ok, room }\|{ ok:false, message })` |
| `room:leave` | — | `cb({ ok: true })` |
| `room:setMode` | `mode: string` | 방장 전용. 방 모드 변경 |
| `room:setConfig` | `{ difficulty, rounds }` | 방장 전용, 대기 상태에서만. 난이도/문제 수 |
| `room:ready` | — | (방장 제외) 준비 토글 |
| `room:start` | — | 방장 전용. 대기↔게임 토글 |
| `room:chat` | `text: string` | 방 채팅 |

**제약**
- 방 코드: 6자(혼동되는 `0/O`, `1/I/L` 제외 문자셋)
- 인원: 2~8명. **1대1 전용 모드(`baseball`)는 정원 2명 고정.**
- 비밀방: 비밀번호 평문 비교(방 코드 수준 낮은 민감도).
- 시작 게이트: 방장 제외 전원 준비 + 실시간 모드는 2명 이상(baseball은 정확히 2명).

**Server → Client**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `room:state` | `RoomState` | 방 상세 상태(참가자/준비/설정) |
| `room:chat` | `{ user, text, ts }` 또는 `{ sys:true, text, ts }` | 방 채팅/시스템 메시지 |
| `room:notice` | `string` | 방장에게 시작 실패 등 안내 |

**`RoomState`**
```ts
{ id, name, mode, locked, maxPlayers, state, hostId, difficulty, rounds,
  players: [{ id, name, ready: boolean }] }
```

> 게임이 시작되면(`state="play"`) 모드별 엔진이 아래 네임스페이스로 이벤트를 주고받는다. 게임 종료 시 방은 자동으로 `wait`로 복귀한다.

---

### 실시간 게임: 자음 모음 조합 (vowel)

라운드마다 셔플된 자모를 뿌리고, **동시에** 단어를 제출해 채점하는 레이스. 전원 정답 또는 타임아웃 시 정답 공개 → 다음 라운드. 순위·난이도·속도 합산 점수.

**Client → Server**
| 이벤트 | 페이로드 |
| --- | --- |
| `vowel:submit` | `{ word: string }` |

**Server → Client**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `vowel:round` | `{ index, total, jamo[], difficulty, difficultyLabel, solutionCount, timeLimit, scores }` | 새 라운드 시작 |
| `vowel:progress` | `{ solvedCount, total, solvers[], scores }` | 누군가 정답 |
| `vowel:result` | `{ correct, word?, rank?, points?, breakdown? }` 또는 `{ correct:false, reason }` | 본인 제출 결과(개인) |
| `vowel:hint` | `{ hint: string }` | 제한시간 2/3 경과 시 첫 음절 힌트 |
| `vowel:reveal` | `{ index, total, reason, answers[], roundScores[], scores }` | 라운드 종료·정답 공개 |
| `vowel:gameover` | `{ finalScores[] }` | 게임 종료 최종 순위 |
| `vowel:notice` | `{ text }` 또는 `string` | 출제 실패 등 안내 |

- 난이도 4단계: 쉬움/보통/어려움/**세종대왕**. 제한시간 = `12 + 음절수×6`초.

---

### 실시간 게임: 다른 그림 찾기 (spot)

두 격자에서 **단 하나** 다른 칸을 먼저 찾아 클릭. 오답은 짧은 쿨다운(연타 방지). 정답 위치는 공개 전까지 숨긴다.

**Client → Server**
| 이벤트 | 페이로드 |
| --- | --- |
| `spot:submit` | `{ cell: number }` (격자 인덱스) |

**Server → Client**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `spot:round` | `{ index, total, size, base[], right[], timeLimit, difficulty, difficultyLabel, scores }` | 새 라운드(두 격자). **정답 인덱스 미포함** |
| `spot:progress` | `{ solvedCount, total, solvers[], scores }` | 누군가 정답 |
| `spot:result` | `{ correct:true, cell, rank, points, breakdown }` 또는 `{ correct:false, cooldownMs }` | 본인 클릭 결과(개인) |
| `spot:reveal` | `{ index, total, reason, diff, roundScores[], scores }` | 라운드 종료·정답 위치(`diff`) 공개 |
| `spot:gameover` | `{ finalScores[] }` | 최종 순위 |
| `spot:notice` | `{ text }` 또는 `string` | 안내 |

- 난이도 4단계 → 격자 5/7/9/11, 제한시간 22/26/32/38초. 최고 난이도 라벨은 **인간프린터**.
- 오답 클릭 쿨다운 2초.

---

### 실시간 게임: 숫자야구 (baseball)

**1대1 턴제 추리 대결**(정원 2명 고정). vowel/spot의 동시 채점 레이스와 달리 독자 라이프사이클을 가진다.

**흐름**: `setup`(양쪽 비밀 숫자 설정) → `play`(번갈아 상대 숫자 추측, 서버가 S/B/Out 판정) → `over`

**판정 규칙**
- **스트라이크(S)**: 값·자리 모두 일치
- **볼(B)**: 값은 정답에 있으나 자리가 다름
- **아웃**: 정답에 없음
- **홈런**: 전부 스트라이크(정답)

**승패**
- **먼저 맞히는 사람이 승리** — 라운드 수 제한 없음(홈런까지 계속).
- 각 라운드는 양쪽 1회씩(공평성). 한쪽이 홈런해도 상대에게 그 라운드 마지막 기회를 준다 → 같은 라운드 동반 홈런이면 **무승부**, 한쪽만이면 승.
- 한 명 퇴장 시 남은 쪽 부전승(`forfeit`).
- 타이머: 설정 60초(초과 시 무작위 배정), 턴 45초(초과 시 그 라운드 기회 소진).

**설정값**
- 자릿수: 방 `difficulty` 재해석 → `1 → 3자리`, `2 → 4자리`. 0~9 중 **중복 없는** 숫자.
- 방 `rounds` 설정은 **사용하지 않음**(횟수 제한 없음).

**Client → Server**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `baseball:secret` | `{ number: string }` | 내 비밀 숫자 설정(setup) |
| `baseball:guess` | `{ number: string }` | 내 차례에 상대 숫자 추측(play) |

**Server → Client**
| 이벤트 | 페이로드 | 설명 |
| --- | --- | --- |
| `baseball:setup` | `{ digits, players:[{id,name}] }` | 설정 단계 진입 |
| `baseball:secretAck` | `{ number }` | 내 비밀 숫자 접수 확인(개인) |
| `baseball:setupProgress` | `{ readyIds[], total }` | 설정 완료 인원 |
| `baseball:state` | `{ phase, digits, round, turnId, turnName, players[], boards, remainMs }` | 대결 상태(턴 변경마다) |
| `baseball:guessResult` | `{ by, byName, number, strike, ball, out, homerun, round, timeout? }` | 추측 판정 결과(방 전체) |
| `baseball:invalid` | `{ message }` | 잘못된 입력/차례 아님(개인) |
| `baseball:gameover` | `{ result, winnerId, winnerName, secrets:{id:number}, boards, players }` | 종료. `result`: `"win"\|"draw"\|"forfeit"` |

- `boards`: `{ [socketId]: [{ number, strike, ball, out, homerun, timeout? }] }` — 각 플레이어의 추측 기록(양쪽에 공개).

---

## 데이터 모델 요약

영속 데이터는 **PostgreSQL 단일 DB**(계정 + 게임)에 저장한다. 멀티플레이 방/실시간 대전 상태는 서버 메모리(휘발성).

| 테이블 | 용도 | 핵심 컬럼 |
| --- | --- | --- |
| `users` | 계정(로컬+소셜 통합) | `username`(unique), `email`, `password_hash`, `nickname`, `provider`, `provider_id` |
| `game_results` | 모든 게임 공용 플레이 기록 | `user_id?`, `game`, `puzzle_id?`, `is_correct`, `score`, `mode`, `room_id?` |
| `user_game_progress` | 게임별 진행도(유저×게임 복합키) | `level`, `exp`, `cleared_count`, `best_score`, `meta(jsonb)` |
| `words` | 자모 게임 사전 | `word`(unique), `jamo_key`, `syllable_count`, `is_puzzle_seed` |
| `jamo_puzzles` | 발급된 자모 문제(정답 서버 보관) | `jamo_key`, `jamo_display(jsonb)`, `difficulty`, `source_word_id`(FK), `expires_at` |

- **`game` 컬럼은 범용 문자열**(`"jamo"`, `"spot"` 등)이라 새 게임 추가 시 스키마 변경이 필요 없다.
- `game_results.mode`/`room_id`는 멀티플레이 결과 연동을 위한 예비 컬럼(현재 `jamo` 싱글 제출만 기록).

---

_이 문서는 `backend/src`의 실제 라우트/이벤트 핸들러를 기준으로 작성되었다. 코드 변경 시 함께 갱신할 것._
