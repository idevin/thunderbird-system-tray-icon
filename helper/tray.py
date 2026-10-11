#!/usr/bin/env python3
"""StatusNotifier tray icon for the Close to Tray Thunderbird add-on.

The icon runs in its own process so it can use the desktop's D-Bus tray
without loading another GTK into Thunderbird. Thunderbird talks to this
process with one JSON object per line.

Commands on stdin:
  {"cmd": "shutdown"}

Events on stdout:
  {"event": "ready"}
  {"event": "toggle"}
  {"event": "show"}
  {"event": "quit"}
  {"event": "error", "message": "..."}
"""

import json
import os
import sys

ITEM_PATH = "/StatusNotifierItem"
MENU_PATH = "/Menu"
ITEM_IFACE = "org.kde.StatusNotifierItem"
MENU_IFACE = "com.canonical.dbusmenu"
WATCHER_NAME = "org.kde.StatusNotifierWatcher"
WATCHER_PATH = "/StatusNotifierWatcher"

SHOW_ID = 1
QUIT_ID = 3


def send(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def log(message):
    print(message, file=sys.stderr, flush=True)


def main():
    icon_path = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        import gi

        gi.require_version("GdkPixbuf", "2.0")
        from gi.repository import GdkPixbuf, Gio, GLib
    except Exception as error:
        send({
            "event": "error",
            "message": "Python tray libraries are missing (%s). Install python3-gi and gir1.2-gdkpixbuf-2.0." % error,
        })
        return 1

    loop = GLib.MainLoop()
    state = {"revision": 1, "bus_name": None, "closing": False, "ready": False}

    def item_props(item_id):
        if item_id == SHOW_ID:
            return {
                "label": GLib.Variant("s", "Show Thunderbird"),
                "enabled": GLib.Variant("b", True),
                "visible": GLib.Variant("b", True),
            }
        if item_id == 2:
            return {"type": GLib.Variant("s", "separator")}
        if item_id == QUIT_ID:
            return {
                "label": GLib.Variant("s", "Quit Thunderbird"),
                "enabled": GLib.Variant("b", True),
                "visible": GLib.Variant("b", True),
            }
        return {}

    def leaf(item_id):
        return GLib.Variant("(ia{sv}av)", (item_id, item_props(item_id), []))

    def menu_layout_value():
        children = [leaf(SHOW_ID), leaf(2), leaf(QUIT_ID)]
        return (0, {"children-display": GLib.Variant("s", "submenu")}, children)

    def icon_pixmaps():
        if not icon_path or not os.path.isfile(icon_path):
            return GLib.Variant.new_array(GLib.VariantType("(iiay)"), [])
        images = []
        for size in (22, 32, 48, 64):
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(icon_path, size, size)
            if not pixbuf.get_has_alpha():
                pixbuf = pixbuf.add_alpha(False, 0, 0, 0)
            width = pixbuf.get_width()
            height = pixbuf.get_height()
            stride = pixbuf.get_rowstride()
            channels = pixbuf.get_n_channels()
            pixels = pixbuf.get_pixels()
            argb = bytearray()
            for y in range(height):
                row = y * stride
                for x in range(width):
                    index = row + x * channels
                    red, green, blue = pixels[index], pixels[index + 1], pixels[index + 2]
                    alpha = pixels[index + 3] if channels == 4 else 255
                    argb.extend((alpha, red, green, blue))
            pixel_bytes = GLib.Variant.new_from_bytes(
                GLib.VariantType("ay"), GLib.Bytes.new(bytes(argb)), True
            )
            images.append(GLib.Variant("(iiay)", (width, height, pixel_bytes)))
        return GLib.Variant.new_array(GLib.VariantType("(iiay)"), images)

    empty_icons = GLib.Variant.new_array(GLib.VariantType("(iiay)"), [])
    pixmap = icon_pixmaps()
    tooltip = GLib.Variant(
        "(sa(iiay)ss)",
        (
            "",
            empty_icons,
            "Thunderbird",
            "Thunderbird is still running. Click to show the window.",
        ),
    )
    properties = {
        "Category": GLib.Variant("s", "ApplicationStatus"),
        "Id": GLib.Variant("s", "thunderbird-close-to-tray"),
        "Title": GLib.Variant("s", "Thunderbird"),
        "Status": GLib.Variant("s", "Active"),
        "WindowId": GLib.Variant("i", 0),
        "IconName": GLib.Variant("s", "" if icon_path else "internet-mail"),
        "IconPixmap": pixmap,
        "IconThemePath": GLib.Variant("s", ""),
        "OverlayIconName": GLib.Variant("s", ""),
        "OverlayIconPixmap": empty_icons,
        "AttentionIconName": GLib.Variant("s", ""),
        "AttentionIconPixmap": empty_icons,
        "AttentionMovieName": GLib.Variant("s", ""),
        "ToolTip": tooltip,
        "ItemIsMenu": GLib.Variant("b", False),
        "Menu": GLib.Variant("o", MENU_PATH),
    }
    menu_properties = {
        "Version": GLib.Variant("u", 3),
        "Status": GLib.Variant("s", "normal"),
    }

    item_xml = """
    <node>
      <interface name='org.kde.StatusNotifierItem'>
        <method name='Activate'>
          <arg type='i' name='x' direction='in'/>
          <arg type='i' name='y' direction='in'/>
        </method>
        <method name='SecondaryActivate'>
          <arg type='i' name='x' direction='in'/>
          <arg type='i' name='y' direction='in'/>
        </method>
        <method name='ContextMenu'>
          <arg type='i' name='x' direction='in'/>
          <arg type='i' name='y' direction='in'/>
        </method>
        <method name='Scroll'>
          <arg type='i' name='delta' direction='in'/>
          <arg type='s' name='orientation' direction='in'/>
        </method>
        <property name='Category' type='s' access='read'/>
        <property name='Id' type='s' access='read'/>
        <property name='Title' type='s' access='read'/>
        <property name='Status' type='s' access='read'/>
        <property name='WindowId' type='i' access='read'/>
        <property name='IconName' type='s' access='read'/>
        <property name='IconPixmap' type='a(iiay)' access='read'/>
        <property name='IconThemePath' type='s' access='read'/>
        <property name='OverlayIconName' type='s' access='read'/>
        <property name='OverlayIconPixmap' type='a(iiay)' access='read'/>
        <property name='AttentionIconName' type='s' access='read'/>
        <property name='AttentionIconPixmap' type='a(iiay)' access='read'/>
        <property name='AttentionMovieName' type='s' access='read'/>
        <property name='ToolTip' type='(sa(iiay)ss)' access='read'/>
        <property name='ItemIsMenu' type='b' access='read'/>
        <property name='Menu' type='o' access='read'/>
        <signal name='NewIcon'/>
        <signal name='NewToolTip'/>
        <signal name='NewStatus'>
          <arg type='s' name='status'/>
        </signal>
      </interface>
    </node>
    """
    menu_xml = """
    <node>
      <interface name='com.canonical.dbusmenu'>
        <method name='GetLayout'>
          <arg type='i' name='parentId' direction='in'/>
          <arg type='i' name='recursionDepth' direction='in'/>
          <arg type='as' name='propertyNames' direction='in'/>
          <arg type='u' name='revision' direction='out'/>
          <arg type='(ia{sv}av)' name='layout' direction='out'/>
        </method>
        <method name='GetGroupProperties'>
          <arg type='ai' name='ids' direction='in'/>
          <arg type='as' name='propertyNames' direction='in'/>
          <arg type='a(ia{sv})' name='properties' direction='out'/>
        </method>
        <method name='AboutToShow'>
          <arg type='i' name='id' direction='in'/>
          <arg type='b' name='needUpdate' direction='out'/>
        </method>
        <method name='Event'>
          <arg type='i' name='id' direction='in'/>
          <arg type='s' name='eventId' direction='in'/>
          <arg type='v' name='data' direction='in'/>
          <arg type='u' name='timestamp' direction='in'/>
        </method>
        <property name='Version' type='u' access='read'/>
        <property name='Status' type='s' access='read'/>
        <signal name='LayoutUpdated'>
          <arg type='u' name='revision'/>
          <arg type='i' name='parent'/>
        </signal>
      </interface>
    </node>
    """

    def on_item_method(_connection, _sender, _path, _interface, method, parameters, invocation, *_unused):
        try:
            if method in ("Activate", "SecondaryActivate"):
                send({"event": "toggle"})
            elif method == "ContextMenu":
                pass
            invocation.return_value(None)
        except Exception as error:
            invocation.return_dbus_error("org.freedesktop.DBus.Error.Failed", str(error))

    def on_menu_method(_connection, _sender, _path, _interface, method, parameters, invocation, *_unused):
        try:
            if method == "GetLayout":
                invocation.return_value(
                    GLib.Variant("(u(ia{sv}av))", (state["revision"], menu_layout_value()))
                )
            elif method == "GetGroupProperties":
                ids, names = parameters.unpack()
                entries = []
                for item_id in ids:
                    props = item_props(item_id)
                    if names:
                        props = {key: value for key, value in props.items() if key in names}
                    entries.append((item_id, props))
                invocation.return_value(GLib.Variant("(a(ia{sv}))", (entries,)))
            elif method == "AboutToShow":
                invocation.return_value(GLib.Variant("(b)", (False,)))
            elif method == "Event":
                item_id, event_id, _data, _timestamp = parameters.unpack()
                if event_id == "clicked" and item_id == SHOW_ID:
                    send({"event": "show"})
                elif event_id == "clicked" and item_id == QUIT_ID:
                    send({"event": "quit"})
                invocation.return_value(None)
            else:
                invocation.return_value(None)
        except Exception as error:
            log("menu method %s failed: %s" % (method, error))
            invocation.return_dbus_error("org.freedesktop.DBus.Error.Failed", str(error))

    def get_item_property(_connection, _sender, _path, _interface, name, *_unused):
        return properties.get(name)

    def get_menu_property(_connection, _sender, _path, _interface, name, *_unused):
        return menu_properties.get(name)

    item_info = Gio.DBusNodeInfo.new_for_xml(item_xml).interfaces[0]
    menu_info = Gio.DBusNodeInfo.new_for_xml(menu_xml).interfaces[0]

    def on_registered(connection, result, *_unused):
        try:
            connection.call_finish(result)
        except Exception as error:
            send({
                "event": "error",
                "message": "The desktop did not accept the tray icon (%s)." % error,
            })
            loop.quit()
            return
        state["ready"] = True
        send({"event": "ready"})

    def on_bus_acquired(connection, name):
        connection.register_object(ITEM_PATH, item_info, on_item_method, get_item_property, None)
        connection.register_object(MENU_PATH, menu_info, on_menu_method, get_menu_property, None)
        state["bus_name"] = name

    def on_name_acquired(connection, name):
        connection.call(
            WATCHER_NAME,
            WATCHER_PATH,
            WATCHER_NAME,
            "RegisterStatusNotifierItem",
            GLib.Variant("(s)", (name,)),
            None,
            Gio.DBusCallFlags.NONE,
            5000,
            None,
            on_registered,
        )

    def on_name_lost(_connection, name):
        if state["closing"] or state["ready"]:
            return
        send({
            "event": "error",
            "message": "Could not reserve the tray name %s. Is a StatusNotifier tray running?" % name,
        })
        loop.quit()

    def request_quit():
        state["closing"] = True
        loop.quit()

    def on_stdin(_fd, condition, *_unused):
        if condition & GLib.IO_HUP and not (condition & GLib.IO_IN):
            request_quit()
            return False
        try:
            chunk = os.read(sys.stdin.fileno(), 4096)
        except BlockingIOError:
            return True
        if not chunk:
            request_quit()
            return False
        on_stdin.buffer += chunk.decode("utf-8", "replace")
        while "\n" in on_stdin.buffer:
            line, on_stdin.buffer = on_stdin.buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
            except json.JSONDecodeError:
                log("ignored invalid command: %s" % line)
                continue
            if command.get("cmd") == "shutdown":
                request_quit()
                return False
        return True

    on_stdin.buffer = ""

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    if not bus.call_sync(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "NameHasOwner",
        GLib.Variant("(s)", (WATCHER_NAME,)),
        GLib.VariantType("(b)"),
        Gio.DBusCallFlags.NONE,
        2000,
        None,
    ).unpack()[0]:
        send({
            "event": "error",
            "message": "This desktop has no StatusNotifier tray. KDE Plasma and Xfce provide one. GNOME needs the AppIndicator extension.",
        })
        return 1

    flags = fcntl_nonblocking(sys.stdin.fileno())
    GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, on_stdin)
    Gio.bus_own_name(
        Gio.BusType.SESSION,
        "org.kde.StatusNotifierItem-%s-1" % os.getpid(),
        Gio.BusNameOwnerFlags.NONE,
        on_bus_acquired,
        on_name_acquired,
        on_name_lost,
    )
    try:
        loop.run()
    finally:
        if flags is not None:
            import fcntl

            fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, flags)
    return 0


def fcntl_nonblocking(fd):
    import fcntl

    current = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, current | os.O_NONBLOCK)
    return current


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        send({"event": "error", "message": str(error)})
        sys.exit(1)
