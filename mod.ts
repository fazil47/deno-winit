import { dlopen, FetchOptions } from "@denosaurs/plug";

export const VERSION = "0.1.0";

type winitDylibSymbols = {
  readonly spawn_window: {
    readonly parameters: readonly [
      "u32",
      "u32",
      "function",
      "function",
      "function"
    ];
    readonly result: "void";
  };
};

type winitDylib = Deno.DynamicLibrary<winitDylibSymbols>;

export class WinitWindow {
  private dylibPromise: Promise<winitDylib>;
  private system: "win32" | "cocoa" | "wayland" | "x11" | null = null;
  private width: number = 512;
  private height: number = 512;
  private presentationFormat: GPUTextureFormat = "bgra8unorm";
  private setupFunction: (
    device: GPUDevice,
    context: GPUCanvasContext
  ) => void = () => {};
  private drawFunction: (device: GPUDevice, context: GPUCanvasContext) => void =
    () => {};
  private resizeFunction: (width: number, height: number) => void = () => {};

  constructor({
    forceX11 = false,
    width,
    height,
    presentationFormat,
    setupFunction,
    drawFunction,
    resizeFunction,
  }: {
    forceX11?: boolean;
    width?: number;
    height?: number;
    presentationFormat?: GPUTextureFormat;
    setupFunction?: (device: GPUDevice, context: GPUCanvasContext) => void;
    drawFunction?: (device: GPUDevice, context: GPUCanvasContext) => void;
    resizeFunction?: (width: number, height: number) => void;
  }) {
    if (width) {
      this.width = width;
    }

    if (height) {
      this.height = height;
    }

    if (presentationFormat) {
      this.presentationFormat = presentationFormat;
    }

    if (setupFunction) {
      this.setupFunction = setupFunction;
    }

    if (drawFunction) {
      this.drawFunction = drawFunction;
    }

    if (resizeFunction) {
      this.resizeFunction = resizeFunction;
    }

    switch (Deno.build.os) {
      case "linux":
        if (forceX11) {
          this.system = "x11";
        } else {
          this.system = "wayland";
        }
        break;
      case "windows":
        this.system = "win32";
        break;
      case "darwin":
        this.system = "cocoa";
        break;
      default:
        throw new Error("Unsupported OS.");
    }

    const options: FetchOptions = {
      name: "deno_winit",
      url: `https://github.com/fazil47/deno_winit/releases/download/v${VERSION}/`,
    };

    const symbols = {
      spawn_window: {
        parameters: ["u32", "u32", "function", "function", "function"],
        result: "void",
      },
    } as const;
    this.dylibPromise =
      Deno.env.get("DENO_WINIT_LOCAL_LIB") === "1"
        ? dlopen_Local(symbols)
        : dlopen(options, symbols);
  }

  public async spawn() {
    if (!this.dylibPromise) {
      throw new Error("Dynamic library not loaded.");
    }

    if (!this.system) {
      throw new Error("System not supported.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No GPU adapter found.");
    }

    const device = await adapter.requestDevice();
    if (!device) {
      throw new Error("No GPU device found.");
    }

    let surface: Deno.UnsafeWindowSurface | null = null;
    let context: GPUCanvasContext | null = null;
    const setupFunctionCallback = new Deno.UnsafeCallback(
      { parameters: ["pointer", "pointer", "u32", "u32"], result: "void" },
      (winHandle, displayHandle, width, height) => {
        if (!this.system) {
          throw new Error("System not supported.");
        }

        surface = new Deno.UnsafeWindowSurface(
          this.system,
          winHandle,
          displayHandle
        );
        context = surface.getContext("webgpu");
        context.configure({
          device,
          format: this.presentationFormat,
          width,
          height,
        });
        this.setupFunction(device, context);
      }
    );

    const drawFunctionCallback = new Deno.UnsafeCallback(
      { parameters: [], result: "void" },
      () => {
        if (!surface || !context) {
          console.error("Surface or context not initialized.");
          return;
        }

        this.drawFunction(device, context);
        surface.present();
      }
    );

    const resizeFunctionCallback = new Deno.UnsafeCallback(
      { parameters: ["u32", "u32"], result: "void" },
      (width, height) => this.resizeFunction(width, height)
    );

    const dylib = await this.dylibPromise;
    dylib.symbols.spawn_window(
      this.width,
      this.height,
      setupFunctionCallback.pointer,
      drawFunctionCallback.pointer,
      resizeFunctionCallback.pointer
    );
  }
}

function dlopen_Local(symbols: winitDylibSymbols): Promise<winitDylib> {
  let libFileName = "";
  switch (Deno.build.os) {
    case "linux":
      libFileName = "libdeno_winit.so";
      break;
    case "windows":
      libFileName = "deno_winit.dll";
      break;
    case "darwin":
      libFileName = "libdeno_winit.dylib";
      break;
    default:
      throw new Error("Unsupported OS.");
  }

  // Open library and define exported symbols
  const libPath = `./target/release/${libFileName}`;

  return Promise.resolve(Deno.dlopen(libPath, symbols));
}
