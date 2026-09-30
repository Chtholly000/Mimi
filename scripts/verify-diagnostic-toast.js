// Playwright CLI run-code harness. Serve the actual SupportDiagnostics component
// with mocked Tauri IPC and a clipboard stub; pass its local fixture URL below.
async (page) => {
  const copy = page.getByRole("button", { name: "复制诊断信息" });
  const section = page.getByRole("region", { name: "遇到问题？" });
  const before = await section.boundingBox();
  await copy.click();
  const toast = page.getByRole("status");
  await toast.waitFor();
  const after = await section.boundingBox();
  const placement = await toast.evaluate(el => getComputedStyle(el).position);
  if (before.height !== after.height || placement !== "fixed") throw new Error("inline layout regression");
  await page.waitForTimeout(1800);
  await copy.click();
  if (await toast.count() !== 1) throw new Error("stacked notifications");
  await page.waitForTimeout(1800);
  if (!(await toast.isVisible())) throw new Error("repeat did not reset expiry");
  await toast.waitFor({ state: "detached" });
  await copy.click();
  await toast.waitFor();
  await page.evaluate(() => { location.hash = "application-settings"; });
  await toast.waitFor({ state: "detached" });
  return { noInline: true, repeat: true, autoDismiss: true, navigationDismiss: true };
}
