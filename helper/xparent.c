/* Prints the X window that should receive WM_DELETE_WINDOW.
 * Run outside Thunderbird: the same query inside the Thunderbird process
 * does not see the window-manager frame. */

#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <stdio.h>
#include <stdlib.h>

static int has_delete_protocol(Display *display, Window window, Atom protocols, Atom delete) {
  Atom actual = 0;
  int format = 0;
  unsigned long count = 0;
  unsigned long after = 0;
  unsigned char *value = NULL;
  int status = XGetWindowProperty(
      display, window, protocols, 0, 64, False, XA_ATOM, &actual, &format, &count,
      &after, &value);
  if (status != Success || !value) {
    return 0;
  }
  Atom *atoms = (Atom *)value;
  int found = 0;
  for (unsigned long i = 0; i < count; i++) {
    if (atoms[i] == delete) {
      found = 1;
      break;
    }
  }
  XFree(value);
  return found;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    return 2;
  }
  unsigned long window = strtoul(argv[1], NULL, 10);
  Display *display = XOpenDisplay(NULL);
  if (!display || !window) {
    return 1;
  }
  Atom protocols = XInternAtom(display, "WM_PROTOCOLS", False);
  Atom delete = XInternAtom(display, "WM_DELETE_WINDOW", False);
  unsigned long current = window;
  unsigned long found = window;
  for (int level = 0; level < 8; level++) {
    if (has_delete_protocol(display, (Window)current, protocols, delete)) {
      found = current;
      break;
    }
    Window root = 0;
    Window parent = 0;
    Window *children = NULL;
    unsigned int child_count = 0;
    if (!XQueryTree(display, (Window)current, &root, &parent, &children, &child_count)) {
      break;
    }
    if (children) {
      XFree(children);
    }
    if (!parent || parent == root) {
      break;
    }
    current = (unsigned long)parent;
  }
  Window found_root = 0;
  Window found_parent = 0;
  Window *found_children = NULL;
  unsigned int found_count = 0;
  int reparented = 0;
  if (XQueryTree(display, (Window)found, &found_root, &found_parent, &found_children,
                 &found_count)) {
    reparented = found_parent && found_parent != found_root;
  }
  if (found_children) {
    XFree(found_children);
  }
  XCloseDisplay(display);
  FILE *out = stdout;
  if (argc >= 3) {
    out = fopen(argv[2], "w");
    if (!out) {
      return 1;
    }
  }
  fprintf(out, "%lu %d\n", found, reparented);
  if (out != stdout) {
    fclose(out);
  }
  return 0;
}
