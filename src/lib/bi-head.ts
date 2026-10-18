export function biHead(section: string) {
  const title = `${section} — Orkestria BI`;
  const description = `Consulte ${section.toLowerCase()} da empresa, com demonstrações e indicadores financeiros no Orkestria BI.`;
  return { meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] };
}