const jwt = require("jsonwebtoken");

// 토큰이 있으면 검증해서 req.userId를 채우고, 없거나 유효하지 않으면 그냥 게스트로 통과시킨다.
function optionalAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme === "Bearer" && token) {
    try {
      req.userId = jwt.verify(token, process.env.JWT_SECRET).userId;
    } catch (e) {
      // 만료/위조 토큰: 게스트 취급
    }
  }
  next();
}

module.exports = { optionalAuth };
