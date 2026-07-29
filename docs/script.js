const copyButton = document.querySelector(".copy-button");
const copyStatus = document.querySelector(".copy-status");
let statusTimer;

copyButton?.addEventListener("click", async () => {
  const value = copyButton.dataset.copy;
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    copyButton.textContent = "Copied";
    copyStatus.textContent = "Command copied";
  } catch {
    copyStatus.textContent = "Copy failed. Select the command and copy it.";
  }

  copyStatus.classList.add("is-visible");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    copyStatus.classList.remove("is-visible");
    copyButton.textContent = "Copy";
  }, 2200);
});
