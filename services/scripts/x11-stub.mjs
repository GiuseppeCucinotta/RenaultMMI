/**
 * Stand-in for dbus-next's optional `x11` dependency.
 *
 * `dbus-next/lib/address-x11.js` does `const x11 = require('x11')`
 * unconditionally and expects it to be `null` when the package is not installed
 * (X11 is only needed to locate the *session* bus address). A bundler turns that
 * require into a top-level ESM import instead, so the whole service crashes at
 * load with `Cannot find package 'x11'`.
 *
 * `x11` is not a declared dependency and the Bluetooth service only talks to the
 * *system* bus, so aliasing the module to `null` restores dbus-next's intended
 * fallback: it throws a descriptive error only if the X11 path is actually used.
 */
export default null;
