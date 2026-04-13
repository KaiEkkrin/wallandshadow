---
description: Rules for writing resilient Playwright e2e tests
paths:
  - was-web/e2e/**
---

# Playwright E2E Test Rules

## Use Locators, never ElementHandle

Use `page.locator()` or `page.getByRole()` / `page.getByTestId()` — never `page.waitForSelector()` or `page.$()`.

ElementHandle is a direct reference to a DOM node. If React re-renders between the query and the action, the handle goes stale and the test fails with "Element is not attached to the DOM". Locators re-query the DOM on every action, so they survive re-renders.

```typescript
// Bad — stale after React re-render
const el = await page.waitForSelector('text="Save"');
await el.click();

// Good — re-evaluates on each action
await page.locator('text="Save"').click();
```

## Never use fixed timeouts to wait for state

`page.waitForTimeout()` and `setTimeout` sleeps are load-sensitive and either too slow or too fast. Instead, poll for the actual condition:

- **Element appears**: `await expect(locator).toBeVisible()`
- **Element disappears**: `await expect(locator).not.toBeVisible()`
- **Text changes**: `await expect(locator).toHaveText('...')`
- **Navigation**: `await page.waitForURL('**/pattern/**')`
- **Network**: `await page.waitForResponse(resp => ...)`

These auto-retry until the condition is met or timeout expires.

## Use web-first assertions, not manual checks

```typescript
// Bad — no retry, races async rendering
const visible = await page.locator('.toast').isVisible();
expect(visible).toBe(true);

// Good — retries automatically until visible or timeout
await expect(page.locator('.toast')).toBeVisible();
```

## Keep locators specific

Avoid `.first()` / `.nth()` on broad selectors — they silently pick the wrong element if DOM order changes. Filter to a unique match:

```typescript
// Fragile
page.locator('button').first();

// Better
page.locator('button.btn-danger').filter({ has: page.locator('svg[data-icon="xmark"]') });
```
