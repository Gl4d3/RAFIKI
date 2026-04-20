// RAFIKI AI layer — powered by Google Gemini
// This layer ONLY does: natural language generation.
// It never computes numbers. That is the Accountant's job.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { FinancialSummary, EntitySummary } from "./accountant";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 1024,
  },
});

// RAFIKI system personality
const RAFIKI_PERSONA = `You are RAFIKI, a warm, calm, and intelligent personal finance companion built for Kenya. 
You speak in a friendly, conversational tone — like a trusted financial friend, not a bank.
You use plain English. You may occasionally use a Swahili phrase naturally (like "pole pole" or "poa") but keep it minimal.
You never use emojis. You never use bullet points or lists in conversational messages.
You are concise — your messages are short, warm, and specific to the actual numbers.
You always reference actual numbers from the analysis — never speak in vague terms.
The currency is always written as "KSh" followed by the amount with commas (e.g. KSh 8,000).`;

export async function generateRevealMessage(
  summary: FinancialSummary
): Promise<string> {
  const transportTotal = summary.topCategories.find(
    (c) => c.category === "transport"
  );
  const topCategory = summary.topCategories[0];

  const prompt = `${RAFIKI_PERSONA}

I've analysed the user's M-Pesa statement. Here is what the Accountant found:

Estimated monthly salary: KSh ${summary.estimatedSalary.toLocaleString()} from "${summary.salarySource}"
Total spending analysed: KSh ${summary.totalDebits.toLocaleString()} over ${summary.transactionCount} transactions

Top spending categories:
${summary.topCategories
  .slice(0, 4)
  .map((c) => `- ${c.label}: KSh ${c.total.toLocaleString()}`)
  .join("\n")}

Recurring obligations found: ${summary.recurringObligations.length}
${summary.recurringObligations
  .slice(0, 3)
  .map((e) => `- ${e.name}: KSh ${e.monthlyAmount.toLocaleString()}/month`)
  .join("\n")}

Unknown transactions needing clarification: ${summary.unknownEntities.length}

Write RAFIKI's reveal message. This is the "it already knows me" moment — the first time the user sees what RAFIKI found.

Rules:
- Lead with the most striking or surprising insight (usually transport total or a high spend category)
- Be specific — use the actual numbers
- Keep it to 3-4 short sentences maximum
- End with something like "Does that look right to you?" to invite confirmation
- Sound warm and human, not like a bank statement
- Do NOT list everything — pick the 1-2 most interesting findings and focus on those`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Gemini error:", error);
    // Fallback to template if AI fails
    const cat = topCategory
      ? `KSh ${topCategory.total.toLocaleString()} on ${topCategory.label}`
      : "significant amounts";
    return `I've gone through your M-Pesa history and I can see a clear picture of your money. You're spending ${cat} — that stood out to me. Your salary from ${summary.salarySource} is coming in at around KSh ${summary.estimatedSalary.toLocaleString()} a month. Does that look right to you?`;
  }
}

export async function generateGapFillingQuestion(
  entity: EntitySummary
): Promise<string> {
  const prompt = `${RAFIKI_PERSONA}

I need to ask the user about an unresolved transaction. Here are the details:

Counterparty name: "${entity.name}"
Total amount: KSh ${entity.totalAmount.toLocaleString()}
Number of times it appeared: ${entity.occurrences}
Estimated monthly amount: KSh ${entity.monthlyAmount.toLocaleString()}
Frequency: ${entity.frequency}
Last seen: ${entity.lastSeen.toLocaleDateString("en-KE")}

Write a single, natural, conversational question asking the user what this transaction is.
The question should:
- Reference the specific counterparty name and amount
- Be warm and non-judgmental
- Be one sentence only
- Not use the word "counterparty" or "transaction" — use "payment" or "transfer" instead
- Make it easy to answer by hinting at what kind of thing it might be

Example style: "I keep seeing KSh 2,000 going to Peter every month — is that a regular debt repayment or family support?"`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Gemini error:", error);
    return `I noticed ${entity.occurrences} payments to "${entity.name}" totalling KSh ${entity.totalAmount.toLocaleString()}. What is this for?`;
  }
}
