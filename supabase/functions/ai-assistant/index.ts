const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (Array.isArray(payload?.output)) {
    const texts = payload.output
      .flatMap((entry: any) => Array.isArray(entry?.content) ? entry.content : [])
      .map((item: any) => item?.text || item?.output_text || "")
      .filter((value: string) => typeof value === "string" && value.trim().length > 0)

    if (texts.length > 0) return texts.join("\n\n").trim()
  }

  throw new Error("OpenAI returned an unreadable response.")
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY")
    if (!openAiApiKey) {
      throw new Error("OPENAI_API_KEY is not configured for the ai-assistant function.")
    }

    const body = await request.json()
    const model = body?.model || Deno.env.get("OPENAI_MODEL") || "gpt-5.4-mini"
    const feature = body?.feature || "Scheduler Assistant"
    const instruction = body?.instruction || "Explain the current operational state and provide practical guidance."
    const context = typeof body?.context === "string" ? body.context : JSON.stringify(body?.context || {}, null, 2)
    const systemPrompt =
      body?.systemPrompt ||
      "You are an operations scheduling assistant for public safety scheduling software. Give concise, practical answers. Prefer bullets."

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: systemPrompt
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `Feature: ${feature}`,
                  instruction,
                  "",
                  "Context:",
                  context,
                  "",
                  "Return concise markdown with a short summary and flat bullet points."
                ].join("\n")
              }
            ]
          }
        ]
      })
    })

    if (!openAiResponse.ok) {
      const text = await openAiResponse.text()
      throw new Error(text || `OpenAI request failed with status ${openAiResponse.status}.`)
    }

    const payload = await openAiResponse.json()
    const text = extractResponseText(payload)

    return new Response(JSON.stringify({ text }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ai-assistant function error."
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    })
  }
})
