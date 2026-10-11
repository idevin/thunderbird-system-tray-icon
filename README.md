# Close to Tray

When you close Thunderbird's main window, Thunderbird stays running and a system tray icon remains visible. Click the icon to hide the open window or show that same window again. Quit from the tray menu, or with **File → Quit**.

This add-on runs on Linux with Thunderbird 128 through 157. The tray icon needs Python 3 with PyGObject (`gi`) and a StatusNotifier tray, such as KDE Plasma or Xfce.

## Install from a file

1. Download [`releases/close-to-tray-1.0.3.xpi`](releases/close-to-tray-1.0.3.xpi).
2. In Thunderbird, open the menu and choose **Add-ons and Themes**.
3. Click the gear icon and choose **Install Add-on From File…**.
4. Select the downloaded `.xpi` file.
5. When Thunderbird asks for access, choose **Add**.

The permission covers the whole application because the add-on has to intercept closing the main window.

## Install from add-on search

1. In Thunderbird, open the menu and choose **Add-ons and Themes**.
2. In the search field, type `Close to Tray` and press Enter.
3. Open the result for this add-on, by Ilya Devin, and choose **Add to Thunderbird**.
4. When Thunderbird asks for access, choose **Add**.

The catalog also lists **Close to Tray (for Windows)**. That is a separate add-on. This package is the Linux tray icon.
