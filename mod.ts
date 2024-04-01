// mod.ts

// Determine library extension based on
// your OS.
let libSuffix = "";
let system: "win32" | "cocoa" | "x11" = "win32";
switch (Deno.build.os) {
  case "windows":
    libSuffix = "dll";
    system = "win32";
    break;
  case "darwin":
    libSuffix = "dylib";
    system = "cocoa";
    break;
  default:
    libSuffix = "so";
    system = "x11";
    break;
}
console.log(`Loading ${libSuffix} library for ${system}.`);

const libName = `./target/release/deno_winit.${libSuffix}`;
// Open library and define exported symbols
const dylib = Deno.dlopen(libName, {
  spawn_window: { parameters: ["function", "function"], result: "void" },
} as const);

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter?.requestDevice();

let surface: Deno.UnsafeWindowSurface | null = null;
const setupFunctionCallback = new Deno.UnsafeCallback(
  { parameters: ["pointer", "pointer"], result: "void" },
  (winHandle, displayHandle) => {
    surface = new Deno.UnsafeWindowSurface(system, winHandle, displayHandle);
  }
);

const drawFunctionCallback = new Deno.UnsafeCallback(
  { parameters: [], result: "void" },
  () => {
    if (surface) {
      console.log(surface);
    }
  }
);

dylib.symbols.spawn_window(
  setupFunctionCallback.pointer,
  drawFunctionCallback.pointer
);
