import { expect, test, type Page } from "@playwright/test";

async function prepareRenderingPage(page: Page, responseText: string) {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        byokEnabled: true,
        hostedEnabled: false,
        hostedWebSearchEnabled: false,
        models: [],
        defaultModel: null,
        authenticated: false,
      }),
    });
  });
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }),
    });
  });
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: responseText },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await settings
    .getByRole("tab", { name: "Model service", exact: true })
    .click();
  await page.getByLabel("API key").fill("rendering-test-key");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Render");
  await page.getByRole("button", { name: "Send" }).click();
}

test("renders rich Markdown without executing unsafe content", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop rendering flow");
  const cspErrors: string[] = [];
  const remoteImageReferrers: Array<string | undefined> = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      cspErrors.push(message.text());
    }
  });
  await page.route("https://images.example.test/**", async (route) => {
    remoteImageReferrers.push(route.request().headers().referer);
    await route.fulfill({ contentType: "image/png", body: "" });
  });

  await prepareRenderingPage(
    page,
    `# Rendered answer

first line
second line

| Feature | Status |
| --- | --- |
| Markdown | ready |

- [x] task

> [!NOTE]
> Safe alert content.

Inline \\(x^2\\) and display:

\\[y = mx + b\\]

\`\`\`ts
const cherry: string = "chat";
\`\`\`

[Safe link](https://example.com)
[Unsafe link](javascript:alert(1))
![Remote diagram](https://images.example.test/diagram.png)

<script>window.__cherrychatXss = true</script>
<iframe src="https://evil.example"></iframe>

\`\`\`mermaid
graph TD
  A[Start] --> B[Done]
\`\`\``,
  );

  const markdown = page.locator(".message-markdown");
  await expect(
    markdown.getByRole("heading", { name: "Rendered answer" }),
  ).toBeVisible();
  await expect(markdown.getByRole("table")).toBeVisible();
  await expect(markdown.getByRole("checkbox")).toBeChecked();
  await expect(markdown.locator(".markdown-alert-note")).toBeVisible();
  await expect(markdown.locator(".katex").first()).toBeVisible();
  await expect(markdown.getByTitle("Copy code")).toBeVisible();

  const safeLink = markdown.getByRole("link", { name: "Safe link" });
  await expect(safeLink).toHaveAttribute("target", "_blank");
  await expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(markdown.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(markdown.locator("script, iframe, object")).toHaveCount(0);
  expect(await page.evaluate(() => "__cherrychatXss" in window)).toBe(false);

  await expect(
    markdown.getByRole("img", { name: "Remote diagram" }),
  ).toHaveCount(0);
  expect(remoteImageReferrers).toEqual([]);
  await markdown
    .getByRole("button", { name: "Load remote image: Remote diagram" })
    .click();
  const remoteImage = markdown.getByRole("img", { name: "Remote diagram" });
  await expect(remoteImage).toHaveAttribute("loading", "lazy");
  await expect(remoteImage).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect.poll(() => remoteImageReferrers).toEqual([undefined]);

  await expect(
    markdown.getByRole("img", { name: "Mermaid chart" }),
  ).toBeVisible({
    timeout: 15_000,
  });
  expect(cspErrors).toEqual([]);
});

test("shows Mermaid errors together with the original source", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop rendering flow");
  await prepareRenderingPage(
    page,
    `\`\`\`mermaid
this is not valid mermaid syntax
\`\`\``,
  );

  const markdown = page.locator(".message-markdown");
  const error = markdown.getByRole("alert");
  await expect(error).toContainText("The diagram could not be displayed", {
    timeout: 15_000,
  });
  await expect(error).toContainText("this is not valid mermaid syntax");
  await expect(
    error.getByRole("button", { name: "Show diagram again" }),
  ).toBeVisible();
});
