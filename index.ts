import { Bot } from "grammy";
import { Client } from "@notionhq/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

if (!process.env.TELEGRAM_TOKEN) throw new Error("TELEGRAM_TOKEN missing!");
if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY missing!");
if (!process.env.NOTION_DATABASE_ID) throw new Error("NOTION_DATABASE_ID missing!");
if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing!");

const bot = new Bot(process.env.TELEGRAM_TOKEN);

// ✅ Initialize Notion client (no manual binding needed)
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  notionVersion: "2022-06-28",
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.2,
    responseMimeType: "application/json",
  },
});

async function getStratagemResponse(userInput: string, pastContext: string = "") {
  const prompt = `
You are "Stratagem" — a highly intelligent, strategic, and friendly assistant for a software engineer. 
USER PROFILE:
- Skillset: Next.js, MERN, Nest.js, and Figma.
- Projects: Launching a Web Service Business in 60 days (Target: Local Market).
- Personality: Values growth, but struggles with social media posting and UI/UX design.
- Communication: Prefers Burmese for deep talk, but uses English for technical terms.

PAST CONTEXT (From Notion):
${pastContext || "No recent logs found."}

TASK:
1. Detect User Intent: "DAILY_JOURNAL", "STRATEGIC_PLAN", or "CONVERSATION".
2. IF "CONVERSATION":
   - Reply in Burmese.
   - "intent": "CONVERSATION", "replyText": "Your friendly response", "title": null, "content": null, "mermaid": null.
3. IF "STRATEGIC_PLAN":
   - "intent": "STRATEGIC_PLAN", "title": "...", "content": "...", "mermaid": "...", "replyText": "..."
4. IF "DAILY_JOURNAL":
   - "intent": "DAILY_JOURNAL", "title": "...", "content": "...", "mermaid": null, "replyText": "..."

JSON Format:
{"intent":"...", "title":"...", "content":"...", "mermaid":"...", "replyText":"..."}

User Input: ${JSON.stringify(userInput)}
`;

  try {
    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();

    if (responseText.startsWith("```json")) {
      responseText = responseText.replace(/```json|```/g, "").trim();
    }

    const sanitized = responseText.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
    return JSON.parse(sanitized);
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("AI ဆီမှ Data ရယူရာတွင် အမှားအယွင်းရှိပါသည်။");
  }
}

function splitText(text: string, limit: number = 2000): string[] {
  const chunks: string[] = [];
  if (!text) return chunks;
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.substring(i, i + limit));
  }
  return chunks;
}

// ✅ FIXED: Query Notion database using official pattern
async function getRecentNotionLogs(): Promise<string> {
  try {
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID!,
      page_size: 5,
      sorts: [
        {
          timestamp: "created_time",
          direction: "descending",
        },
      ],
    });

    if (!response.results || response.results.length === 0) {
      return "No recent entries found.";
    }

    return response.results
      .map((page: any) => {
        const titleProp = page.properties?.Name || page.properties?.title;
        const title =
          titleProp?.title?.[0]?.plain_text || "Untitled";

        return `- ${title}`;
      })
      .join("\n");
  } catch (error: any) {
    console.error("Notion Fetch Error:", error.message || error);
    return "No context available.";
  }
}

bot.on("message:text", async (ctx) => {
  const userInput = ctx.msg.text;
  const msg = await ctx.reply("Stratagem Engine မှ ခွဲခြမ်းစိတ်ဖြာနေပါတယ်... 🧠");

  try {
    const pastLogs = await getRecentNotionLogs();
    console.log("📚 Past logs:", pastLogs);

    const response = await getStratagemResponse(userInput, pastLogs);

    if (!response || typeof response !== "object") {
      throw new Error("Invalid response structure from AI");
    }

    const { intent, title, content, mermaid, replyText } = response;

    if (intent === "CONVERSATION") {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        String(replyText || "ဟိုင်း ဘရို!")
      );
      return;
    }

    if (!title || !content) {
      throw new Error("Missing required fields in AI response");
    }

    const children: any[] = [
      {
        heading_1: { rich_text: [{ text: { content: String(title) } }] },
      },
    ];

    const contentChunks = splitText(content);
    contentChunks.forEach((chunk) => {
      children.push({
        paragraph: { rich_text: [{ text: { content: chunk } }] },
      });
    });

    if (mermaid && mermaid !== "null") {
      children.push({
        heading_2: {
          rich_text: [{ text: { content: "System Mindmap" } }],
        },
      });
      const mermaidChunks = splitText(String(mermaid), 2000);
      const mermaidRichTextArray = mermaidChunks.map((chunk) => ({
        text: { content: chunk },
      }));
      children.push({
        code: { language: "mermaid", rich_text: mermaidRichTextArray },
      });
    }

    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID! },
      properties: {
        Name: { title: [{ text: { content: String(title) } }] },
      },
      children: children,
    });

    const finalMsg =
      replyText ||
      `✅ "${title}" ကို Notion ထဲမှာ သိမ်းလိုက်ပြီနော် ဘရို!`;
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, finalMsg);
  } catch (error: any) {
    console.error("❌ Error:", error);
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `❌ အမှားတစ်ခု ရှိသွားပါတယ်: ${error.message || "Unknown error"}`
    );
  }
});

bot.start();
console.log("🚀 Stratagem Bot is running with Bun...");
