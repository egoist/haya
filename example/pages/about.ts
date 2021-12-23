import "./about.css"
import { defineComponent, h } from "vue"

export default defineComponent({
  setup() {
    return () => h("h1", "About")
  },
})
