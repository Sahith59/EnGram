import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/anthropic";
import crypto from "crypto";

function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const fiveMinutes = 5 * 60;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > fiveMinutes) {
    return false;
  }
  const sigBase = `v0:${timestamp}:${body}`;
  const expected =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBase, "utf8")
      .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(request: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: "Slack not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature") ?? "";
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const text = params.get("text")?.trim() ?? "";
  const slackTeamId = params.get("team_id") ?? "";
  const userId = params.get("user_id") ?? "";
  const userName = params.get("user_name") ?? "someone";

  if (!text) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Usage: `/engram <your question>`",
    });
  }

  const supabase = await createClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("team_id, config")
    .eq("type", "slack")
    .eq("enabled", true)
    .filter("config->>slack_team_id", "eq", slackTeamId)
    .maybeSingle();

  if (!integration) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "ENGRAM is not connected to this Slack workspace. Visit your ENGRAM dashboard to connect.",
    });
  }

  const teamId = integration.team_id;

  const { data: results } = await supabase
    .from("context_snapshots")
    .select("id, title, summary, decision, ai_tool, created_at")
    .eq("team_id", teamId)
    .or(
      `title.ilike.%${text}%,summary.ilike.%${text}%,decision.ilike.%${text}%`
    )
    .order("created_at", { ascending: false })
    .limit(8);

  const sources = results ?? [];

  if (sources.length === 0) {
    return NextResponse.json({
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*ENGRAM:* No relevant context found for _"${text}"_\n\nTry capturing more AI conversations using the ENGRAM browser extension.`,
          },
        },
      ],
    });
  }

  const contextBlock = sources
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title} (${s.ai_tool}): ${s.summary ?? s.decision ?? "No summary"}`
    )
    .join("\n");

  let answer = "Unable to synthesize answer.";
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Answer this question concisely for a Slack message (max 3 sentences, no markdown headers):
Question: ${text}
Context from team's AI conversation history:
${contextBlock}`,
        },
      ],
    });
    if (message.content[0].type === "text") {
      answer = message.content[0].text;
    }
  } catch (err) {
    console.error("Slack Haiku synthesis error:", err);
  }

  const sourceList = sources
    .slice(0, 3)
    .map((s, i) => `• [${i + 1}] ${s.title} (${s.ai_tool})`)
    .join("\n");

  return NextResponse.json({
    response_type: "in_channel",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*@${userName} asked:* _${text}_`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*ENGRAM Answer:*\n${answer}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*Sources:*\n${sourceList}`,
          },
        ],
      },
    ],
  });
}
