import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { claimJob, recoverExhaustedJobs, runJob } from "../lib/billing/worker";
import { reconcilePayments } from "../lib/billing/payments";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  console.log("Article worker started.");
  // Payment recovery runs independently while a long article is being generated.
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling || !process.env.STRIPE_SECRET_KEY) return;
    reconciling = true;
    try { await reconcilePayments(); } catch { console.error("Payment recovery will retry."); }
    finally { reconciling = false; }
  };
  const timer = setInterval(() => { void reconcile(); }, 30000);
  void reconcile();
  try {
    while (!stopping) {
      try {
        await recoverExhaustedJobs();
        const job = await claimJob();
        if (job) await runJob(job);
        else await setTimeout(2000);
      } catch (error) {
        console.error("Article worker will retry:", error instanceof Error ? error.message : "Unknown error");
        await setTimeout(5000);
      }
    }
  } finally { clearInterval(timer); }
}
main().then(() => process.exit(0)).catch(() => process.exit(1));
