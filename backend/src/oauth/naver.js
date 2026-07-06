const NAVER_AUTH_URL = "https://nid.naver.com/oauth2.0/authorize";
const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
const NAVER_USERINFO_URL = "https://openapi.naver.com/v1/nid/me";

const STATE = "mgh_naver_login";

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.NAVER_CLIENT_ID,
    redirect_uri: process.env.NAVER_REDIRECT_URI,
    response_type: "code",
    state: STATE,
  });
  return `${NAVER_AUTH_URL}?${params.toString()}`;
}

async function getAccessToken(code, state) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.NAVER_CLIENT_ID,
    client_secret: process.env.NAVER_CLIENT_SECRET,
    code,
    state,
  });
  const res = await fetch(`${NAVER_TOKEN_URL}?${params.toString()}`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error_description || "네이버 토큰 발급 실패");
  return data.access_token;
}

async function getProfile(accessToken) {
  const res = await fetch(NAVER_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || data.resultcode !== "00") throw new Error("네이버 프로필 조회 실패");
  const p = data.response;
  return {
    providerId: String(p.id),
    email: p.email || null,
    nickname: p.nickname || p.name || null,
  };
}

module.exports = { getAuthUrl, getAccessToken, getProfile, STATE };
