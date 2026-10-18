export function demoHead(section: string) {
  const title = `${section} · Modelo Ltda. — Open Gestão`;
  const description = "Demonstração pública do BI da Modelo Ltda., com informações fictícias de resultados, patrimônio e caixa.";
  return {meta:[{title},{name:"description",content:description},{property:"og:title",content:title},{property:"og:description",content:description},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"},{name:"robots",content:"noindex, nofollow"}]};
}