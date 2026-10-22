import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { baseUrl, credentials, ROLES, storageStatePath, syntheticAgency } from "./support/env";
import { signIn } from "./support/session";

// Signs in each configured synthetic role once and keeps its session for the run.
export default async function globalSetup(config: FullConfig) {
  baseUrl();
  syntheticAgency();
  await mkdir("e2e/.auth", { recursive: true });
  const executablePath = config.projects[0]?.use?.launchOptions?.executablePath;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    for (const role of ROLES) {
      if (!credentials(role)) continue;
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, role);
      await context.storageState({ path: storageStatePath(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
