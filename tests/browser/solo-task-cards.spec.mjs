import { expect, test } from "./source-fixture.mjs";
import { watchPageErrors } from "./page-errors.mjs";

// DOM emulators cannot prove flex layout, content containment or pointer hit targets.
// Actual PrimarySidebar/SoloInventory owners run with the host's globals and two records.
test("task selection rows fit stacked labels and keep Workers on a separate hit target", async ({
  page,
}) => {
  const { errors } = watchPageErrors(page);
  await page.goto("/tests/browser/solo-task-cards.html");
  const parent = page.getByRole("button", { name: /^Planning/ });
  const child = page.getByRole("button", { name: /^Review/ });
  const workers = page.getByRole("button", { name: /1 Worker/ });
  await expect(child).toHaveAttribute("aria-current", "page");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.colorMode = theme;
    }, theme);
    for (const width of [640, 1440]) {
      await page.setViewportSize({ width, height: 950 });
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
  await expect(parent).toContainText("Branch: task/sidebar");
  expect(
    await parent.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const label = element
        .querySelector(".navigation-item-label")
        .getBoundingClientRect();
      return label.top >= box.top && label.bottom <= box.bottom;
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});
