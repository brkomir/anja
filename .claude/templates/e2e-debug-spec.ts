/**
 * E2E debug-spec template — disposable diagnosis aid.
 *
 * WHEN TO USE: an e2e test fails and the root cause isn't obvious from the
 * Playwright error + screenshot within ~2 minutes of inspection. Instead of
 * speculating, copy this file to `tests/e2e/_debug-<topic>.spec.ts` (the
 * leading underscore keeps it out of normal runs), adapt the seed + goto
 * section to the failing test's context, and run:
 *
 *   npx playwright test tests/e2e/_debug-<topic>.spec.ts --project=desktop --reporter=list
 *
 * The `--reporter=list` flag surfaces `console.log` output to stdout so you
 * can see the dumped browser state. Delete the debug spec once diagnosis
 * is done — keep the repo clean.
 */
import { test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { ensureTestUser, authenticateContext } from "./helpers/auth";
import { getE2eDb } from "./helpers/db";

test("debug: describe what you're inspecting", async ({ page, baseURL }) => {
  // 1. Capture browser console + page errors. Both surface silent failures
  // (hydration issues, uncaught exceptions, console.warn from React).
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

  // 2. Seed whatever state the failing test needs. Use getE2eDb() directly
  // to hit the real test DB (NOT the hosted backend's mock server).
  const userId = await ensureTestUser();
  const db = getE2eDb();
  // Example: await db.execute(sql`UPDATE profiles SET plan = '<paid-plan>' WHERE id = ${userId}`);

  // 3. Authenticate (if the failing test does) and navigate to the route
  // under investigation.
  await authenticateContext(page, baseURL!);
  await page.goto(`${baseURL}/the-route-being-debugged`, {
    waitUntil: "domcontentloaded",
  });

  // 4. Give async state + toasts + hydration time to settle before capture.
  // 2-3s is plenty for most cases.
  await page.waitForTimeout(3000);

  // 5. Dump actual rendered state. These three calls expose ~90% of the
  // diagnosis space:

  // (a) Full body text — shows raw i18n keys, reversed labels, missing
  // translations, anything that `getByText(/regex/)` might be missing.
  const bodyText = await page.locator("body").innerText();
  console.log("=== BODY TEXT (first 1000 chars) ===");
  console.log(bodyText.slice(0, 1000));

  // (b) Browser console logs (captured via the listener at top).
  console.log("=== BROWSER LOGS ===");
  for (const l of logs) console.log(l);

  // (c) Specific element inspection — useful when narrowing down which of
  // multiple candidate selectors the test should use. Add one `console.log`
  // per selector you're considering.
  const toastCount = await page.locator("[data-sonner-toast]").count();
  console.log("=== TOAST COUNT:", toastCount, "===");
  if (toastCount > 0) {
    console.log(
      "=== TOAST TEXTS:",
      JSON.stringify(await page.locator("[data-sonner-toast]").allInnerTexts()),
      "===",
    );
  }

  // 6. Cleanup anything you seeded.
  // Example: await db.execute(sql`UPDATE profiles SET plan = '<free-plan>' WHERE id = ${userId}`);
});
