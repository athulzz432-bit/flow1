export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const code = process.env.ACCESS_CODE;
  if (code && req.headers["x-access-code"] !== code) {
    return res.status(401).json({ error: "Wrong access code." });
  }

  let msgs = req.body && req.body.messages;
  if (!Array.isArray(msgs) || !msgs.length) return res.status(400).json({ error: "No messages." });
  msgs = msgs
    .slice(-30)
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
  if (!msgs.length || msgs[0].role !== "user") return res.status(400).json({ error: "Bad messages." });

  try {
    let reply = "";
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
          max_tokens: 600,
          messages: msgs,
        }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: (d.error && d.error.message) || "Anthropic API error." });
      reply = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    } else if (process.env.GROQ_API_KEY) {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + process.env.GROQ_API_KEY,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
          max_tokens: 600,
          messages: msgs,
        }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: (d.error && d.error.message) || "Groq API error." });
      reply = (d.choices && d.choices[0] && d.choices[0].message.content) || "";
    } else if (process.env.OPENAI_API_KEY) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + process.env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          max_tokens: 600,
          messages: msgs,
        }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: (d.error && d.error.message) || "OpenAI API error." });
      reply = (d.choices && d.choices[0] && d.choices[0].message.content) || "";
    } else {
      return res.status(500).json({ error: "No API key set on the server." });
    }
    res.status(200).json({ reply });
  } catch (e) {
    res.status(502).json({ error: "Could not reach the AI service." });
  }
}
