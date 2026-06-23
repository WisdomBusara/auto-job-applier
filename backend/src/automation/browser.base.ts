import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const SESSION_DIR = "./data/sessions";

export class BrowserBase {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected platformName = "base";

  protected async launch(headless = true): Promise<Page> {
    this.browser = await chromium.launch({
      headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
      ],
    });

    const sessionFile = this.sessionPath();
    let storageState: string | undefined;
    if (fs.existsSync(sessionFile)) {
      storageState = sessionFile;
      logger.info(`[${this.platformName}] Restoring saved session`);
    }

    this.context = await this.browser.newContext({
      storageState,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    // Remove webdriver flag — anti-bot detection
    await this.context.addInitScript(
      "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
    );

    this.page = await this.context.newPage();
    return this.page;
  }

  protected sessionPath(): string {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    return path.join(SESSION_DIR, `${this.platformName}-session.json`);
  }

  protected async saveSession(): Promise<void> {
    if (!this.context) return;
    try {
      await this.context.storageState({ path: this.sessionPath() });
      logger.info(`[${this.platformName}] Session saved`);
    } catch (err) {
      logger.warn(`[${this.platformName}] Failed to save session`, { err: String(err) });
    }
  }

  protected clearSession(): void {
    const p = this.sessionPath();
    if (fs.existsSync(p)) { fs.unlinkSync(p); logger.info(`[${this.platformName}] Session cleared`); }
  }

  async close(): Promise<void> {
    try {
      await this.page?.close();
      await this.context?.close();
      await this.browser?.close();
    } catch (err) {
      logger.warn(`[${this.platformName}] Error closing browser`, { err: String(err) });
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }

  protected async delay(minMs = 600, maxMs = 2200): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs);
    await new Promise<void>((r) => setTimeout(r, ms));
  }

  protected async humanType(selector: string, text: string): Promise<void> {
    const p = this.requirePage();
    await p.click(selector);
    await p.fill(selector, "");
    for (const char of text) {
      await p.type(selector, char, { delay: 60 + Math.random() * 80 });
    }
    await this.delay(200, 400);
  }

  protected async safeClick(selector: string, retries = 3): Promise<void> {
    const p = this.requirePage();
    for (let i = 0; i < retries; i++) {
      try {
        await p.waitForSelector(selector, { timeout: 8000, state: "visible" });
        await this.delay(200, 500);
        await p.click(selector);
        return;
      } catch (err) {
        if (i === retries - 1) throw err;
        logger.debug(`[${this.platformName}] safeClick retry ${i + 1} — ${selector}`);
        await this.delay(1000, 2000);
      }
    }
  }

  protected async scrollDown(steps = 3): Promise<void> {
    const p = this.requirePage();
    for (let i = 0; i < steps; i++) {
      await p.evaluate(() => window.scrollBy(0, window.innerHeight * 0.6));
      await this.delay(400, 800);
    }
  }

  protected async exists(selector: string, timeout = 3000): Promise<boolean> {
    const p = this.requirePage();
    try {
      await p.waitForSelector(selector, { timeout, state: "visible" });
      return true;
    } catch { return false; }
  }

  protected async screenshot(tag: string): Promise<void> {
    if (!this.page) return;
    const dir = "./logs/screenshots";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      await this.page.screenshot({
        path: path.join(dir, `${this.platformName}-${tag}-${Date.now()}.png`),
        fullPage: false,
      });
    } catch { /* non-critical */ }
  }

  protected requirePage(): Page {
    if (!this.page) throw new Error(`[${this.platformName}] Browser not launched — call launch() first`);
    return this.page;
  }
}
