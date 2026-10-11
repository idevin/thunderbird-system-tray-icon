/**
 * Close to Tray.
 *
 * WebExtensions cannot cancel a window close or create a StatusNotifier icon.
 * This experiment hides the main window and talks to helper/tray.py, which
 * owns the tray icon in a separate process.
 */

var { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);
var { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
);
var { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);

var PREF = "extensions.closeToTray.enabled";

// Thunderbird's own GTK delete-event handler runs first and returns TRUE, so a
// later handler never sees the close. Block that handler and install ours.
var GtkDelete = {
  callbacks: [],
  hooks: [],
  timers: [],

  ensure() {
    if (this.gdk) {
      return;
    }
    const { ctypes } = ChromeUtils.importESModule(
      "resource://gre/modules/ctypes.sys.mjs"
    );
    this.ctypes = ctypes;
    this.gpointer = ctypes.voidptr_t;
    this.gdk = ctypes.open("libgdk-3.so.0");
    this.gtk = ctypes.open("libgtk-3.so.0");
    this.gobject = ctypes.open("libgobject-2.0.so.0");
    this.DeleteCallback = ctypes.FunctionType(
      ctypes.default_abi,
      ctypes.int,
      [this.gpointer, this.gpointer, this.gpointer]
    );
    this.gdk_display_get_default = this.gdk.declare(
      "gdk_display_get_default",
      ctypes.default_abi,
      this.gpointer
    );
    this.gdk_x11_get_default_xdisplay = this.gdk.declare(
      "gdk_x11_get_default_xdisplay",
      ctypes.default_abi,
      this.gpointer
    );
    this.gdk_x11_window_lookup_for_display = this.gdk.declare(
      "gdk_x11_window_lookup_for_display",
      ctypes.default_abi,
      this.gpointer,
      this.gpointer,
      ctypes.unsigned_long
    );
    this.x11 = ctypes.open("libX11.so.6");
    this.XQueryTree = this.x11.declare(
      "XQueryTree",
      ctypes.default_abi,
      ctypes.int,
      this.gpointer,
      ctypes.unsigned_long,
      ctypes.unsigned_long.ptr,
      ctypes.unsigned_long.ptr,
      ctypes.unsigned_long.ptr.ptr,
      ctypes.unsigned_int.ptr
    );
    this.XFree = this.x11.declare(
      "XFree",
      ctypes.default_abi,
      ctypes.int,
      this.gpointer
    );
    this.gdk_x11_window_get_xid = this.gdk.declare(
      "gdk_x11_window_get_xid",
      ctypes.default_abi,
      ctypes.unsigned_long,
      this.gpointer
    );
    this.gdk_window_get_parent = this.gdk.declare(
      "gdk_window_get_parent",
      ctypes.default_abi,
      this.gpointer,
      this.gpointer
    );
    this.gdk_window_get_toplevel = this.gdk.declare(
      "gdk_window_get_toplevel",
      ctypes.default_abi,
      this.gpointer,
      this.gpointer
    );
    this.gdk_window_get_user_data = this.gdk.declare(
      "gdk_window_get_user_data",
      ctypes.default_abi,
      ctypes.void_t,
      this.gpointer,
      this.gpointer.ptr
    );
    this.gtk_widget_get_toplevel = this.gtk.declare(
      "gtk_widget_get_toplevel",
      ctypes.default_abi,
      this.gpointer,
      this.gpointer
    );
    this.gtk_widget_get_window = this.gtk.declare(
      "gtk_widget_get_window",
      ctypes.default_abi,
      this.gpointer,
      this.gpointer
    );
    this.gtk_window_list_toplevels = this.gtk.declare(
      "gtk_window_list_toplevels",
      ctypes.default_abi,
      this.gpointer
    );
    this.glib = ctypes.open("libglib-2.0.so.0");
    this.g_list_free = this.glib.declare(
      "g_list_free",
      ctypes.default_abi,
      ctypes.void_t,
      this.gpointer
    );
    this.GList = ctypes.StructType("GList", [
      { data: this.gpointer },
      { next: this.gpointer },
      { prev: this.gpointer },
    ]);
    this.gtk_widget_get_type = this.gtk.declare(
      "gtk_widget_get_type",
      ctypes.default_abi,
      ctypes.uintptr_t
    );
    this.g_signal_lookup = this.gobject.declare(
      "g_signal_lookup",
      ctypes.default_abi,
      ctypes.uint32_t,
      ctypes.char.ptr,
      ctypes.uintptr_t
    );
    this.g_signal_handlers_block_matched = this.gobject.declare(
      "g_signal_handlers_block_matched",
      ctypes.default_abi,
      ctypes.uint32_t,
      this.gpointer,
      ctypes.uint32_t,
      ctypes.uint32_t,
      ctypes.uint32_t,
      this.gpointer,
      this.gpointer,
      this.gpointer
    );
    this.g_signal_connect_data = this.gobject.declare(
      "g_signal_connect_data",
      ctypes.default_abi,
      ctypes.unsigned_long,
      this.gpointer,
      ctypes.char.ptr,
      this.DeleteCallback.ptr,
      this.gpointer,
      this.gpointer,
      ctypes.uint32_t
    );
    this.g_signal_handler_disconnect = this.gobject.declare(
      "g_signal_handler_disconnect",
      ctypes.default_abi,
      ctypes.void_t,
      this.gpointer,
      ctypes.unsigned_long
    );
    this.deleteSignal = this.g_signal_lookup("delete-event", this.gtk_widget_get_type());
  },

  pointer(handle) {
    let text = String(handle).trim();
    if (text.startsWith("0x0x") || text.startsWith("0x0X")) {
      text = text.slice(2);
    }
    return this.gpointer(this.ctypes.UInt64(text));
  },

  hook(win, handle) {
    this.ensure();
    const pending = this.ctypes.int(0);
    const callback = this.DeleteCallback.ptr(function () {
      if (!Tray.enabled || Tray.explicitQuit) {
        return 0;
      }
      pending.value = 1;
      return 1;
    });
    this.callbacks.push(pending);
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(
      {
        notify() {
          if (!pending.value) {
            return;
          }
          pending.value = 0;
          Tray.beginHide(win);
        },
      },
      100,
      Ci.nsITimer.TYPE_REPEATING_SLACK
    );
    this.timers.push(timer);
    this.callbacks.push(callback);
    const gdkWindow = this.pointer(handle);
    const ownXid = Number(this.gdk_x11_window_get_xid(gdkWindow));
    Tray.log("gdk xid=" + ownXid);
    this.watchFrame(ownXid, win);
    this.ensurePoller();
    const widget = this.gpointer();
    this.gdk_window_get_user_data(gdkWindow, widget.address());
    if (widget.isNull()) {
      throw new Error("GTK widget was not found for " + handle);
    }
    const toplevel = this.gtk_widget_get_toplevel(widget);
    const blocked = this.g_signal_handlers_block_matched(
      toplevel,
      1,
      this.deleteSignal,
      0,
      null,
      null,
      null
    );
    const id = this.g_signal_connect_data(toplevel, "delete-event", callback, null, null, 0);
    if (!id) {
      throw new Error("Could not connect delete-event");
    }
    this.hooks.push({ toplevel, id });
    Tray.log("delete-event hooked id=" + id + " blocked=" + blocked + " signal=" + this.deleteSignal);
  },

  loadHookLib() {
    if (this.tray_watch) {
      return;
    }
    const path = Tray.materializeNative("libtrayhook.so");
    const ctypes = this.ctypes;
    this.hooklib = ctypes.open(path);
    this.tray_watch = this.hooklib.declare(
      "tray_watch",
      ctypes.default_abi,
      ctypes.int,
      this.gpointer,
      ctypes.unsigned_long
    );
    this.tray_take_pending = this.hooklib.declare(
      "tray_take_pending",
      ctypes.default_abi,
      ctypes.unsigned_long
    );
    this.tray_set_armed = this.hooklib.declare(
      "tray_set_armed",
      ctypes.default_abi,
      ctypes.void_t,
      ctypes.int
    );
    this.tray_last_error = this.hooklib.declare(
      "tray_last_error",
      ctypes.default_abi,
      ctypes.char.ptr
    );
  },

  setArmed(value) {
    try {
      if (this.tray_set_armed) {
        this.tray_set_armed(value ? 1 : 0);
      }
    } catch (error) {
      Tray.log("could not arm the close hook: " + error);
    }
  },

  readClientWindow(ownXid) {
    const program = Tray.materializeNative("xparent");
    const output = Services.dirsvc.get("TmpD", Ci.nsIFile).clone();
    output.append("close-to-tray-parent.txt");
    if (output.exists()) {
      output.remove(false);
    }
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(program);
    file.permissions = 0o755;
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    proc.init(file);
    proc.run(true, [String(ownXid), output.path], 2);
    if (proc.exitValue !== 0) {
      throw new Error("xparent exited with " + proc.exitValue);
    }
    const input = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
      Ci.nsIFileInputStream
    );
    input.init(output, 0x01, 0, 0);
    const reader = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
      Ci.nsIScriptableInputStream
    );
    reader.init(input);
    const text = reader.read(reader.available());
    reader.close();
    input.close();
    const [frameText, reparentedText] = text.trim().split(/\s+/);
    const frame = parseInt(frameText, 10);
    if (!frame) {
      throw new Error("Could not find the window that receives close");
    }
    return { frame, reparented: reparentedText === "1" };
  },

  watchFrame(ownXid, win) {
    this.loadHookLib();
    this.setArmed(Tray.enabled && !Tray.explicitQuit);
    let attempts = 0;
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(
      {
        notify: () => {
          attempts++;
          let result;
          try {
            result = GtkDelete.readClientWindow(ownXid);
          } catch (error) {
            Tray.log("client window lookup failed: " + error);
            return;
          }
          Tray.log(
            "client window=" + result.frame + " reparented=" + result.reparented + " attempt=" + attempts
          );
          if (!result.reparented && attempts < 25) {
            return;
          }
          GtkDelete.finishWatch(result.frame, ownXid, win);
          timer.cancel();
        },
      },
      200,
      Ci.nsITimer.TYPE_REPEATING_SLACK
    );
    this.timers.push(timer);
  },

  finishWatch(frame, ownXid, win) {
    if (Tray.frameWindows.has(frame)) {
      return;
    }
    Tray.frameWindows.set(frame, win);
    if (ownXid && ownXid !== frame) {
      Tray.frameWindows.set(ownXid, win);
    }
    const display = this.gdk_display_get_default();
    const watched = this.tray_watch(display, frame);
    if (ownXid && ownXid !== frame) {
      this.tray_watch(display, ownXid);
    }
    let errorText = "";
    try {
      errorText = this.tray_last_error().readString();
    } catch (error) {
      errorText = String(error);
    }
    Tray.log("client window=" + frame + " watch=" + watched + (errorText ? " error=" + errorText : ""));
    this.hookXid(frame, this.callbacks[this.callbacks.length - 1]);
  },

  ensurePoller() {
    if (this.poller) {
      return;
    }
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(
      {
        notify() {
          if (!GtkDelete.tray_take_pending) {
            return;
          }
          const hit = Number(GtkDelete.tray_take_pending());
          if (!hit) {
            return;
          }
          Tray.log("frame close xid=" + hit);
          const target = Tray.frameWindows.get(hit);
          if (target) {
            Tray.beginHide(target);
          }
        },
      },
      100,
      Ci.nsITimer.TYPE_REPEATING_SLACK
    );
    this.timers.push(timer);
    this.poller = true;
  },

  hookParentWindow(gdkWindow, callback) {
    const display = this.gdk_x11_get_default_xdisplay();
    const xid = Number(this.gdk_x11_window_get_xid(gdkWindow));
    let current = xid;
    const seen = new Set();
    for (let level = 0; level < 8; level++) {
      const root = this.ctypes.unsigned_long();
      const parent = this.ctypes.unsigned_long();
      const children = this.ctypes.unsigned_long.ptr();
      const count = this.ctypes.unsigned_int();
      this.XQueryTree(
        display,
        this.ctypes.unsigned_long(current),
        root.address(),
        parent.address(),
        children.address(),
        count.address()
      );
      if (children && !children.isNull()) {
        this.XFree(children);
      }
      const parentId = Number(parent.value);
      const rootId = Number(root.value);
      Tray.log("x parent level=" + level + " window=" + current + " parent=" + parentId);
      if (!parentId || parentId === rootId || seen.has(parentId)) {
        break;
      }
      seen.add(parentId);
      this.hookXid(parentId, callback);
      current = parentId;
    }
  },

  hookXid(xid, callback) {
    const gdkWindow = this.gdk_x11_window_lookup_for_display(
      this.gdk_display_get_default(),
      xid
    );
    if (!gdkWindow || gdkWindow.isNull()) {
      Tray.log("xid " + xid + " is not a GdkWindow");
      return;
    }
    const widget = this.gpointer();
    this.gdk_window_get_user_data(gdkWindow, widget.address());
    if (widget.isNull()) {
      Tray.log("xid " + xid + " has no GTK widget");
      return;
    }
    const blocked = this.g_signal_handlers_block_matched(
      widget,
      1,
      this.deleteSignal,
      0,
      null,
      null,
      null
    );
    const id = this.g_signal_connect_data(widget, "delete-event", callback, null, null, 0);
    this.hooks.push({ toplevel: widget, id });
    Tray.log("hooked xid " + xid + " id=" + id + " blocked=" + blocked);
  },

  hookEveryToplevel(callback) {
    const list = this.gtk_window_list_toplevels();
    let node = list;
    let count = 0;
    while (node && !node.isNull() && count < 30) {
      const entry = this.ctypes.cast(node, this.GList.ptr).contents;
      const widget = entry.data;
      let xid = "none";
      try {
        const gdkWindow = this.gtk_widget_get_window(widget);
        if (gdkWindow && !gdkWindow.isNull()) {
          xid = String(this.gdk_x11_window_get_xid(gdkWindow));
        }
      } catch (error) {
        xid = "err";
      }
      const blocked = this.g_signal_handlers_block_matched(
        widget,
        1,
        this.deleteSignal,
        0,
        null,
        null,
        null
      );
      const id = this.g_signal_connect_data(widget, "delete-event", callback, null, null, 0);
      this.hooks.push({ toplevel: widget, id });
      Tray.log("toplevel xid=" + xid + " hook=" + id + " blocked=" + blocked);
      node = entry.next;
      count++;
    }
    if (list && !list.isNull()) {
      this.g_list_free(list);
    }
  },

  disconnectAll() {
    for (const timer of this.timers) {
      try {
        timer.cancel();
      } catch (error) {
        Tray.log(error);
      }
    }
    this.timers = [];
    for (const hook of this.hooks) {
      try {
        this.g_signal_handler_disconnect(hook.toplevel, hook.id);
      } catch (error) {
        Tray.log("could not remove delete-event hook: " + error);
      }
    }
    this.hooks = [];
  },
};

var Tray = {
  extension: null,
  enabled: true,
  supported: AppConstants.platform === "linux",
  hidden: new Set(),
  explicitQuit: false,
  frameWindows: new Map(),
  stopping: false,
  proc: null,
  ready: false,
  helperPromise: null,
  readyWait: null,
  stdoutBuffer: "",
  wmListener: null,
  handledEvents: new WeakSet(),

  log(message) {
    dump("[Close to Tray] " + message + "\n");
  },

  startup(extension) {
    this.extension = extension;
    this.supported = AppConstants.platform === "linux";
    try {
      Services.prefs.getDefaultBranch("").setBoolPref(PREF, true);
    } catch (error) {
      this.log("Could not set the default preference: " + error);
    }
    this.enabled = this.readEnabled();
    this.wmListener = {
      onOpenWindow: appWindow => {
        const attach = () => {
          let domWindow;
          try {
            domWindow = appWindow.docShell.domWindow;
          } catch (error) {
            this.log("window not ready: " + error);
            return false;
          }
          this.attach(domWindow);
          if (domWindow.document?.readyState !== "complete") {
            domWindow.addEventListener("load", () => this.attach(domWindow), { once: true });
          }
          return true;
        };
        if (!attach()) {
          Services.tm.dispatchToMainThread(attach);
        }
      },
      onCloseWindow() {},
    };
    Services.wm.addListener(this.wmListener);
    Services.obs.addObserver(this, "quit-application-requested");
    this.forEachWindow(win => this.attach(win));
    // The main window can open before its docShell is ready, or just after
    // this startup notification. Check again once the event loop turns.
    const rescan = () => this.forEachWindow(win => this.attach(win));
    try {
      Services.tm.dispatchToMainThread(rescan);
    } catch (error) {
      this.log("rescan failed: " + error);
    }
    this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this.timer.initWithCallback({ notify: rescan }, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
    if (this.enabled && this.supported) {
      this.ensureHelper().catch(error => this.log("tray failed: " + error));
    }
    this.log("started, enabled=" + this.enabled + ", supported=" + this.supported);
  },

  shutdown(isAppShutdown) {
    this.stopping = true;
    this.explicitQuit = true;
    GtkDelete.setArmed(false);
    GtkDelete.disconnectAll();
    try {
      this.timer?.cancel();
    } catch (error) {
      this.log(error);
    }
    this.stopHelper();
    if (isAppShutdown) {
      return;
    }
    for (const win of [...this.hidden]) {
      this.show(win, false);
    }
    this.hidden.clear();
    this.forEachWindow(win => this.detach(win));
    try {
      Services.wm.removeListener(this.wmListener);
    } catch (error) {
      this.log(error);
    }
    try {
      Services.obs.removeObserver(this, "quit-application-requested");
    } catch (error) {
      this.log(error);
    }
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  },

  readEnabled() {
    try {
      return Services.prefs.getBoolPref(PREF);
    } catch (error) {
      return true;
    }
  },

  getState() {
    return {
      enabled: this.enabled,
      supported: this.supported,
      hiddenCount: this.hidden.size,
    };
  },

  setEnabled(enabled) {
    this.enabled = !!enabled;
    Services.prefs.setBoolPref(PREF, this.enabled);
    GtkDelete.setArmed(this.enabled && !this.explicitQuit);
    this.log("enabled=" + this.enabled);
    if (!this.enabled) {
      for (const win of [...this.hidden]) {
        this.show(win, true);
      }
      this.stopHelper();
    } else if (this.supported) {
      this.ensureHelper().catch(error => this.log("tray failed: " + error));
    }
  },

  observe(subject, topic, data) {
    if (topic !== "quit-application-requested") {
      return;
    }
    this.log("quit requested data=" + JSON.stringify(data) + " hidden=" + this.hidden.size);
    if (this.explicitQuit || !this.enabled || !this.supported) {
      this.explicitQuit = true;
      GtkDelete.setArmed(false);
      return;
    }
    if (data === "lastwindow" && (this.proc || this.hidden.size > 0)) {
      try {
        subject.QueryInterface(Ci.nsISupportsPRBool).data = true;
        this.log("cancelled quit because Thunderbird is in the tray");
      } catch (error) {
        this.log("could not cancel quit: " + error);
      }
      return;
    }
    this.explicitQuit = true;
    GtkDelete.setArmed(false);
  },

  forEachWindow(callback) {
    const enumerator = Services.wm.getEnumerator(null);
    while (enumerator.hasMoreElements()) {
      callback(enumerator.getNext());
    }
  },

  attach(win) {
    if (!win || win.closed || win.__closeToTrayHandler) {
      return;
    }
    if (this.windowType(win) !== "mail:3pane") {
      return;
    }
    const handler = event => this.onClose(win, event);
    win.__closeToTrayHandler = handler;
    win.addEventListener("close", handler, true);
    this.installGtkHook(win);
    this.wrapRequestClose(win);
    let href = "";
    try {
      href = win.location.href;
    } catch (error) {
      href = String(error);
    }
    this.log("attached " + this.windowType(win) + " " + href);
  },

  detach(win) {
    if (!win || !win.__closeToTrayHandler) {
      return;
    }
    try {
      win.removeEventListener("close", win.__closeToTrayHandler, true);
    } catch (error) {
      this.log(error);
    }
    delete win.__closeToTrayHandler;
  },

  shouldIntercept(win) {
    return this.supported && this.enabled && !this.explicitQuit && this.windowType(win) === "mail:3pane";
  },

  wrapRequestClose(win) {
    if (win.__closeToTrayRequestWrapped || typeof win.requestWindowClose !== "function") {
      return;
    }
    const original = win.requestWindowClose.bind(win);
    const replacement = () => {
      if (!Tray.shouldIntercept(win)) {
        original();
        return;
      }
      Tray.log("requestWindowClose intercepted");
      Tray.beginHide(win);
    };
    try {
      Cu.exportFunction(replacement, win, { defineAs: "requestWindowClose" });
    } catch (error) {
      win.requestWindowClose = replacement;
    }
    win.__closeToTrayRequestWrapped = true;
  },

  installGtkHook(win) {
    if (!this.supported || win.__closeToTrayGtk || this.windowType(win) !== "mail:3pane") {
      return;
    }
    try {
      const handle = String(this.baseWindow(win).nativeHandle || "");
      this.log("nativeHandle=" + handle);
      GtkDelete.hook(win, handle);
      win.__closeToTrayGtk = true;
    } catch (error) {
      this.log("gtk hook failed: " + error);
    }
  },

  beginHide(win) {
    if (!this.shouldIntercept(win) || this.hidden.has(win)) {
      return;
    }
    try {
      this.hide(win);
    } catch (error) {
      this.log("hide failed: " + error);
      this.alert("Close to Tray could not hide the window.\n\n" + error);
      return;
    }
    this.ensureHelper().catch(error => {
      this.log("tray failed: " + error);
      this.show(win, true);
      this.alert(
        "Close to Tray could not place an icon in the system tray. The window was left open.\n\n" +
          (error && error.message ? error.message : error)
      );
    });
  },

  windowType(win) {
    try {
      return win.document.documentElement.getAttribute("windowtype") || "";
    } catch (error) {
      return "";
    }
  },

  onClose(win, event) {
    if (this.handledEvents.has(event)) {
      return;
    }
    this.handledEvents.add(event);
    if (!this.supported || !this.enabled || this.explicitQuit) {
      return;
    }
    if (this.windowType(win) !== "mail:3pane") {
      this.log("ignored close for " + this.windowType(win));
      return;
    }
    this.log(
      "close event cancelable=" +
        event.cancelable +
        " defaultPrevented=" +
        event.defaultPrevented
    );
    event.preventDefault();
    win.setTimeout(() => this.beginHide(win), 0);
  },

  baseWindow(win) {
    return win.docShell.treeOwner
      .QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIAppWindow)
      .QueryInterface(Ci.nsIBaseWindow);
  },

  hide(win) {
    this.baseWindow(win).visibility = false;
    this.hidden.add(win);
    this.log("hid a window (" + this.hidden.size + " hidden)");
  },

  show(win, focus) {
    this.hidden.delete(win);
    if (!win || win.closed) {
      return;
    }
    try {
      this.baseWindow(win).visibility = true;
      if (win.windowState === win.STATE_MINIMIZED) {
        win.restore();
      }
      if (focus) {
        win.focus();
      }
    } catch (error) {
      this.log("show failed: " + error);
    }
  },

  restore() {
    const windows = [...this.hidden];
    if (!windows.length) {
      this.openMainWindow();
    } else {
      for (const win of windows) {
        this.show(win, true);
      }
    }
  },

  openMainWindow() {
    Services.ww.openWindow(
      null,
      "chrome://messenger/content/messenger.xhtml",
      "_blank",
      "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar",
      null
    );
  },

  quitFromTray() {
    this.explicitQuit = true;
    this.stopping = true;
    GtkDelete.setArmed(false);
    for (const win of [...this.hidden]) {
      this.show(win, false);
    }
    this.stopHelper();
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  },

  alert(message) {
    try {
      Services.prompt.alert(null, "Close to Tray", message);
    } catch (error) {
      this.log(message);
    }
  },

  extensionURI(relativePath) {
    return Services.io.newURI(relativePath, null, this.extension.rootURI);
  },

  decodeBase64(input) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = String(input).replace(/=+$/, "");
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const value = alphabet.indexOf(clean[i]);
      if (value < 0) {
        continue;
      }
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return bytes;
  },

  nativePayload() {
    if (this._nativePayload) {
      return this._nativePayload;
    }
    const uri = this.extensionURI("helper/native.json");
    const channel = NetUtil.newChannel({
      uri,
      loadUsingSystemPrincipal: true,
    });
    const input = channel.open();
    const reader = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
      Ci.nsIScriptableInputStream
    );
    reader.init(input);
    let text = "";
    let available = 0;
    while ((available = input.available()) > 0) {
      text += reader.read(available);
    }
    reader.close();
    input.close();
    this._nativePayload = JSON.parse(text);
    return this._nativePayload;
  },

  materializeNative(name) {
    const payload = this.nativePayload();
    const encoded = payload.files && payload.files[name];
    if (!encoded) {
      throw new Error("Missing native component " + name);
    }
    const dir = Services.dirsvc.get("ProfD", Ci.nsIFile).clone();
    dir.append("close-to-tray");
    if (!dir.exists()) {
      dir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    }
    const file = dir.clone();
    file.append(name);
    const stamp = dir.clone();
    stamp.append(name + ".id");
    if (file.exists() && stamp.exists()) {
      const input = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
        Ci.nsIFileInputStream
      );
      input.init(stamp, 0x01, 0, 0);
      const reader = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
        Ci.nsIScriptableInputStream
      );
      reader.init(input);
      const current = reader.read(reader.available());
      reader.close();
      input.close();
      if (current === payload.id && file.fileSize > 0) {
        file.permissions = 0o755;
        return file.path;
      }
    }
    const bytes = this.decodeBase64(encoded);
    const output = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
      Ci.nsIFileOutputStream
    );
    output.init(file, 0x02 | 0x08 | 0x20, 0o755, 0);
    const writer = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(
      Ci.nsIBinaryOutputStream
    );
    writer.setOutputStream(output);
    writer.writeByteArray(bytes, bytes.length);
    writer.close();
    output.close();
    file.permissions = 0o755;
    const stampOut = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
      Ci.nsIFileOutputStream
    );
    stampOut.init(stamp, 0x02 | 0x08 | 0x20, 0o644, 0);
    stampOut.write(payload.id, payload.id.length);
    stampOut.close();
    return file.path;
  },

  materialize(relativePath) {
    const uri = this.extensionURI(relativePath);
    if (uri.schemeIs("file")) {
      return uri.QueryInterface(Ci.nsIFileURL).file.path;
    }
    const channel = NetUtil.newChannel({
      uri,
      loadUsingSystemPrincipal: true,
    });
    const input = channel.open();
    const binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
      Ci.nsIBinaryInputStream
    );
    binary.setInputStream(input);
    const bytes = binary.readByteArray(input.available());
    binary.close();
    input.close();

    const dir = Services.dirsvc.get("ProfD", Ci.nsIFile).clone();
    dir.append("close-to-tray");
    if (!dir.exists()) {
      dir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    }
    const file = dir.clone();
    file.append(relativePath.split("/").pop());
    const output = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
      Ci.nsIFileOutputStream
    );
    output.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
    const writer = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(
      Ci.nsIBinaryOutputStream
    );
    writer.setOutputStream(output);
    writer.writeByteArray(bytes);
    writer.close();
    output.close();
    if (file.leafName.endsWith(".py")) {
      file.permissions = 0o755;
    }
    return file.path;
  },

  ensureHelper() {
    if (!this.supported) {
      return Promise.reject(new Error("The system tray is only supported on Linux."));
    }
    if (this.proc && this.ready) {
      return Promise.resolve();
    }
    if (!this.helperPromise) {
      this.helperPromise = this.startHelper().catch(error => {
        this.helperPromise = null;
        throw error;
      });
    }
    return this.helperPromise;
  },

  async startHelper() {
    const script = this.materialize("helper/tray.py");
    const icon = this.materialize("icons/tray.png");
    const python = await Subprocess.pathSearch("python3");
    this.stopping = false;
    this.ready = false;
    this.stdoutBuffer = "";
    const proc = await Subprocess.call({
      command: python,
      arguments: [script, icon],
      stderr: "pipe",
    });
    this.proc = proc;
    this.readStderr(proc.stderr);
    const ready = new Promise((resolve, reject) => {
      const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(
        {
          notify: () => {
            this.readyWait = null;
            reject(new Error("The tray icon did not appear within 8 seconds."));
          },
        },
        8000,
        Ci.nsITimer.TYPE_ONE_SHOT
      );
      this.readyWait = { resolve, reject, timer };
    });
    this.readStdout(proc.stdout);
    await ready;
    this.ready = true;
    this.log("tray icon is ready");
  },

  async readStdout(stdout) {
    try {
      while (true) {
        const chunk = await stdout.readString();
        if (!chunk) {
          break;
        }
        this.stdoutBuffer += chunk;
        let newline = this.stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = this.stdoutBuffer.slice(0, newline).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
          if (line) {
            this.onHelperLine(line);
          }
          newline = this.stdoutBuffer.indexOf("\n");
        }
      }
    } catch (error) {
      this.log("stdout closed: " + error);
    }
    this.onHelperExit();
  },

  async readStderr(stderr) {
    try {
      while (true) {
        const chunk = await stderr.readString();
        if (!chunk) {
          break;
        }
        this.log("tray: " + chunk.trim());
      }
    } catch (error) {
      this.log("stderr closed: " + error);
    }
  },

  onHelperLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.log("ignored tray output: " + line);
      return;
    }
    if (message.event === "ready" && this.readyWait) {
      this.readyWait.timer.cancel();
      const wait = this.readyWait;
      this.readyWait = null;
      wait.resolve();
    } else if (message.event === "error") {
      const error = new Error(message.message || "Tray icon failed.");
      if (this.readyWait) {
        this.readyWait.timer.cancel();
        const wait = this.readyWait;
        this.readyWait = null;
        wait.reject(error);
      } else {
        this.log(error.message);
      }
    } else if (message.event === "show") {
      this.restore();
    } else if (message.event === "quit") {
      this.quitFromTray();
    }
  },

  onHelperExit() {
    const failed = this.readyWait;
    this.proc = null;
    this.ready = false;
    this.helperPromise = null;
    if (failed) {
      try {
        failed.timer.cancel();
      } catch (error) {
        this.log(error);
      }
      this.readyWait = null;
      failed.reject(new Error("The tray icon process exited before it was ready."));
    }
    if (this.stopping || this.explicitQuit || !this.enabled) {
      return;
    }
    this.log("tray icon exited; starting it again");
    this.ensureHelper().catch(error => {
      this.log(error);
      if (this.hidden.size === 0) {
        return;
      }
      this.alert(
        "The tray icon closed unexpectedly. Thunderbird's window was restored.\n\n" +
          error
      );
      this.restore();
    });
  },

  stopHelper() {
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    this.helperPromise = null;
    this.stopping = true;
    if (this.readyWait) {
      this.readyWait.timer.cancel();
      this.readyWait = null;
    }
    if (!proc) {
      return;
    }
    proc.kill().catch(error => this.log("kill tray: " + error));
  },
};

var closeToTray = class extends ExtensionCommon.ExtensionAPI {
  onStartup() {
    Tray.startup(this.extension);
  }

  onShutdown(isAppShutdown) {
    Tray.shutdown(isAppShutdown);
  }

  getAPI(context) {
    if (!Tray.extension) {
      Tray.extension = context.extension;
    }
    return {
      closeToTray: {
        async getState() {
          return Tray.getState();
        },
        async setEnabled(enabled) {
          Tray.setEnabled(enabled);
        },
      },
    };
  }
};
