const path = require("upath")

module.exports = {
  plugins: {
    tailwindcss: {
      config: path.join(__dirname, "tailwind.config.cjs"),
    },
    autoprefixer: {},
  },
}
