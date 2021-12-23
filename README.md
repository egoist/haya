**💛 You can help the author become a full-time open-source maintainer by [sponsoring him on GitHub](https://github.com/sponsors/egoist).**

---

# haya

[![npm version](https://badgen.net/npm/v/haya)](https://npm.im/haya) [![npm downloads](https://badgen.net/npm/dm/haya)](https://npm.im/haya)

## Introduction

This is a dev server and a bundler based on [esbuild](https://esbuild.github.io). Very early stage, don't use it for serious projects.

This guide is heavily copied from [Vite](https://vitejs.dev), since their usages are very similar.

## Main Differences from Vite

- Haya always bundles your app, while Vite does not during development.
- Haya use esbuild for bundling, Vite uses Rollup.
- Haya only supports full page reloading, while Vite has fine-grained HMR support.

## Install

```bash
npm i haya -D
```

## Quick Start

Use [aho](https://github.com/egoist/aho) to download the starter project:

```bash
npx aho@latest egoist/haya/template my-app
cd my-app
npm i

# start dev server
npm run dev
# build for production
npm run build
# preview production build
npm run preview
```

## Basics

### Commands

- `haya [dir]`: Start dev server, treat `dir` as root directory, defaults to `.`
- `haya build [dir]`: Build for production, output files go to `[dir]/dist`
- `haya preview [dir]`: Preview the production build in `[dir]/dist`.

### Root HTML

haya expects a `index.html` file in the root directory. You can use `<link>` and `<script>` tags to reference and bundle external CSS and JavaScript/TypeScript.

- `<link>` should have property `rel="stylesheet"` and `href="/some/style.css"`
- `<script>` should have property `type="module"` and `src="/some/script.ts"`

## Loader

### TypeScript / JavaScript

haya uses [esbuild](https://esbuild.github.io) to bundle your TypeScript and JavaScript files in ES Module format, with code splitting enabled (via dynamic import).

JSX/TSX works out of the box.

### CSS

The recommended way to use CSS is to use `<link>` in `index.html`:

```html
<link rel="stylesheet" href="/src/style.css" />
```

The generated `index.html` will look like:

```html
<link rel="stylesheet" href="/0-style-[hash].css" />
```

However you can also directly `import` CSS files in TypeScript/JavaScript files:

````js
CSS is treated specially in haya compared to other bundlers, if you import a CSS file in your JavaScript file, you will get the URL to the output CSS file:

```js
import "./style.css"
````

It will also be included in generated `index.html`.

Note that the exported value of CSS files will be the its URL:

```js
import style from "./style.css"

console.log(style)
//=> /style-[hash].css
```

If you want to get the URL without adding the CSS file to generated `index.html`, append `?import-only` query to the module name:

```js
import style from "./style.css?import-only"
```

### PostCSS

Adding a `postcss.config.js` or `postcss.config.cjs` in your root directory to enable postcss.

### Vue / Svelte

LESS SOON.

## Guide

### Hot Module Replacement

There is **NO** hot module replacement, instead it does a full reloading of the page when a rebuild occurs.

### Path Alias

You can directly configure aliases via `tsconfig.json` like this:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"]
    }
  }
}
```

Now `~/main` will be resolved to `./src/main`.

### Env Variables

haya exposes env variables on the `process.env` object. Some built-in variables are available in all cases:

- `process.env.NODE_ENV`: `development` in dev or `production` in production. We also have a special global variable `__DEV__` which evaluates to `true` in dev and `false` in production.

#### `.env` Files

haya uses [dotenv](https://github.com/motdotla/dotenv) to load additional environment variables from the following files in root directory:

```
.env                # loaded in all cases
.env.local          # loaded in all cases, ignored by git
.env.[mode]         # only loaded in specified mode
.env.[mode].local   # only loaded in specified mode, ignored by git
```

Loaded env variables are also exposed to your client source code via `process.env`.

To prevent accidentally leaking env variables to the client, only variables prefixed with `HAYA_` are exposed to your haya-processed code. e.g. the following file:

```
DB_PASSWORD=foobar
HAYA_SOME_KEY=123
```

Only `HAYA_SOME_KEY` will be exposed as `process.env.HAYA_SOME_KEY` to your client source code, but `DB_PASSWORD` will not.

### The `public` directory

If you have assets that are:

- Never referenced in source code (e.g. `robots.txt`)
- Must retain the exact same file name (without hashing)
- ...or you simply don't want to have to import an asset first just to get its URL
  Then you can place the asset in a special public directory under your project root. Assets in this directory will be served at root path `/` during dev, and copied to the root of the dist directory as-is.

The directory defaults to `<root>/public`, ~~but can be configured via the `publicDir` option (not yet)~~.

Note that:

- You should always reference public assets using root absolute path - for example, `public/icon.png` should be referenced in source code as /icon.png.
- Assets in `public` cannot be imported from JavaScript.

### Deploying a Static Site

The output directory `dist` can be served as a static website, you can preview it locally using the `haya preview` command.

## Roadmap

- [x] PostCSS / Tailwind support.
- [ ] Vue / Svelte support.
- [ ] SSR support, like the `ssrLoadModule` API from Vite.
- [ ] Testing framework, like [Vitest](https://vitest.dev/) but for haya.

## Sponsors

[![sponsors](https://sponsors-images.egoist.sh/sponsors.svg)](https://github.com/sponsors/egoist)

## License

MIT &copy; [EGOIST](https://github.com/sponsors/egoist)
