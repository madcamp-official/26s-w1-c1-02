const KAKAO_AUTH_URL = "https://kauth.kakao.com/oauth/authorize";
const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_USERINFO_URL = "https://kapi.kakao.com/v2/user/me";

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.KAKAO_CLIENT_ID,
    redirect_uri: process.env.KAKAO_REDIRECT_URI,
    response_type: "code",
  });
  return `${KAKAO_AUTH_URL}?${params.toString()}`;
}

async function getAccessToken(code) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.KAKAO_CLIENT_ID,
    redirect_uri: process.env.KAKAO_REDIRECT_URI,
    code,
  });
  // 카카오 앱에서 'Client Secret 사용함'이 켜져 있으면 토큰 요청에 필수
  if (process.env.KAKAO_CLIENT_SECRET) {
    params.set("client_secret", process.env.KAKAO_CLIENT_SECRET);
  }
  const res = await fetch(KAKAO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "카카오 토큰 발급 실패");
  return data.access_token;
}

async function getProfile(accessToken) {
  const res = await fetch(KAKAO_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error("카카오 프로필 조회 실패");
  return {
    providerId: String(data.id),
    email: data.kakao_account?.email || null,
    nickname: data.kakao_account?.profile?.nickname || data.properties?.nickname || null,
  };
}

module.exports = { getAuthUrl, getAccessToken, getProfile };
