import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import Groq from "groq-sdk";
import { inngest, resend } from "./client";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);

function getGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }
  return new Groq({ apiKey });
}

function requireResendKey() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }
  return process.env.RESEND_API_KEY;
}

export const spendingInsights = inngest.createFunction(
  { name: "Generate Spending Insights", id: "generate-spending-insights" },
  { cron: "0 8 1 * *" }, // 1st of every month at 08:00
  async ({ step }) => {
    const users = await step.run("Fetch users with expenses", async () => {
      return await convex.query(api.inngest.getUsersWithExpenses);
    });

    const results = [];

    for (const user of users) {
      const expenses = await step.run(`Expenses · ${user._id}`, () =>
        convex.query(api.inngest.getUserMonthlyExpenses, { userId: user._id })
      );
      if (!expenses?.length) continue;

      const expenseData = JSON.stringify({
        expenses,
        totalSpent: expenses.reduce((sum, e) => sum + e.amount, 0),
        categories: expenses.reduce((cats, e) => {
          cats[e.category ?? "uncategorised"] =
            (cats[e.category] ?? 0) + e.amount;
          return cats;
        }, {}),
      });

      const prompt = `
As a financial analyst, review this user's spending data for the past month and provide insightful observations and suggestions.
Focus on spending patterns, category breakdowns, and actionable advice for better financial management.
Use a friendly, encouraging tone. Return raw HTML only for an email. Do not wrap the answer in markdown code fences.

User spending data:
${expenseData}

Provide your analysis in these sections:
1. Monthly Overview
2. Top Spending Categories
3. Unusual Spending Patterns (if any)
4. Saving Opportunities
5. Recommendations for Next Month
      `.trim();

      try {
        const htmlBody = await step.ai.wrap(
          "groq",
          async (p) => {
            const completion = await getGroq().chat.completions.create({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: p }],
            });
            return completion.choices[0]?.message?.content ?? "";
          },
          prompt
        );

        const html = `
              <h1>Your Monthly Financial Insights</h1>
              <p>Hi ${user.name},</p>
              <p>Here's your personalized spending analysis for the past month:</p>
              ${htmlBody}
            `;

        await step.run(`Email · ${user._id}`, async () => {
          const apiKey = requireResendKey();

          if (resend) {
            const result = await resend.emails.send({
              from: "Splitr <onboarding@resend.dev>",
              to: user.email,
              subject: "Your Monthly Spending Insights",
              html,
            });
            return result;
          }

          return convex.action(api.email.sendEmail, {
            to: user.email,
            subject: "Your Monthly Spending Insights",
            html,
            apiKey,
          });
        });

        results.push({ userId: user._id, success: true });
      } catch (err) {
        results.push({
          userId: user._id,
          success: false,
          error: err.message,
        });
      }
    }

    return {
      processed: results.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }
);
