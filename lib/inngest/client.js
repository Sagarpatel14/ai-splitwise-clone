import { Inngest } from "inngest";
import { Resend } from "resend";

export const inngest = new Inngest({
  id: "splitr",
  name: "Splitr",
});

// Constructed only when the key exists so `next build` does not crash.
// Payment reminders and spending insights still send mail through this client
// and through the Convex Resend action.
export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
