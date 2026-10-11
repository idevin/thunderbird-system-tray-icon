/* Consumes WM_DELETE_WINDOW in-process.
 * A JavaScript GDK filter crashes Thunderbird, so this file keeps the
 * callback in C and the add-on polls tray_take_pending(). */

#define _GNU_SOURCE

#include <X11/Xlib.h>
#include <dlfcn.h>
#include <stdint.h>

#define FILTER_CONTINUE 0
#define FILTER_REMOVE 2

typedef void GdkDisplay;
typedef void GdkWindow;
typedef void GdkXEvent;
typedef void GdkEvent;
typedef Display *(*GetXDisplayFn)(GdkDisplay *display);
typedef GdkWindow *(*ForeignWindowFn)(GdkDisplay *display, Window window);
typedef void (*AddFilterFn)(GdkWindow *window, void *filter, void *data);

static volatile int armed = 1;
static volatile unsigned long pending_xid = 0;
static Atom wm_protocols = 0;
static Atom wm_delete = 0;
static int filter_installed = 0;
static unsigned long watched[8];
static int watched_count = 0;
static const char *last_error = "";

static int gdk_handler_installed = 0;
static void (*real_do_event)(void *event) = NULL;
static unsigned long (*gdk_get_xid)(void *window) = NULL;

static int is_watched(unsigned long window) {
  for (int i = 0; i < watched_count; i++) {
    if (watched[i] == window) {
      return 1;
    }
  }
  return 0;
}

static void on_gdk_event(void *event, void *data) {
  (void)data;
  if (event && armed && gdk_get_xid) {
    struct {
      int type;
      int pad;
      void *window;
    } *head = event;
    if (head->type == 0 && head->window) {
      unsigned long xid = gdk_get_xid(head->window);
      if (is_watched(xid)) {
        pending_xid = xid;
        return;
      }
    }
  }
  if (real_do_event) {
    real_do_event(event);
  }
}

static int on_xevent(GdkXEvent *xevent, GdkEvent *event, void *data) {
  XEvent *native = (XEvent *)xevent;
  (void)event;
  (void)data;
  if (!armed || !native || native->type != ClientMessage || !wm_delete) {
    return FILTER_CONTINUE;
  }
  if (native->xclient.message_type != wm_protocols ||
      (Atom)native->xclient.data.l[0] != wm_delete) {
    return FILTER_CONTINUE;
  }
  unsigned long window = (unsigned long)native->xclient.window;
  if ((Atom)native->xclient.data.l[0] == wm_delete && is_watched(window)) {
    pending_xid = window;
    return FILTER_REMOVE;
  }
  return FILTER_CONTINUE;
}

static void *gdk_symbol(const char *name) {
  void *symbol = dlsym(RTLD_DEFAULT, name);
  if (symbol) {
    return symbol;
  }
  void *library = dlopen("libgdk-3.so.0", RTLD_LAZY | RTLD_NOLOAD);
  if (!library) {
    library = dlopen("libgdk-3.so.0", RTLD_LAZY);
  }
  return library ? dlsym(library, name) : NULL;
}

static void remember(unsigned long xid) {
  for (int i = 0; i < watched_count; i++) {
    if (watched[i] == xid) {
      return;
    }
  }
  if (watched_count < (int)(sizeof(watched) / sizeof(watched[0]))) {
    watched[watched_count++] = xid;
  }
}

int tray_watch(void *gdk_display, unsigned long xid) {
  last_error = "";
  if (!gdk_display || !xid) {
    last_error = "missing display or window";
    return 0;
  }
  GetXDisplayFn get_xdisplay = (GetXDisplayFn)gdk_symbol("gdk_x11_display_get_xdisplay");
  ForeignWindowFn foreign_new =
      (ForeignWindowFn)gdk_symbol("gdk_x11_window_foreign_new_for_display");
  AddFilterFn add_filter = (AddFilterFn)gdk_symbol("gdk_window_add_filter");
  if (!get_xdisplay || !foreign_new || !add_filter) {
    last_error = "GDK X11 symbols are unavailable";
    return 0;
  }
  Display *xdisplay = get_xdisplay((GdkDisplay *)gdk_display);
  if (!xdisplay) {
    last_error = "GDK display has no X display";
    return 0;
  }
  if (!wm_protocols) {
    wm_protocols = XInternAtom(xdisplay, "WM_PROTOCOLS", False);
  }
  if (!wm_delete) {
    wm_delete = XInternAtom(xdisplay, "WM_DELETE_WINDOW", False);
  }
  remember(xid);
  if (!gdk_handler_installed) {
    typedef void (*SetHandlerFn)(void (*func)(void *, void *), void *data, void *destroy);
    SetHandlerFn set_handler = (SetHandlerFn)gdk_symbol("gdk_event_handler_set");
    real_do_event = (void (*)(void *))gdk_symbol("gtk_main_do_event");
    gdk_get_xid = (unsigned long (*)(void *))gdk_symbol("gdk_x11_window_get_xid");
    if (set_handler && real_do_event && gdk_get_xid) {
      set_handler(on_gdk_event, NULL, NULL);
      gdk_handler_installed = 1;
    } else {
      last_error = "could not install the close handler";
    }
  }
  if (!filter_installed) {
    add_filter(NULL, (void *)on_xevent, NULL);
    filter_installed = 1;
  }
  GdkWindow *window = foreign_new((GdkDisplay *)gdk_display, (Window)xid);
  if (window) {
    add_filter(window, (void *)on_xevent, NULL);
  }
  return 1;
}

unsigned long tray_take_pending(void) {
  unsigned long value = pending_xid;
  pending_xid = 0;
  return value;
}

void tray_set_armed(int value) {
  armed = value ? 1 : 0;
}

const char *tray_last_error(void) {
  return last_error ? last_error : "";
}
