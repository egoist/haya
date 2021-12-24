## Unreleased

- Fixed a regression that output filename is not hashed properly 😅 due to a typo

## 0.0.7

- Adding hash to output CSS filename in production build
- Adding support for loading assets as strings via `?raw` query parameter, e.g. `import assetAsString from './shader.glsl?raw'`, `.txt` files are always loaded as string.
- HTML attributes matching following criterias will be in the bundle process, and the value will be replaced by the output path:

  ```js
  {
    script: ["src"],
    link: ["href"],
    img: ["src"],
    image: ["xlink:href", "href"],
    source: ["src"],
    video: ["src", "poster"],
    use: ["xlink:href", "href"],
    audio: ["src"],
  }
  ```

- A web worker script can be directly imported by appending `?worker` or `?sharedworker` to the import request. The default export will be a custom worker constructor:

  ```js
  import MyWorker from "./worker?worker"

  const worker = new MyWorker()
  ```

  The worker script can also use `import` statements instead of `importScripts()`.

## 0.0.6

- I'm trying to improve Vite compatibility, now it loads env variables starting with `VITE_` too
- Automatic JSX helper import when you have `compilerOptions.jsx` set to `"react-jsx"` in `tsconfig.json`. It automatically infers settings from `tsconfig.json`, for example if you have `jsxFactory: "createElement"` and `jsxFragmentFactory: "Fragment"`, it will inject `import { createElement, Fragment } from "react"` instead of `import * as React from "react"`, you can also change `jsxImportSource` to `"preact"` if that's what you want.
