export function printElementById(elementId: string, title: string) {
  const source = document.getElementById(elementId)

  if (!source) return

  const printWindow = window.open("", "_blank", "width=1200,height=900")
  if (!printWindow) return

  const cloned = source.cloneNode(true) as HTMLElement

  cloned.querySelectorAll("[data-no-print='true']").forEach((node) => {
    node.remove()
  })

  const styles = Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))
    .map((node) => node.outerHTML)
    .join("\n")

  printWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        ${styles}
        <style>
          body {
            margin: 0;
            padding: 24px;
            background: white;
            color: black;
            font-family: "Segoe UI", Arial, sans-serif;
          }

          #print-root {
            width: 100%;
          }

          @page {
            size: auto;
            margin: 0.5in;
          }
        </style>
      </head>
      <body>
        <div id="print-root"></div>
      </body>
    </html>
  `)

  printWindow.document.close()
  printWindow.document.getElementById("print-root")?.appendChild(cloned)
  printWindow.focus()
  printWindow.print()
}
