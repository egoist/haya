import style from "./home.css?import-only"
import { defineComponent, h } from "vue"
console.log(style)
export default defineComponent({
  setup() {
    return () =>
      h("div", [
        h("h1", { class: "italic text-2xl" }, "Hello World"),
        h("ul", [h("li", `env from .env: ${process.env.HAYA_FROM_DOT_ENV}`)]),
      ])
  },
})
