import { expect, test } from "./source-fixture.mjs";
import { watchPageErrors } from "./page-errors.mjs";

// DOM emulators cannot prove flex layout, content containment or pointer hit targets.
// Actual PrimarySidebar/SoloInventory owners run with the host's globals, four workers and real assigned-profile avatars.
test("task selection rows fit stacked labels and keep Workers on a separate hit target", async ({
  page,
}) => {
  const { errors } = watchPageErrors(page);
  await page.goto("/tests/browser/solo-task-cards.html");
  const parent = page.getByRole("button", { name: /^Planning/ });
  const child = page.getByRole("button", { name: /^Review/ });
  const workers = page.getByRole("button", { name: /4 Workers/ });
  await expect(child).toHaveAttribute("aria-current", "page");
  for (const theme of ["light", "dark"]) {
    for (const width of [220, 260, 320]) {
      await page.setViewportSize({
        width: width === 220 ? 640 : 1440,
        height: 950,
      });
      await page.goto(
        `/tests/browser/solo-task-cards.html?width=${width}&theme=${theme}`,
      );
      await expect(child).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".shell-sidebar")).toHaveCSS(
        "width",
        `${width}px`,
      );
      for (const status of ["running", "waiting", "done", "failed"]) {
        await expect(page.locator("[data-solo-worker-summary]")).toContainText(
          `1 ${status}`,
        );
      }
      for (const textSize of [16, 20]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, textSize);
        const box = await parent.boundingBox();
        const footer = await workers.boundingBox();
        expect(box.width).toBeGreaterThan(100);
        expect(footer.y).toBeGreaterThanOrEqual(box.y + box.height);
        for (const row of [parent, child]) {
          expect(
            await row.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const label = element
                .querySelector(".navigation-item-label")
                .getBoundingClientRect();
              return (
                label.top >= box.top &&
                label.bottom <= box.bottom &&
                label.left >= box.left &&
                label.right <= box.right
              );
            }),
          ).toBe(true);
          await row.hover();
          expect(
            await row.evaluate((element) => {
              const label = element
                .querySelector(".navigation-item-label")
                .getBoundingClientRect();
              const action = element
                .closest("[data-solo-menu-id]")
                .querySelector("[data-solo-row-action]")
                .getBoundingClientRect();
              return label.right <= action.left;
            }),
          ).toBe(true);
          await row.click({ trial: true });
        }
        expect(
          await page
            .locator("[data-solo-worker-summary]")
            .evaluate((summary) => {
              const card = summary
                .closest("[data-navigation-card]")
                .getBoundingClientRect();
              return [...summary.children].every((item) => {
                const box = item.getBoundingClientRect();
                return box.left >= card.left && box.right <= card.right;
              });
            }),
        ).toBe(true);
        if (width === 220 && textSize === 20) {
          expect(
            await child.evaluate((element) => {
              const heading = element.querySelector("[data-worker]");
              const title = heading.firstElementChild.getBoundingClientRect();
              return title.width >= heading.getBoundingClientRect().width / 2;
            }),
          ).toBe(true);
        }
        await workers.click({ trial: true });
      }
    }
  }
  await workers.click();
  await expect(child).toBeHidden();
  await workers.press("Enter");
  await expect(child).toBeVisible();
  await parent.click();
  await expect(parent).toHaveAttribute("aria-current", "page");
  await expect(child).not.toHaveAttribute("aria-current");
  await expect(workers).toHaveAttribute("aria-expanded", "true");
  await expect(parent).toContainText("task/sidebar");
  expect(
    await parent.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const label = element
        .querySelector(".navigation-item-label")
        .getBoundingClientRect();
      return label.top >= box.top && label.bottom <= box.bottom;
    }),
  ).toBe(true);
  await page.goto(
    "/tests/browser/solo-task-cards.html?status-roots=1&theme=light&width=260",
  );
  for (const label of ["Running", "Waiting", "Done", "Failed", "Archived"]) {
    const mark = page.getByRole("img", { name: label, exact: true });
    await expect(mark).toBeVisible();
    await expect(mark.locator("svg")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
