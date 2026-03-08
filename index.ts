import { Bot } from "grammy";
import { Client } from "@notionhq/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const bot = new Bot(process.env.TELEGRAM_TOKEN!);
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.2,
    responseMimeType: "application/json",
  }
});

async function getStratagemResponse(userInput: string) {
  const prompt = `
You are "Stratagem" — a highly intelligent, strategic, and friendly assistant for a software engineer. 
You understand the user's focus on web development, system architecture, and daily growth.

TASK:
1. Detect User Intent: Is this a "DAILY_JOURNAL", a "STRATEGIC_PLAN", or just a "CONVERSATION"?
2. IF "CONVERSATION":
   - You must act as a supportive, smart tech-friend.
   - Reply in Burmese.
   - "intent": "CONVERSATION"
   - "replyText": Your friendly response.
   - "title", "content", "mermaid": null.
3. IF "STRATEGIC_PLAN" or "DAILY_JOURNAL":
   - "replyText": A short encouraging message in Burmese acknowledging the save. (e.g., "မိုက်တယ်! Notion ထဲ သိမ်းလိုက်ပြီနော်။")
   - (Follow previous rules for title, content, and mermaid).

MERMAID RULES (CRITICAL):
- Use this exact format for root: root(("Title"))
- No nested parentheses inside nodes.
- Keep the mindmap concise (under 1500 characters).

JSON Format:
{"intent":"DAILY_JOURNAL"|"STRATEGIC_PLAN"|"CONVERSATION", "title":"...", "content":"...", "mermaid":"...", "replyText":"..."}

User Input: ${JSON.stringify(userInput)}
`;

  try {
    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();

    console.log("Raw Gemini response:", responseText); // Debug log

    // Clean JSON format if wrapped in markdown
    if (responseText.startsWith("```json")) {
      responseText = responseText.replace(/```json|```/g, "").trim();
    }

    // Clean invisible characters that might break JSON parsing
    const sanitized = responseText.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    return JSON.parse(sanitized);
  } catch (error) {
    console.error("Gemini API Error or Parse Error:", error);
    throw new Error("AI ဆီမှ Data ရယူရာတွင် အမှားအယွင်းရှိပါသည်။");
  }
}

function splitText(text: string, limit: number = 2000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.substring(i, i + limit));
  }
  return chunks;
}

bot.on("message:text", async (ctx) => {
  const userInput = ctx.msg.text;
  const msg = await ctx.reply("Stratagem Engine မှ ခွဲခြမ်းစိတ်ဖြာနေပါတယ်... 🧠");

  try {
    const response = await getStratagemResponse(userInput);

    if (!response || typeof response !== 'object') {
      throw new Error("Invalid response structure from AI");
    }

    const { intent, title, content, mermaid } = response;

    if (!title || !content) {
      throw new Error("Missing required fields in AI response");
    }

    const children: any[] = [
      {
        heading_1: { rich_text: [{ text: { content: String(title) } }] }
      }
    ];

    // ✅ FIXED: Different formatting based on intent
    if (intent === "STRATEGIC_PLAN") {
      children.push({
        paragraph: { rich_text: [{ text: { content: String(content) } }] }
      });
    } else {
      const contentChunks = splitText(content);
      contentChunks.forEach(chunk => {
        children.push({
          paragraph: { rich_text: [{ text: { content: chunk } }] }
        });
      });
    }

    // Always add Mermaid if it exists and is not "null"
    if (mermaid && mermaid !== "null") {
      children.push({
        heading_2: { rich_text: [{ text: { content: "System Mindmap" } }] }
      });


      const mermaidChunks = splitText(String(mermaid), 2000);
      const mermaidRichTextArray = mermaidChunks.map(chunk => ({
        text: { content: chunk }
      }));

      children.push({
        code: {
          language: "mermaid",
          rich_text: mermaidRichTextArray
        }
      });
    }

    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID! },
      properties: {
        "Name": {
          title: [{ text: { content: String(title) } }]
        }
      },
      children: children
    });

    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `✅ "${title}" ကို Notion ထဲမှာ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။`);

  } catch (error: any) {
    console.error("Error Detail:", error);

    let errorMsg = "❌ လုပ်ငန်းစဉ်မှာ အမှားတစ်ခု ရှိသွားပါတယ်။";

    if (error.message?.includes("JSON") || error.message?.includes("Unexpected token")) {
      errorMsg = "❌ AI response မှာ ပြဿနာရှိနေပါတယ်။ ထပ်မံကြိုးစားကြည့်ပါ။";
    } else if (error.message?.includes("rate limit")) {
      errorMsg = "⏳ Rate limit ရောက်နေပါတယ်။ ၁ မိနစ်စောင့်ပြီး ထပ်ကြိုးစားပါ။";
    }

    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, errorMsg);
  }
});

bot.start();
console.log("🚀 Stratagem Bot is running with Bun...");