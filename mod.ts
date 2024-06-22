import type { FetchOptions } from "@denosaurs/plug";
import { dlopen } from "@denosaurs/plug";

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

  public async spawn(): Promise<void> {
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
    let windowHandle: Deno.PointerValue<unknown> | null = null;
    let displayHandle: Deno.PointerValue<unknown> | null = null;

    const setupSurfaceAndContext = (
      winHandle: Deno.PointerValue<unknown>,
      dispHandle: Deno.PointerValue<unknown>,
      width: number,
      height: number
    ) => {
      if (!this.system) {
        console.error("System not supported.");
        return;
      }

      surface = new Deno.UnsafeWindowSurface(
        this.system,
        winHandle,
        dispHandle
      );
      context = surface.getContext("webgpu");
      context.configure({
        device,
        format: this.presentationFormat,
        width,
        height,
      });
    };
    const setupFunctionFfiCallback = new Deno.UnsafeCallback(
      { parameters: ["pointer", "pointer", "u32", "u32"], result: "void" },
      (winHandle, dispHandle, width, height) => {
        windowHandle = winHandle;
        displayHandle = dispHandle;
        setupSurfaceAndContext(windowHandle, displayHandle, width, height);

        if (!context) {
          console.error("Context not initialized.");
          return;
        }

        this.setupFunction(device, context);
      }
    );

    const drawFunctionCallback = () => {
      if (!surface) {
        console.error("Surface not initialized.");
        return;
      }

      if (!context) {
        console.error("Context not initialized.");
        return;
      }

      this.drawFunction(device, context);
      surface.present();
    };
    const drawFunctionFfiCallback = new Deno.UnsafeCallback(
      { parameters: [], result: "void" },
      drawFunctionCallback
    );

    const resizeFunctionFfiCallback = new Deno.UnsafeCallback(
      { parameters: ["u32", "u32"], result: "void" },
      (width, height) => {
        this.width = width;
        this.height = height;
        this.resizeFunction(width, height);

        if (this.system === "cocoa") {
          // On macOS, the surface and context needs to be recreated
          // and the draw function needs to be called again
          setupSurfaceAndContext(windowHandle, displayHandle, width, height);
          drawFunctionCallback();
        }
      }
    );

    const dylib = await this.dylibPromise;
    dylib.symbols.spawn_window(
      this.width,
      this.height,
      setupFunctionFfiCallback.pointer,
      drawFunctionFfiCallback.pointer,
      resizeFunctionFfiCallback.pointer
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
