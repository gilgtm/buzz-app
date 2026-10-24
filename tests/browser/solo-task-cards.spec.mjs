import { expect, test } from "./source-fixture.mjs";
import { watchPageErrors } from "./page-errors.mjs";

// DOM emulators cannot prove flex layout, content containment or pointer hit targets.
// Actual PrimarySidebar/SoloInventory owners run with the host's globals, four workers and real assigned-profile avatars.
test("contained task cards preserve row ownership, previews and separate disclosure hit targets", async ({
  page,
}) => {
  const { errors } = watchPageErrors(page);
  await page.goto("/tests/browser/solo-task-cards.html");
  const parent = page.getByRole("button", { name: /^Planning/ });
  const child = page.getByRole("button", { name: /^Review/ });
  const workers = page.getByRole("button", { name: /4 workers:/ });
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
        await expect(workers.locator(":scope > span")).toContainText(
          `1 ${status}`,
        );
      }
      for (const textSize of [16, 20]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, textSize);
        expect(
          await parent.evaluate((element) => {
            const card = element.closest("[data-navigation-card]");
            const selected = card.querySelector('[aria-current="page"]');
            return (
              selected &&
              selected !== element &&
              getComputedStyle(card).backgroundColor !==
                getComputedStyle(selected.closest("[data-navigation-card]"))
                  .backgroundColor
            );
          }),
        ).toBe(true);
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
          const ownAction = await row.evaluate((element) =>
            element
              .closest("[data-solo-menu-id]")
              .querySelector("[data-solo-row-action]")
              .getAttribute("aria-label"),
          );
          await expect(
            page.getByRole("button", { name: ownAction, exact: true }),
          ).toHaveCSS("opacity", "1");
          expect(
            await page
              .locator("[data-solo-row-action]")
              .evaluateAll((actions) =>
                actions
                  .filter(
                    (action) =>
                      getComputedStyle(action).opacity === "1" &&
                      action.getClientRects().length,
                  )
                  .map((action) => action.getAttribute("aria-label")),
              ),
          ).toEqual([ownAction]);
          await row.click({ trial: true });
        }
        expect(
          await page
            .locator("[data-workers-control] > span")
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
  await child.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Actions for Review workspace moves" }),
  ).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(child).toBeFocused();
  await page.mouse.move(0, 0);
  await workers.press("Shift+F10");
  const parentMenu = page.getByRole("menu", { name: /Actions for Planning/ });
  await expect(parentMenu).toBeVisible();
  // Closing tests start after the keyboard-open focus handoff has completed.
  await expect
    .poll(() =>
      parentMenu.evaluate((menu) => menu.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(parent).toBeFocused();
  await workers.click();
  await expect(child).toBeHidden();
  await workers.press("Enter");
  await expect(child).toBeVisible();
  const parentContent = await parent.textContent();
  const parentHeight = (await parent.boundingBox()).height;
  await parent.click();
  await expect(parent).toHaveAttribute("aria-current", "page");
  await expect(parent).toHaveText(parentContent);
  expect((await parent.boundingBox()).height).toBe(parentHeight);
  await expect(parent).not.toContainText("Contains current task");
  // Compact workers keep one visible line even at enlarged text.
  await expect(child.locator("[data-solo-message-preview]")).toHaveCount(0);
  await expect(
    child.getByRole("img", { name: "Waiting", exact: true }),
  ).toBeVisible();
  await expect(child).not.toContainText("Waiting");
  expect(
    await child.evaluate((row) => {
      const heading = row.querySelector("[data-worker]");
      const title = heading.firstElementChild.getBoundingClientRect();
      const status = heading.lastElementChild.getBoundingClientRect();
      return status.top < title.bottom && status.bottom > title.top;
    }),
  ).toBe(true);
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
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(parent.locator("[data-solo-message-preview]")).toBeVisible();
  expect(
    await parent
      .locator("[data-solo-message-preview]")
      .evaluate((preview) => getComputedStyle(preview).whiteSpace),
  ).toBe("nowrap");
  await expect(workers).toBeHidden();
  await page.goto("/tests/browser/solo-task-cards.html?width=260&theme=light");
  await expect(child).toHaveAttribute("aria-current", "page");
  // Nested workers are outside their root's draggable primary surface.
  const childBox = await child.boundingBox();
  await page.mouse.move(childBox.x + 25, childBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(childBox.x + 40, childBox.y + 25, { steps: 4 });
  await expect(page.locator("[data-channel-dragging]")).toHaveCount(0);
  await page.mouse.up();
  const rootBox = await parent.boundingBox();
  await page.mouse.move(
    rootBox.x + rootBox.width / 2,
    rootBox.y + rootBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    rootBox.x + rootBox.width / 2 + 30,
    rootBox.y + rootBox.height / 2 + 15,
    { steps: 4 },
  );
  await expect(page.locator("[data-channel-dragging]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("[data-channel-dragging]")).toHaveCount(0);
  await page.goto(
    "/tests/browser/solo-task-cards.html?status-roots=1&theme=light&width=260",
  );
  for (const label of ["Running", "Waiting", "Done", "Failed", "Archived"]) {
    const mark = page.getByRole("img", { name: label, exact: true });
    await expect(mark).toBeVisible();
    await expect(mark.locator("svg")).toBeVisible();
  }
  await page.goto(
    "/tests/browser/solo-task-cards.html?nested=1&theme=light&width=260",
  );
  const nestedRows = page
    .locator("[data-solo-channel-id]")
    .filter({ has: page.locator("[data-worker]") });
  await expect(nestedRows).toHaveCount(4);
  const bounds = await nestedRows.evaluateAll((rows) =>
    rows.map((row) => {
      const { x, width } = row.getBoundingClientRect();
      return { x, width };
    }),
  );
  expect(bounds).toEqual(Array(4).fill(bounds[0]));
  await parent.click();
  await expect(parent).toHaveAttribute("aria-current", "page");
  await expect(nestedRows.last()).toBeVisible();
  const nestedClose = page.getByRole("button", {
    name: /Hide 1 worker: 1 done/i,
  });
  await expect(nestedClose).toBeVisible();
  await nestedClose.focus();
  await nestedClose.press("Enter");
  await expect(nestedClose).toHaveCount(0);
  await expect(child).toBeFocused();
  await expect(nestedRows.last()).toBeHidden();
  expect(errors).toEqual([]);
});
