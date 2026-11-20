#import <AppKit/AppKit.h>
#include <cstring>
#include <node_api.h>

struct ScrollMonitor {
  napi_threadsafe_function callback;
  __weak NSWindow *window;
  id token;
};

static void stop(ScrollMonitor *monitor) {
  if (monitor->token) [NSEvent removeMonitor:monitor->token];
  monitor->token = nil;
  monitor->window = nil;
  if (monitor->callback) napi_release_threadsafe_function(monitor->callback, napi_tsfn_abort);
  monitor->callback = nullptr;
}

struct ScrollPacket {
  double x;
  double dx;
  double dy;
  const char *stage;
  bool momentum;
};

static void deliver(napi_env env, napi_value fn, void *, void *data) {
  auto packet = *static_cast<ScrollPacket *>(data);
  delete static_cast<ScrollPacket *>(data);
  if (!env || !fn) return;
  napi_value global, values[5];
  napi_get_global(env, &global);
  napi_create_double(env, packet.x, &values[0]);
  napi_create_double(env, packet.dx, &values[1]);
  napi_create_double(env, packet.dy, &values[2]);
  napi_create_string_utf8(env, packet.stage, NAPI_AUTO_LENGTH, &values[3]);
  napi_get_boolean(env, packet.momentum, &values[4]);
  napi_call_function(env, global, fn, 5, values, nullptr);
}

static napi_value unwatch(napi_env env, napi_callback_info info) {
  void *data = nullptr;
  napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data);
  stop(static_cast<ScrollMonitor *>(data));
  return nullptr;
}

static napi_value watch(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  void *data = nullptr;
  napi_get_cb_info(env, info, &argc, argv, nullptr, &data);
  auto *monitor = static_cast<ScrollMonitor *>(data);
  stop(monitor);

  void *buffer = nullptr;
  size_t length = 0;
  void *viewPointer = nullptr;
  napi_valuetype callbackType = napi_undefined;
  if (argc != 2 || napi_get_buffer_info(env, argv[0], &buffer, &length) != napi_ok ||
      length != sizeof(viewPointer) || napi_typeof(env, argv[1], &callbackType) != napi_ok ||
      callbackType != napi_function) return nullptr;
  std::memcpy(&viewPointer, buffer, sizeof(viewPointer));
  NSView *view = (__bridge NSView *)viewPointer;
  monitor->window = view.window;
  if (!monitor->window) return nullptr;
  napi_value name;
  napi_create_string_utf8(env, "Drew scroll", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, argv[1], nullptr, name, 0, 1, nullptr, nullptr, nullptr, deliver,
      &monitor->callback) != napi_ok) return nullptr;
  napi_unref_threadsafe_function(env, monitor->callback);

  // Local monitors only see events delivered to Drew. Other applications and windows are outside this scope.
  monitor->token = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
    handler:^NSEvent *(NSEvent *event) {
      NSWindow *window = monitor->window;
      if (!window || event.window != window || !monitor->callback ||
          (event.modifierFlags & (NSEventModifierFlagControl | NSEventModifierFlagCommand))) return event;

      double dx = -event.scrollingDeltaX;
      double dy = -event.scrollingDeltaY;
      if (!dx && (event.modifierFlags & NSEventModifierFlagShift)) {
        dx = dy;
        dy = 0;
      }
      const auto phase = event.phase;
      const char *stage = phase & (NSEventPhaseEnded | NSEventPhaseCancelled) ? "end"
        : phase & (NSEventPhaseBegan | NSEventPhaseMayBegin) ? "begin"
        : phase != NSEventPhaseNone ? "change" : "discrete";
      NSPoint point = [window.contentView convertPoint:event.locationInWindow fromView:nil];

      auto *packet = new ScrollPacket{point.x, dx, dy, stage, event.momentumPhase != NSEventPhaseNone};
      if (napi_call_threadsafe_function(monitor->callback, packet, napi_tsfn_nonblocking) != napi_ok) delete packet;
      return event;
    }];
  napi_value ready;
  napi_get_boolean(env, monitor->token != nil, &ready);
  return ready;
}

static napi_value init(napi_env env, napi_value exports) {
  auto *monitor = new ScrollMonitor{nullptr, nil, nil};
  napi_add_env_cleanup_hook(env, [](void *data) {
    auto *state = static_cast<ScrollMonitor *>(data);
    stop(state);
    delete state;
  }, monitor);
  napi_property_descriptor methods[] = {
    {"watch", nullptr, watch, nullptr, nullptr, nullptr, napi_default, monitor},
    {"unwatch", nullptr, unwatch, nullptr, nullptr, nullptr, napi_default, monitor},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}

NAPI_MODULE(lexn_scroll, init)
