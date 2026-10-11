const checkbox = document.querySelector("#minimize-to-tray");
const status = document.querySelector("#status");
const error = document.querySelector("#error");

function showError(message) {
  error.hidden = !message;
  error.textContent = message || "";
}

async function refresh() {
  const state = await browser.closeToTray.getState();
  checkbox.checked = state.enabled;
  checkbox.disabled = !state.supported;
  if (!state.supported) {
    status.textContent =
      "A system tray icon is available on Linux desktops with a StatusNotifier tray, such as KDE Plasma and Xfce.";
    return;
  }
  status.textContent = state.enabled
    ? "Closing the main window will leave Thunderbird in the tray."
    : "Closing the main window will quit Thunderbird.";
}

checkbox.addEventListener("change", async () => {
  showError("");
  checkbox.disabled = true;
  try {
    await browser.closeToTray.setEnabled(checkbox.checked);
    await refresh();
  } catch (loadError) {
    showError(String(loadError));
    checkbox.disabled = false;
  }
});

refresh().catch(loadError => {
  checkbox.disabled = true;
  showError("Could not read the add-on settings. " + loadError);
});
