import style from "./about.css"
import { defineComponent, h } from "vue"
import { insertStyleLink } from "../utils"

insertStyleLink(style)

export default defineComponent({
  setup() {
    return () => h("h1", "About")
  },
})
