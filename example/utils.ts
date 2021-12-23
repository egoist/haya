export const insertStyleLink = (style: string) => {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = style
  document.head.appendChild(link)
}
