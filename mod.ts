// mod.ts

// Determine library extension based on
// your OS.
let libSuffix = "";
switch (Deno.build.os) {
  case "windows":
    libSuffix = "dll";
    break;
  case "darwin":
    libSuffix = "dylib";
    break;
  default:
    libSuffix = "so";
    break;
}

const libName = `./target/release/deno_winit.${libSuffix}`;
// Open library and define exported symbols
const dylib = Deno.dlopen(libName, {
  spawn_window: { parameters: [], result: "void" },
} as const);
dylib.symbols.spawn_window();
