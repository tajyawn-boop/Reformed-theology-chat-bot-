// api/chat.js
// Vercel 서버리스 함수 — Google Gemini API에 안전하게 요청을 전달합니다.
// API 키는 이 파일 안에서만 쓰이고, Vercel 서버에서만 실행되므로
// 사용자 브라우저에는 절대 노출되지 않습니다.
 
const SYSTEM_PROMPT = `당신은 청소년·청년부 신앙 안내 챗봇 '길벗'입니다. 개혁주의(Reformed) 신학 전통 안에서, 10대 후반~20대 청년들의 질문에 따뜻하고 친근하게 한국어로 답합니다.
 
기준이 되는 신앙 표준:
- 성경 (최종 권위, Sola Scriptura)
- 웨스트민스터 신앙고백서 및 대·소요리문답
- 하이델베르크 요리문답, 벨직 신앙고백, 도르트 신경
- 칼빈주의 5대 교리(TULIP), 종교개혁의 다섯 솔라
 
대상과 어조:
- 사용자는 청소년·청년입니다. 친근하고 다정한 반말체("~해", "~야", "~지")로 말합니다. 단, 가볍거나 장난스럽지 않게 진중함을 유지합니다.
- 어려운 신학 용어가 나오면 반드시 일상 언어로 풀어 설명하고, 가능하면 수련회·학업·진로·관계·불안 같은 청년의 삶의 맥락과 연결합니다.
- 청년들이 흔히 느끼는 의심이나 부담(예: 예정론, 구원의 확신 없음)을 정죄하지 않고, 공감하며 신앙적으로 안내합니다.
 
답변 지침:
1. 개혁주의 입장을 충실하고 정확하게 설명하되, 다른 정통 개신교 전통(아르미니우스주의 등)이 다르게 보는 지점이 있으면 공정하게 언급합니다.
2. 가능하면 관련 성경 구절이나 신앙고백 문항을 한두 개 제시합니다.
3. 답변은 너무 길지 않게(3~4문단 이내) 정리합니다.
4. 개혁주의 신앙·신학·교회생활과 무관한 질문에는 정중히 챗봇의 역할 범위를 설명하고 본래 주제로 돌아옵니다.
5. 정신적·정서적으로 힘들어 보이는 신호가 있으면, 신앙적 위로와 함께 신뢰할 수 있는 어른·목회자·전문가와 이야기 나누기를 따뜻하게 권합니다.
6. 논쟁적 세부 사항은 겸손하게 다루고, 깊은 분별은 교회 공동체와 목회자의 가르침을 권합니다.
 
형식: 자연스러운 문단으로 답하세요. 핵심 용어는 **굵게**, 인용·강조는 *기울임*으로 표시할 수 있습니다.
- 관련 성경/신앙고백 출처가 있으면 "[참고] ..." 형식으로 한 줄 덧붙입니다.
- 답변 맨 마지막 줄에는 반드시 사용자가 이어서 물어볼 만한 후속 질문 2개를 "[추천] 질문1 | 질문2" 형식으로 제시합니다. 후속 질문은 짧고 구체적으로 작성합니다.`;
 
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 허용됩니다." });
  }
 
  const apiKey = process.env.GEMINI_API_KEY;
  // 모델 이름을 환경 변수로 분리 — 모델이 교체되어도 코드 수정 없이
  // Vercel 설정에서 한 줄만 바꾸면 됩니다. 미설정 시 안전한 기본값 사용.
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
 
  if (!apiKey) {
    return res.status(500).json({
      error: "서버에 API 키가 없습니다. Vercel 환경 변수 'GEMINI_API_KEY'를 확인하세요.",
    });
  }
 
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages가 필요합니다." });
    }
 
    // 비용·악용 방지: 최근 20개 메시지만 유지
    const trimmed = messages.slice(-20);
 
    // Gemini 형식으로 변환:
    //  - role 'assistant' -> 'model'
    //  - content 문자열 -> { parts: [{ text }] }
    const contents = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content || "") }],
    }));
 
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);
 
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // 시스템 프롬프트는 Gemini의 전용 필드로 전달
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents,
        // gemini-2.5-flash는 답변 전에 내부 '사고(thinking)'에도 토큰을 씁니다.
        // 한도가 낮으면 첫 질문에서 사고만 하다 끝나 빈 답이 나올 수 있어
        // 넉넉히 잡습니다.
        generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
      }),
    });
 
    const data = await geminiRes.json();
 
    // ── 구체적인 오류 메시지 — 무엇이 잘못됐는지 바로 알 수 있게 ──
    if (!geminiRes.ok) {
      const msg = (data && data.error && data.error.message) || "";
      console.error("Gemini API error:", msg);
 
      if (geminiRes.status === 400 && /API key not valid/i.test(msg)) {
        return res.status(502).json({
          error: "API 키가 올바르지 않습니다. Google AI Studio에서 키를 다시 확인하세요.",
        });
      }
      if (geminiRes.status === 404) {
        return res.status(502).json({
          error:
            "모델 '" + model + "'을(를) 찾을 수 없습니다. 환경 변수 'GEMINI_MODEL'을 확인하세요.",
        });
      }
      if (geminiRes.status === 429) {
        return res.status(502).json({
          error: "오늘의 무료 사용 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
        });
      }
      return res.status(502).json({ error: "AI 응답 오류: " + (msg || "알 수 없는 오류") });
    }
 
    const candidate = data?.candidates?.[0];
    const answer =
      (candidate?.content?.parts || []).map((p) => p.text || "").join("").trim();
 
    if (!answer) {
      // 답이 비었을 때 원인을 구분해 안내합니다.
      // finishReason이 MAX_TOKENS면 사고(thinking)에 토큰을 다 쓴 경우입니다.
      const reason = candidate?.finishReason || "";
      if (reason === "MAX_TOKENS") {
        return res.status(502).json({
          error:
            "답변 한도가 부족했습니다. chat.js의 maxOutputTokens 값을 더 올려주세요.",
        });
      }
      return res.status(502).json({
        error: "AI가 빈 응답을 보냈습니다. 다시 한 번 질문해 주세요.",
      });
    }
 
    return res.status(200).json({ answer });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}
