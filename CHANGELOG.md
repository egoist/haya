## v0.0.6

- I'm trying to improve Vite compatibility, now it loads env variables starting with `VITE_` too
- Automatic JSX helper import when you have `compilerOptions.jsx` set to `"react-jsx"` in `tsconfig.json`. It automatically infers settings from `tsconfig.json`, for example if you have `jsxFactory: "createElement"` and `jsxFragmentFactory: "Fragment"`, it will inject `import { createElement, Fragment } from "react"` instead of `import * as React from "react"`, you can also change `jsxImportSource` to `"preact"` if that's what you want.
